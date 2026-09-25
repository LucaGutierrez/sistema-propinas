# DATABASE.md — Modelo de datos

Fuente de verdad del esquema. `ARCHITECTURE.md` explica el *por qué*; este documento define el *qué*: tablas, columnas, restricciones, invariantes.

Motor: PostgreSQL. ORM: Prisma (el `schema.prisma` se derivará de este documento).

**Revisión 4** (pozo único o por equipo configurable, reversión auditada de entregas, tokens de email). Tres conceptos distintos que no se reemplazan entre sí:

| Concepto | Tablas | Qué es |
|---|---|---|
| **DAILY DISTRIBUTION** | `daily_distributions`, `tip_entries`, `daily_distribution_items` | Calcula la propina de **un día**. Unidad de cálculo. |
| **WEEKLY SETTLEMENT** | `weekly_settlements` | **Acumula** las distribuciones diarias cerradas de una semana. No recalcula nada: suma. |
| **WEEKLY ENVELOPE / PAYMENT** | `weekly_payments` | El dinero que se **prepara y entrega** a cada empleado. Unidad de pago. |

```
 Lun        Mar        Mié   …   Dom
 DAILY      DAILY      DAILY     DAILY          (cada una: DRAFT → CLOSED → VOIDED)
 DIST ──┐   DIST ──┐   DIST ──┐  DIST ──┐
        └────────┴─────────┴────────┴───► WEEKLY SETTLEMENT (OPEN → CLOSED)
                                                   │
                        ┌──────────────────────────┼─────────────────────┐
                        ▼                          ▼                     ▼
                  ENVELOPE Roro              ENVELOPE Leo          ENVELOPE Marcos
                  PENDING→PREPARED→DELIVERED (con fecha/hora y usuario de entrega)
```

---

## 1. Convenciones

- **IDs:** `uuid`. **Timestamps:** `created_at`, `updated_at` (`timestamptz`) en todas las tablas.
- **Dinero:** `BIGINT` en **centavos** (ARS y USD). Nunca `FLOAT`/`REAL`/`DOUBLE`. $347.990,00 → `34799000`.
- **Cotización:** `NUMERIC(18,6)` (pesos por 1 USD).
- **Horas:** `NUMERIC(6,2)`. **Peso:** `NUMERIC(6,2)`. **Puntos:** `NUMERIC(12,4)` (= horas × peso, exacto). **Porcentaje:** `NUMERIC(9,6)` (fracción 0–1).
- **Fechas de negocio** (`date`, `week_start`, `week_end`, `exchange_rate_date`): `DATE`, sin hora, en la zona horaria del restaurante.
- **Semana:** definida por `restaurants.week_starts_on` (1 = lunes por defecto). `week_end = week_start + 6`.
- **Multi-tenant:** toda tabla de negocio lleva `restaurant_id`; toda consulta lo filtra.
- **Sin borrado físico** de historial: se anula (`VOIDED`). Catálogos: `archived_at`.
- **FKs** `ON DELETE RESTRICT` en todo el historial.
- **Snapshots:** el historial copia nombres, puestos, pesos, horas, puntos, porcentajes, cotizaciones, adelantos y resultados vigentes al momento del cierre. Editar un catálogo nunca cambia el pasado.

---

## 2. Enumeraciones

| Enum | Valores |
|---|---|
| `MembershipRole` | `OWNER`, `ADMIN`, `MANAGER`, `VIEWER` |
| `Currency` | `ARS`, `USD` |
| `RateSource` | `MANUAL`, `API` |
| `DailyDistributionStatus` | `DRAFT`, `CLOSED`, `VOIDED` |
| `SettlementStatus` | `OPEN`, `CLOSED`, `VOIDED` |
| `PaymentStatus` | `PENDING`, `PREPARED`, `DELIVERED`, `VOIDED` |
| `AdvanceStatus` | `PENDING`, `APPLIED`, `VOIDED` |
| `TipPoolMode` | `SINGLE` (un pozo para todo el restaurante), `PER_TEAM` (un pozo independiente por equipo) |
| `PaymentEventType` | `CREATED`, `PREPARED`, `PREPARATION_UNDONE`, `DELIVERED`, `DELIVERY_REVERTED`, `VOIDED` |
| `AuthTokenType` | `EMAIL_VERIFICATION`, `PASSWORD_RESET` |

`PaymentStatus.VOIDED` solo aparece cuando se anula la liquidación completa (p. ej. para corregirla). El ciclo normal de un sobre es `PENDING → PREPARED → DELIVERED`; una entrega revertida vuelve a `PREPARED`.
`AdvanceStatus.PENDING` incluye adelantos **parcialmente** aplicados (queda saldo pendiente).

---

## 3. Relaciones

```
users ──< memberships >── restaurants
                             │
   ┌──────────┬──────────────┼────────────────┬───────────────────┐
 teams     employees     exchange_rates    advances          weekly_settlements
   │           │                │              │                  │  │
 positions     │                │              │                  │  └──< weekly_payments >── employees
   │           │                │              │                  │
   │           │                │              └──< advance_applications >──┐
   │           │                │                                           │
   │           │                ▼                                           ▼
   └───────────┴─────────► daily_distributions ──< daily_distribution_items
                                  │      ▲
                                  │      └── settlement_id (null hasta cerrar la semana)
                                  └──< tip_entries  (ARS / USD + cotización usada)
```

---

## 4. Tablas

### 4.1 Identidad y acceso

**users** — `id, email (unique, minúsculas), name, password_hash (null si solo OAuth), email_verified_at, password_changed_at`.

**auth_tokens** — verificación de email y recuperación de contraseña
`id, user_id FK, type AuthTokenType, token_hash text (SHA-256 del token; el token en claro solo viaja por email), expires_at, used_at null, created_at` · índice `(token_hash)`, `(user_id, type)`.
Un solo uso (`used_at`), expiración corta (reset: 1 h; verificación: 24 h), al emitir uno nuevo se invalidan los anteriores del mismo tipo. Al restablecer la contraseña se actualiza `password_changed_at` y se invalidan las sesiones anteriores.

**rate_limits** — límite de intentos (login, registro, reenvío de emails, reset)
`key text (ej. 'login:ip:1.2.3.4'), window_start timestamptz, count int` · PK `(key, window_start)`. Vive en Postgres porque en un entorno serverless la memoria no se comparte entre invocaciones.

**restaurants** — `id, name, timezone (default 'America/Argentina/Buenos_Aires'), week_starts_on smallint (1–7, default 1), pool_mode TipPoolMode NOT NULL, archived_at`.
`pool_mode` **no tiene valor por defecto**: se elige explícitamente al crear el restaurante (el negocio real todavía debe confirmar si usa pozo único o por equipo). Puede cambiarse después sin migraciones porque cada distribución guarda su propio `pool_mode`; el cambio se rechaza si hay distribuciones `DRAFT` o si la semana en curso ya tiene distribuciones del otro modo.

**memberships** — `id, user_id, restaurant_id, role MembershipRole` · unique `(user_id, restaurant_id)`. MVP: solo `OWNER` operativo; el resto de roles ya existe en el modelo.

### 4.2 Catálogos

**teams** (equipos/sectores) — `id, restaurant_id, name, archived_at` · unique `(restaurant_id, name)`.

**positions** (puestos y peso) — `id, restaurant_id, team_id FK, name, weight NUMERIC(6,2), archived_at` · `CHECK (weight > 0)` · unique `(team_id, name)`.

**employees** — `id, restaurant_id, first_name, last_name, document_id null, default_position_id FK null, active, archived_at`.

**exchange_rates** (cotización oficial venta por fecha)
`id, restaurant_id, date, currency_pair ('USD_ARS'), rate NUMERIC(18,6) CHECK (>0), source RateSource, note, created_by` · unique `(restaurant_id, date, currency_pair)`.

### 4.3 DAILY DISTRIBUTION (unidad de cálculo)

**daily_distributions** — una por día (y por equipo, si el reparto es por equipo)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| date | date | día de la propina |
| pool_mode | TipPoolMode | copiado de `restaurants.pool_mode` al crear la distribución (el historial sigue siendo interpretable si el restaurante cambia de modo) |
| team_id | uuid FK teams **null** | `SINGLE` → `NULL` (pozo de todo el restaurante). `PER_TEAM` → equipo dueño del pozo (obligatorio) |
| team_name_snapshot | text null | copiado al cerrar |
| status | DailyDistributionStatus | `DRAFT` → `CLOSED` → `VOIDED` |
| tips_ars_cents | bigint | Σ propinas recibidas en pesos |
| tips_usd_cents | bigint | Σ propinas recibidas en dólares (monto original) |
| total_cents | bigint | **propina total en ARS** (pesos + USD convertidos) |
| total_points | NUMERIC(12,4) | Σ puntos |
| total_advances_cents | bigint | Σ adelantos descontados ese día |
| total_final_cents | bigint | Σ importes finales del día |
| settlement_id | uuid FK weekly_settlements null | se asigna al **cerrar la liquidación semanal**; con valor ≠ null la distribución no puede anularse |
| notes | text null | |
| created_by | uuid FK users | encargado que la cargó |
| closed_at / closed_by | null hasta cerrar | |
| voided_at / voided_by / void_reason | null | motivo obligatorio |

`CHECK ((pool_mode = 'SINGLE') = (team_id IS NULL))`.

Totales (`tips_*`, `total_*`) y `*_snapshot` se fijan **al cerrar**; en `DRAFT` se calculan en vivo y no se persisten como definitivos.

**Un pozo = una distribución diaria.** El motor de cálculo reparte *un* pozo y no conoce `team_id` ni `pool_mode`; la capa de servicios decide cuántos pozos hay:
- `SINGLE`: una distribución por día, sin equipo; participa cualquier empleado.
- `PER_TEAM`: una distribución por equipo y día; los puestos de sus ítems deben pertenecer a ese equipo (validado en el servicio).
- Un mismo día no puede mezclar ambos modos (validado en el servicio).
- La liquidación semanal suma por empleado sin importar el modo, así que **cambiar de modo no altera nada aguas abajo**. Un empleado que trabaja en dos equipos el mismo día aparece en dos distribuciones y sus adelantos se aplican en secuencia (el segundo cierre ve el saldo que dejó el primero).

Índice único parcial:
```sql
CREATE UNIQUE INDEX ux_daily_dist_active
ON daily_distributions (restaurant_id, date,
    COALESCE(team_id, '00000000-0000-0000-0000-000000000000'))
WHERE status <> 'VOIDED';
```
Índices: `(restaurant_id, date)`, `(settlement_id)`.

**tip_entries** — propinas recibidas ese día
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| daily_distribution_id | uuid FK | |
| currency | Currency | |
| amount_cents | bigint | monto **en la moneda original**, `CHECK (> 0)` |
| exchange_rate | NUMERIC(18,6) null | **cotización usada** (copia). Obligatoria si USD |
| exchange_rate_date | date null | fecha de la cotización usada (puede ser anterior al día si no había una para esa fecha) |
| exchange_rate_id | uuid FK exchange_rates null | referencia informativa |
| amount_ars_cents | bigint | equivalente en ARS ya convertido |
| note | text null | |

`CHECK ((currency = 'USD') = (exchange_rate IS NOT NULL))` · `CHECK (currency <> 'ARS' OR amount_ars_cents = amount_cents)`.

**daily_distribution_items** — una fila por empleado que trabajó ese día
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| daily_distribution_id | uuid FK | |
| employee_id | uuid FK | |
| position_id | uuid FK | si el pozo tiene `team_id`, el puesto debe pertenecer a ese equipo (validado en la app) |
| employee_name_snapshot | text | |
| position_name_snapshot | text | |
| team_name_snapshot | text | |
| weight_snapshot | NUMERIC(6,2) | peso del puesto vigente ese día |
| hours | NUMERIC(6,2) | `CHECK (hours > 0 AND hours <= 24)` |
| points | NUMERIC(12,4) | `hours × weight_snapshot` |
| percentage | NUMERIC(9,6) | `points / total_points` (informativo; el monto no se deriva de este valor redondeado) |
| amount_cents | bigint | **importe bruto** del día (método del mayor resto) |
| advances_cents | bigint | adelantos descontados ese día |
| final_cents | bigint | **importe final** del día |

unique `(daily_distribution_id, employee_id)`.
`CHECK (advances_cents >= 0 AND advances_cents <= amount_cents)` · `CHECK (final_cents = amount_cents - advances_cents)`.

### 4.4 Adelantos y saldo pendiente

**advances**
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| employee_id | uuid FK | |
| date | date | fecha en que se entregó el adelanto |
| amount_cents | bigint | ARS, `CHECK (> 0)` |
| applied_cents | bigint | Σ de aplicaciones vigentes, `CHECK (applied_cents BETWEEN 0 AND amount_cents)` |
| status | AdvanceStatus | `PENDING` (saldo > 0) → `APPLIED` (saldo = 0) / `VOIDED` |
| note | text null | |
| created_by | uuid FK users | |

**Saldo pendiente** = `amount_cents − applied_cents`. Un adelanto que supera el importe disponible de un día **no se pierde ni genera importes negativos**: se aplica hasta donde alcanza y su saldo sigue `PENDING`, disponible para los próximos cierres diarios y por lo tanto para futuras liquidaciones.

Ejemplo: propina correspondiente $30.000, adelanto $40.000 → `advances_cents = 3000000`, `final_cents = 0` ese día; el adelanto queda con `applied_cents = 3000000` y saldo pendiente `$10.000` (`status = PENDING`), que se descuenta en el siguiente cierre donde el empleado tenga importe.

**advance_applications** — cómo se consumió cada adelanto
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| advance_id | uuid FK advances | |
| daily_distribution_item_id | uuid FK | día/ítem en el que se descontó |
| amount_cents | bigint | `CHECK (> 0)` |
| reverted_at | timestamptz null | se completa si se anula la distribución diaria |

unique `(advance_id, daily_distribution_item_id)`.
`advances.applied_cents = Σ amount_cents WHERE reverted_at IS NULL`.

### 4.5 WEEKLY SETTLEMENT (acumulación)

**weekly_settlements**
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| week_start / week_end | date | `CHECK (week_end = week_start + 6)` |
| revision | int | 1 la primera vez; 2, 3… cuando se re-liquida la misma semana tras una anulación |
| supersedes_settlement_id | uuid FK weekly_settlements null | liquidación anulada a la que reemplaza |
| status | SettlementStatus | `OPEN` (acumulando) → `CLOSED` (congelada, sobres generados) → `VOIDED` |
| total_cents | bigint null | Σ importes brutos de la semana (al cerrar) |
| total_advances_cents | bigint null | Σ adelantos descontados en la semana |
| total_final_cents | bigint null | Σ importes finales = Σ sobres |
| notes | text null | |
| created_by | uuid FK users | |
| closed_at / closed_by | null | |
| voided_at / voided_by / void_reason | null | |

Índice único parcial: `UNIQUE (restaurant_id, week_start) WHERE status <> 'VOIDED'`. Además, unique `(restaurant_id, week_start, revision)` y unique `supersedes_settlement_id` (una liquidación solo puede ser reemplazada una vez).

La liquidación **no duplica** los cálculos diarios: referencia a las distribuciones (`daily_distributions.settlement_id`) y suma sus ítems.

### 4.6 WEEKLY ENVELOPE / PAYMENT (unidad de pago)

**weekly_payments** — el sobre de cada empleado
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| settlement_id | uuid FK weekly_settlements | |
| employee_id | uuid FK employees | |
| employee_name_snapshot | text | |
| period_start / period_end | date | copia del período semanal |
| gross_cents | bigint | Σ `amount_cents` de sus ítems diarios de la semana |
| advances_cents | bigint | Σ `advances_cents` de sus ítems diarios |
| net_cents | bigint | **importe a entregar** = Σ `final_cents`, `>= 0` |
| status | PaymentStatus | `PENDING` → `PREPARED` → `DELIVERED` |
| prepared_at / prepared_by | timestamptz / uuid FK null | quién armó el sobre |
| delivered_at | timestamptz null | **fecha y hora de entrega** (hora del servidor) |
| delivered_by | uuid FK users null | **usuario que entregó** |
| delivery_note | text null | |
| supersedes_payment_id | uuid FK weekly_payments null | sobre anulado al que reemplaza (misma semana y empleado, tras una corrección) |
| previously_delivered_cents | bigint | importe que ya se había entregado en sobres anteriores revertidos de esta semana y empleado (0 si no hubo). Es informativo: permite mostrar "ya entregado: X · nuevo importe: Y". |

Restricciones:
- unique `(settlement_id, employee_id)` y unique `supersedes_payment_id`.
- `CHECK (gross_cents - advances_cents = net_cents AND net_cents >= 0)`.
- `CHECK (status <> 'DELIVERED' OR (delivered_at IS NOT NULL AND delivered_by IS NOT NULL))`.
- `CHECK (status NOT IN ('PREPARED','DELIVERED') OR (prepared_at IS NOT NULL AND prepared_by IS NOT NULL))`.

Índices: `(restaurant_id, status)`, `(employee_id, period_start)`.

Las columnas `delivered_*` reflejan el **estado actual**: al revertir una entrega se limpian en la fila y **la historia completa queda en `weekly_payment_events`**.

**weekly_payment_events** — bitácora inmutable (solo `INSERT`) de cada cambio de un sobre
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| payment_id | uuid FK weekly_payments | |
| event_type | PaymentEventType | |
| from_status / to_status | PaymentStatus null / PaymentStatus | |
| amount_cents | bigint | importe del sobre en ese momento |
| performed_by | uuid FK users | quién ejecutó la acción |
| authorized_by | uuid FK users null | quién autorizó (obligatorio en `DELIVERY_REVERTED`; hoy coincide con `performed_by` porque la autorización es por rol `OWNER`/`ADMIN`) |
| reason | text null | **obligatorio (mín. 10 caracteres)** en `DELIVERY_REVERTED`, `VOIDED` y `PREPARATION_UNDONE` |
| occurred_at | timestamptz | hora del servidor |

`CHECK (event_type NOT IN ('DELIVERY_REVERTED','VOIDED','PREPARATION_UNDONE') OR (reason IS NOT NULL AND length(btrim(reason)) >= 10))` · `CHECK (event_type <> 'DELIVERY_REVERTED' OR authorized_by IS NOT NULL)`.
Cada evento se escribe **en la misma transacción** que el cambio de estado y que su fila de `audit_log`.

Se genera un sobre por cada empleado con `gross_cents > 0` en la semana. Si `net_cents = 0` (adelantos absorbieron todo) el sobre existe como registro pero la UI lo marca "sin importe a entregar".

**Desglose diario del sobre:** no se duplica en una tabla. Las distribuciones con `settlement_id` son inmutables, así que el desglose "Lunes $63.747, Martes $70.000…" se obtiene por join (§8.2) y es estable.

### 4.7 Auditoría

**audit_log** — `id, restaurant_id, user_id, action, entity, entity_id, payload jsonb, created_at`.
Se registra: cierre/anulación de distribuciones y liquidaciones, todo cambio de estado de sobre (en especial reversiones desde `DELIVERED`), cambios de cotización.

---

## 5. Inmutabilidad

Una distribución diaria `CLOSED` es inmutable. Se refuerza en **tres capas**:

1. **Aplicación:** los servicios rechazan cualquier escritura sobre distribuciones que no estén en `DRAFT`.
2. **Base de datos (triggers):**
   - `BEFORE UPDATE OR DELETE` en `tip_entries`, `daily_distribution_items` y `advance_applications` (salvo `reverted_at`): rechaza si la distribución padre no está `DRAFT`.
   - En `daily_distributions`: solo se permiten estas transiciones cuando ya está `CLOSED`: `settlement_id NULL → valor` (al cerrar la semana), `settlement_id valor → NULL` (al anular la semana) y `CLOSED → VOIDED` (con motivo, solo si `settlement_id IS NULL`). Cualquier otro cambio falla.
   - En `weekly_payments`: los campos monetarios son inmutables tras crearse; solo cambian `status`, `prepared_*`, `delivered_*`, `delivery_note`.
   - En `weekly_payment_events` y `audit_log`: `UPDATE` y `DELETE` siempre rechazados (bitácoras de solo inserción).
3. **Corrección de errores:** no se edita; se **anula** (`VOIDED`, con motivo) y se crea una nueva distribución. Si el día ya está en una liquidación cerrada, primero hay que anular la liquidación (posible solo si ningún sobre fue entregado).

---

## 6. Reglas transaccionales

**Cerrar distribución diaria** (una transacción, `SELECT … FOR UPDATE` sobre la distribución):
1. Estado `DRAFT`; la fecha no cae en una liquidación `CLOSED`.
2. Al menos una propina y `total_points > 0`.
3. Convertir propinas USD con su cotización (enteros, redondeo half-up).
4. Repartir el total con el motor de cálculo (mayor resto) → `amount_cents` por empleado.
5. Bloquear (`FOR UPDATE`) los adelantos `PENDING` de esos empleados con `date <= fecha del día`; asignarlos **del más antiguo al más nuevo**, hasta `amount_cents` de cada empleado. Crear `advance_applications`, actualizar `applied_cents`/`status`.
6. Escribir ítems con snapshots (`advances_cents`, `final_cents`), totales del día y `status = CLOSED`.

**Anular distribución diaria:** solo `CLOSED` con `settlement_id IS NULL` (o `DRAFT` descartado). Marca `advance_applications.reverted_at`, recalcula `applied_cents` y reabre los adelantos (`PENDING`).

**Cerrar liquidación semanal** (transacción, `FOR UPDATE`):
1. Estado `OPEN`; no existen distribuciones `DRAFT` con fecha en `[week_start, week_end]` (se listan para resolverlas primero).
2. Asigna `settlement_id` a todas las `daily_distributions` `CLOSED` de la semana sin liquidación (todos los equipos).
3. Por empleado: `gross = Σ amount_cents`, `advances = Σ advances_cents`, `net = Σ final_cents` → crea `weekly_payment` `PENDING`.
4. Fija totales de la liquidación y `status = CLOSED`.

**Anular liquidación semanal:** solo si ningún sobre está `DELIVERED`. Sobres → `VOIDED` (evento `VOIDED` con motivo); distribuciones → `settlement_id = NULL`.

**Transiciones de sobre:** `PENDING → PREPARED → DELIVERED`; se permite `PREPARED → PENDING`. `delivered_at` lo fija el servidor (nunca el cliente). Cada transición inserta un `weekly_payment_events`.

**Corrección tras una entrega (flujo completo, nada se modifica en silencio):**
```
Sobre DELIVERED
 → 1. Autorización: solo OWNER/ADMIN (permiso payments.revert)
 → 2. Reversión de la entrega: DELIVERED → PREPARED
        · motivo obligatorio · evento DELIVERY_REVERTED (authorized_by) · fila en audit_log
        · se limpian delivered_at/by en la fila; el evento DELIVERED original se conserva
        · "Revertir entregas de la semana": acción masiva con un único motivo (un evento por sobre)
 → 3. Anulación de la liquidación (ya no hay sobres DELIVERED): sobres → VOIDED, días liberados
 → 4. Corrección: se anulan y rehacen las distribuciones diarias afectadas
        (los adelantos consumidos vuelven a PENDING y se reaplican al recerrar)
 → 5. Re-liquidación: nueva weekly_settlement (revision + 1, supersedes_settlement_id)
        y nuevos sobres (supersedes_payment_id, previously_delivered_cents)
 → 6. Nuevo importe → PENDING → PREPARED → DELIVERED (nuevo registro de fecha/hora y usuario)
```
La semana siguiente **nunca** se modifica para compensar. El sistema muestra "ya entregado antes" y "nuevo importe" para que el encargado resuelva la diferencia física; ambos importes quedan registrados.

---

## 7. Invariantes (cada una tiene test)

| # | Invariante |
|---|---|
| I1 | Distribución cerrada: `Σ items.amount_cents = total_cents` (exacto, sin centavos perdidos ni sobrantes). |
| I2 | `total_cents = Σ tip_entries.amount_ars_cents`. |
| I3 | Ítem: `final = amount − advances`, `0 ≤ advances ≤ amount`. |
| I4 | Adelanto: `applied_cents = Σ advance_applications vigentes`; `0 ≤ applied ≤ amount`; `APPLIED ⇔ applied = amount`. |
| I5 | Nunca hay importes finales negativos. |
| I6 | Liquidación: `Σ weekly_payments.gross = Σ total_cents` de sus distribuciones. |
| I7 | Sobre: `gross/advances/net = Σ amount/advances/final` de los ítems del empleado en la semana. |
| I8 | `total_final_cents` de la liquidación `= Σ weekly_payments.net_cents`. |
| I9 | La suma semanal no introduce redondeos (todo es entero por día). |
| I10 | Una distribución pertenece como máximo a una liquidación. |
| I11 | Un adelanto aplicado en dos cierres distintos nunca supera su monto (garantizado por `FOR UPDATE`). |
| I12 | Todo cambio de estado de un sobre tiene su evento; una reversión de entrega siempre tiene motivo, autorizante y fila de auditoría. |
| I13 | `pool_mode = SINGLE ⇔ team_id IS NULL`; no hay mezcla de modos en un mismo día. |
| I14 | Adelanto de $40.000 con propina de $30.000 → día en $0 y saldo pendiente $10.000 (caso explícito de test). |

---

## 8. Consultas clave

### 8.1 Acumulado provisional de la semana en curso (liquidación aún `OPEN`)
```sql
SELECT i.employee_id,
       SUM(i.amount_cents)   AS gross_cents,
       SUM(i.advances_cents) AS advances_cents,
       SUM(i.final_cents)    AS net_cents
FROM daily_distribution_items i
JOIN daily_distributions d ON d.id = i.daily_distribution_id
WHERE d.restaurant_id = :rid AND d.status = 'CLOSED'
  AND d.date BETWEEN :week_start AND :week_end
GROUP BY i.employee_id;
```

### 8.2 Desglose diario del sobre de un empleado
```sql
SELECT d.date, SUM(i.amount_cents) AS gross, SUM(i.advances_cents) AS advances, SUM(i.final_cents) AS final
FROM daily_distribution_items i
JOIN daily_distributions d ON d.id = i.daily_distribution_id
WHERE d.settlement_id = :settlement_id AND i.employee_id = :employee_id
GROUP BY d.date ORDER BY d.date;
```

### 8.3 Sobres por entregar
```sql
SELECT * FROM weekly_payments
WHERE restaurant_id = :rid AND status IN ('PENDING','PREPARED')
ORDER BY period_start, employee_name_snapshot;
```

### 8.4 Saldo pendiente de adelantos por empleado
```sql
SELECT employee_id, SUM(amount_cents - applied_cents) AS pending_cents
FROM advances WHERE restaurant_id = :rid AND status = 'PENDING'
GROUP BY employee_id;
```

---

## 9. Ejemplo (datos del enunciado)

Sobre de Roro, semana completa (`weekly_payments`):

| Día | Bruto | Adelantos | Final |
|---|---|---|---|
| Lunes | $63.747 | – | $63.747 |
| Martes | $70.000 | – | $70.000 |
| Miércoles | $58.200 | – | $58.200 |
| Jueves | $72.400 | – | $72.400 |
| Viernes | $91.300 | – | $91.300 |
| Sábado | $84.600 | – | $84.600 |
| Domingo | $76.200 | – | $76.200 |
| **Semana** | **$516.447** | **$0** | **$516.447** |

Verificado: 63.747 + 70.000 + 58.200 + 72.400 + 91.300 + 84.600 + 76.200 = 516.447.

Bandeja de sobres de la semana: Roro → $516.447 · Leo → $623.450 · Marcos → $184.320 · … (estado `PENDING`, `PREPARED` o `DELIVERED`).

> Estos números son **solo ilustrativos**: no se usan como casos de test. Los tests usan casos explícitos y coherentes con la fórmula (ver `ARCHITECTURE.md` §7.4). El `.xlsx` real, cuando se coloque en `reference/`, se sumará como caso adicional.

---

## 10. Migraciones y seed

- Migraciones Prisma versionadas. `CHECK`, índices únicos parciales/por expresión y **triggers de inmutabilidad** se agregan como SQL dentro de la migración (Prisma no los modela). El SQL está en `apps/web/prisma/sql/0001_constraints.sql`.
- **Estado de verificación (Fase 0):** el esquema Prisma pasó `prisma validate` y `prisma generate`. Los tests de base de datos (`pnpm test:db`, carpeta `apps/web/test-db/`, también en el CI) ejecutan el DDL que Prisma genera desde `schema.prisma` (`prisma migrate diff`, sin duplicar tablas a mano) más `0001_constraints.sql` sobre **PGlite**, y comprueban CHECK, índices únicos (incl. parciales y por expresión), claves foráneas, triggers de inmutabilidad, estados de distribución/liquidación/sobre, adelantos y bitácoras de solo inserción. No reimplementan reglas de negocio: insertan filas y verifican que PostgreSQL las acepta o rechaza. Cada test corre en una transacción que se revierte.
- **Limitaciones de PGlite (no es idéntico a un PostgreSQL de producción):**
  - Es PostgreSQL compilado a WebAssembly (32 bits) que corre dentro del proceso de Node, con **una única conexión**. Por eso **no se puede probar concurrencia**: bloqueos (`SELECT … FOR UPDATE`), condiciones de carrera, niveles de aislamiento, deadlocks ni la invariante I11 (adelanto aplicado desde dos cierres simultáneos). La validación anti-mezcla de modos de pozo por trigger es de mejor esfuerzo justamente ante concurrencia.
  - Versión: PGlite 0.5.8 incluye PostgreSQL 18.3. El proveedor de producción (Neon, Supabase…) puede ofrecer otra versión mayor; no se verificó cuál. Las funciones usadas son básicas (enums, CHECK, índices parciales y por expresión, triggers PL/pgSQL, operadores `jsonb`, `gen_random_uuid()`), pero la compatibilidad entre versiones no está probada.
  - No cubre: extensiones, roles y permisos, RLS, pooling de conexiones (PgBouncer), locale/collation/zona horaria del servidor, rendimiento, ni el flujo real de migraciones (`prisma migrate dev/deploy`): el DDL sale de `prisma migrate diff`, no de aplicar migraciones.
  - Los tests comprueban nombres de restricciones y prefijos propios de los mensajes (`IMMUTABLE:`, `INVALID_TRANSITION:`, `RULE:`); los textos de errores nativos de PostgreSQL (p. ej. claves foráneas) pueden variar entre versiones.
- **Pendiente con una base real:** crear la migración inicial incluyendo el SQL y revisar con `prisma migrate diff` que Prisma no intente eliminar los índices parciales/por expresión en migraciones futuras.
- **Límites conocidos de las restricciones en base de datos:** la invariante I1 (Σ ítems = total) y I4 (`applied_cents` = Σ aplicaciones vigentes) no se pueden expresar con un CHECK; las garantiza el servicio dentro de su transacción y el motor de cálculo. La validación de "no mezclar modos de pozo en un día" por trigger es de mejor esfuerzo ante concurrencia; el servicio la valida dentro de su transacción.
- `seed.ts` (solo desarrollo): restaurante demo, equipos sugeridos (Salón, Barra, Cocina, Recepción, Bacha, Runner, Guardavidas), puestos con pesos de ejemplo, empleados, cotización y una semana de distribuciones diarias para probar liquidación y sobres.
