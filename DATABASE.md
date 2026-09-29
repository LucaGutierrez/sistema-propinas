# DATABASE.md — Modelo de datos

Fuente de verdad del esquema. `ARCHITECTURE.md` explica el *por qué*; este documento define el *qué*: tablas, columnas, restricciones, invariantes.

Motor: PostgreSQL. ORM: Prisma (el `schema.prisma` se derivará de este documento).

**Revisión 6** (política de distribución versionada por restaurante — `CONFIG-MODEL.md`; repartos de un día o de un período; horas del período; migración `20260926000000_distribution_policies`). Rev. 5: inmutabilidad reforzada de adelantos, sobres y liquidaciones; migración inicial. Rev. 4: reversión auditada de entregas, tokens de email. Tres conceptos distintos que no se reemplazan entre sí:

| Concepto | Tablas | Qué es |
|---|---|---|
| **DAILY DISTRIBUTION** | `daily_distributions`, `tip_entries`, `daily_distribution_items` | Calcula la propina de **un día** (`scope = DAY`) o de **un período entero** (`scope = PERIOD`, lo que usa la configuración estándar: el pozo se anota por día y se reparte al cierre). Unidad de cálculo. |
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

Encima de los tres conceptos está la **política de distribución** (`distribution_policy_versions`, `policy_version_positions`): cómo se calcula en cada restaurante. Está versionada; cada período queda fijado a una versión y al cerrar congela una copia (`policy_snapshot`). Ver §4.2 y `CONFIG-MODEL.md`.

---

## 1. Convenciones

- **IDs:** `uuid`. **Timestamps:** `created_at`, `updated_at` (`timestamptz`) en las tablas editables. Las filas que nacen inmutables o son de solo inserción (`auth_tokens`, `daily_distribution_items`, `advance_applications`, `audit_log`) solo tienen `created_at`; `weekly_payment_events` usa `occurred_at`; `rate_limits` usa `window_start`.
- **Dinero:** `BIGINT` en **centavos** (ARS y USD). Nunca `FLOAT`/`REAL`/`DOUBLE`. $347.990,00 → `34799000`.
- **Cotización:** `NUMERIC(18,6)` (pesos por 1 USD).
- **Horas:** `NUMERIC(6,2)`. **Porción** del puesto (en la interfaz, "porción"; en el código y la base, `portion`): `NUMERIC(20,10)`, suficiente para 0,65/45 = 0,0144444444 sin alterar los resultados de Library. **Puntos:** `NUMERIC(30,12)` (= horas × porción, exacto). **Porcentaje:** `NUMERIC(9,6)` (fracción 0–1).
- **Fechas de negocio** (`date_from`, `date_to`, `entry_date`, `week_start`, `week_end`, `exchange_rate_date`, `advances.date`): `DATE`, sin hora, en la zona horaria del restaurante.
- **Período:** lo define la versión de la política (`period_kind`, hoy solo `WEEKLY`, y `period_start_weekday` 1–7). La configuración estándar empieza el lunes, pero cada restaurante puede elegir otro día: no está fijo en la base. `week_end = week_start + 6`.
- **Multi-tenant:** toda tabla de negocio lleva `restaurant_id`; toda consulta lo filtra.
- **Sin borrado físico** de historial: se anula (`VOIDED`). Catálogos: `archived_at`.
- **FKs** `ON DELETE RESTRICT` en todo el historial.
- **Snapshots:** el historial copia nombres, puestos, porciones, horas, puntos, porcentajes, cotizaciones, adelantos y resultados vigentes al momento del cierre; el período cerrado guarda además la configuración usada (`policy_snapshot`) y la versión del cálculo (`calc_version`). Editar un catálogo o crear una versión nueva de la política nunca cambia el pasado.
- **Sin JSON como modelo:** la política es un modelo tipado (columnas y enums). `policy_snapshot` (JSONB) es solo la copia de auditoría del cierre.

---

## 2. Enumeraciones

| Enum | Valores |
|---|---|
| `MembershipRole` | `OWNER`, `MANAGER`, `EDITOR`, `VIEWER`, `SELF` |
| `Currency` | `ARS`, `USD` |
| `RateSource` | `MANUAL`, `API` |
| `DailyDistributionStatus` | `DRAFT`, `CLOSED`, `VOIDED` |
| `SettlementStatus` | `OPEN`, `CLOSED`, `VOIDED` |
| `PaymentStatus` | `PENDING`, `PREPARED`, `DELIVERED`, `VOIDED` |
| `AdvanceStatus` | `PENDING`, `APPLIED`, `VOIDED` |
| `DistributionScope` | `DAY` (reparto de un día), `PERIOD` (reparto del período entero) |
| `PolicyOrigin` | `STANDARD` (configuración estándar de GUTIP), `COPY` (copia de otra política), `CHANGE` (cambio sobre la versión anterior) |
| `PeriodKind` | `WEEKLY` |
| `SplitTiming` | `PER_PERIOD` (se reparte al cerrar el período) |
| `HoursBasis` | `PERIOD_TOTAL` (horas totales del período) |
| `HoursEntry` | `PERIOD_TOTAL_AT_CLOSE` (se cargan como total al cerrar) |
| `PotSources` | `SINGLE_DAILY_AMOUNT` (un monto por día) |
| `PoolStructure` | `SINGLE_POOL` (un pozo para todo el restaurante) |
| `PortionMode` | `BY_POSITION` (la porción depende del puesto) |
| `RoundingUnit` | `CENT`, `PESO` |
| `AdvanceDeduction` | `WHOLE_PERIOD` (el adelanto se descuenta del período) |
| `EnvelopeHandlers` | `MANAGER_ONLY`, `MANAGER_AND_EDITOR` |
| `PaymentEventType` | `CREATED`, `PREPARED`, `PREPARATION_UNDONE`, `DELIVERED`, `DELIVERY_REVERTED`, `VOIDED` |
| `AuthTokenType` | `EMAIL_VERIFICATION`, `PASSWORD_RESET` |

`PaymentStatus.VOIDED` solo aparece cuando se anula la liquidación completa (p. ej. para corregirla). El ciclo normal de un sobre es `PENDING → PREPARED → DELIVERED`; una entrega revertida vuelve a `PREPARED`.
`AdvanceStatus.PENDING` incluye adelantos **parcialmente** aplicados (queda saldo pendiente).
Los enums de la política tienen **solo los valores que GUTIP ya calcula** (los de la configuración estándar y los que la demo implementa). Una opción nueva se agrega con su migración cuando se implemente, no antes. `TipPoolMode` (`SINGLE`/`PER_TEAM`) se eliminó en la revisión 6: la estructura del pozo es un parámetro de la política (`pool_structure`).

---

## 3. Relaciones

```
users ──< memberships >── restaurants ──── current_policy_version_id ──┐
                             │                                         ▼
                             ├──< distribution_policy_versions ──< policy_version_positions >── positions
                             │          ▲ (previous / copied_from)          │
                             │          └──── weekly_settlements.policy_version_id
                             │                 weekly_settlements ──< period_policy_changes
                             │                 weekly_settlements ──< period_hours >── employees
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

**users** — `id, email (unique; CHECK minúsculas), name, email_verified bool (default false), image null, password_hash, email_verified_at, password_changed_at`.
Better Auth la usa como su modelo `user` (`name`, `email`, `emailVerified`, `image`, `createdAt`, `updatedAt`): **no hay una tabla de usuarios paralela**. La contraseña vive en `accounts`. `password_hash`, `email_verified_at` y `password_changed_at` son del diseño anterior: sin uso (y sin datos); se limpian en una migración futura.

**sessions** (Better Auth `session`) — `id, user_id FK (CASCADE), token (unique), expires_at, ip_address, user_agent, created_at, updated_at`. La cookie lleva el token firmado; cerrar sesión o revocar = borrar la fila.

**accounts** (Better Auth `account`) — `id, user_id FK (CASCADE), account_id, provider_id, password null, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, created_at, updated_at` · unique `(provider_id, account_id)`. Email y contraseña: `provider_id = 'credential'`, `account_id = users.id`, `password` = hash scrypt.

**verifications** (Better Auth `verification`) — `id, identifier, value, expires_at, created_at, updated_at` · índice `(identifier)`. Tokens de verificación de email y reset (sin uso hasta tener `Mailer`).

**auth_rate_limits** (Better Auth `rateLimit`) — `id, key (unique: "ip|ruta"), count (CHECK ≥ 0), last_request bigint (ms)`. Límite de intentos compartido entre instancias.

**auth_tokens** — *(diseño anterior a Better Auth, sin uso; reemplazada por `verifications`)* verificación de email y recuperación de contraseña
`id, user_id FK, type AuthTokenType, token_hash text (SHA-256 del token; el token en claro solo viaja por email), expires_at, used_at null, created_at` · índice `(token_hash)`, `(user_id, type)`.
Un solo uso (`used_at`), expiración corta (reset: 1 h; verificación: 24 h), al emitir uno nuevo se invalidan los anteriores del mismo tipo. Al restablecer la contraseña se actualiza `password_changed_at` y se invalidan las sesiones anteriores.

**rate_limits** — *(diseño anterior, sin uso; reemplazada por `auth_rate_limits`)* límite de intentos (login, registro, reenvío de emails, reset)
`key text (ej. 'login:ip:1.2.3.4'), window_start timestamptz, count int` · PK `(key, window_start)`. Vive en Postgres porque en un entorno serverless la memoria no se comparte entre invocaciones.

**restaurants** — `id, name, timezone (default 'America/Argentina/Buenos_Aires'), current_policy_version_id FK distribution_policy_versions null, archived_at`.
El restaurante **no guarda parámetros de cálculo** (el inicio de semana y el modo de pozo pasaron a la política). `current_policy_version_id` es la versión vigente: la que toman los períodos nuevos. Es `NULL` solo mientras se crea el restaurante (la versión necesita el restaurante); trigger `fn_restaurants_current_policy`: la versión tiene que ser del mismo restaurante y, una vez asignada, no vuelve a `NULL`.

**memberships** — `id, user_id, restaurant_id, role MembershipRole, employee_id FK employees null` · unique `(user_id, restaurant_id)`. Es la **fuente de la autorización** (ARCHITECTURE.md §9). Reglas en la base: un solo `OWNER` por restaurante (`ux_memberships_one_owner`); `SELF` exige empleado (`ck_memberships_self_employee`); un empleado se vincula a lo sumo a una membresía (`ux_memberships_employee`); el empleado es del mismo restaurante (trigger `fn_memberships_employee_same_restaurant`) y un empleado vinculado no cambia de restaurante (`fn_employees_linked_membership_restaurant`). Un usuario con membresías no se puede borrar (RESTRICT).

### 4.2 Catálogos

**teams** (equipos/sectores) — `id, restaurant_id, name, archived_at` · unique `(restaurant_id, name)`.

**positions** (puestos) — `id, restaurant_id, team_id FK null, name, archived_at` · índice único `ux_positions_restaurant_name (restaurant_id, lower(name))`.
El puesto es una **identidad estable**: su nombre vive acá y renombrarlo **no crea una versión** de la política. Su **porción** no está en el puesto sino en cada versión (`policy_version_positions`). El equipo es opcional.

**employees** — `id, restaurant_id, first_name, last_name, document_id null, default_position_id FK null, active, archived_at`. El personal **no es parte de la política** (no se versiona): altas, bajas y cambios de puesto no crean versiones.

**exchange_rates** (cotización oficial venta por fecha)
`id, restaurant_id, date, currency_pair ('USD_ARS'), rate NUMERIC(18,6) CHECK (>0), source RateSource, note, created_by` · unique `(restaurant_id, date, currency_pair)`.

### 4.2b Política de distribución versionada (`CONFIG-MODEL.md`)

**distribution_policy_versions** — una fila por versión; **solo inserción** (sin `UPDATE`, `DELETE` ni `TRUNCATE`)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| number | int | 1, 2, 3… por restaurante, `CHECK (>= 1)` · unique `(restaurant_id, number)` |
| origin | PolicyOrigin | `STANDARD` exige `template_code` y `template_version`; `COPY` exige `copied_from_version_id`; `CHANGE` exige `previous_version_id` |
| template_code / template_version | text null / int null | plantilla del código de la que salió (`'gutip-standard'`, 1). La configuración estándar **se define en el código**, no en la base |
| previous_version_id | uuid FK null | versión anterior del mismo restaurante (trigger) |
| copied_from_version_id | uuid FK null | versión copiada (puede ser de otro restaurante; la copia es independiente) |
| summary | text | qué cambió ("Redondeo: Centavos → Pesos enteros"), no vacío |
| period_kind | PeriodKind | |
| period_start_weekday | smallint | 1 = lunes … 7 = domingo, `CHECK (BETWEEN 1 AND 7)` |
| split_timing, hours_basis, hours_entry, pot_sources, pool_structure, portion_mode, rounding_unit, advance_deduction, envelope_handlers | enums | un parámetro por columna, todos `NOT NULL` y **sin valor por defecto en la base** |
| created_by / created_at | uuid FK users / timestamptz | |

Una versión **nunca se edita**: cambiar la política crea una versión nueva, que queda vigente (`restaurants.current_policy_version_id`). Un local nace con la configuración estándar (válida: puede calcular y cerrar de inmediato) o con una copia de otra política.

**policy_version_positions** — los puestos de la versión con su porción; **solo inserción**
`version_id FK, position_id FK, portion NUMERIC(20,10) CHECK (> 0), sort_order int` · PK `(version_id, position_id)`.
Trigger `fn_policy_version_positions_before_insert`: los puestos **solo se agregan en la misma transacción que crea la versión** (marca por transacción `gutip.new_policy_versions`, ver §5) y tienen que ser del mismo restaurante. Así una versión confirmada no cambia nunca.

**period_policy_changes** — bitácora de cambios de versión de un período; **solo inserción**
`id, restaurant_id, settlement_id FK, from_version_id FK, to_version_id FK, automatic bool, reason text null, performed_by FK users, occurred_at` · `CHECK (from_version_id <> to_version_id)` · `CHECK (automatic OR length(btrim(reason)) >= 10)`.
Trigger: el período está `OPEN` (lo bloquea con `FOR UPDATE`), `from_version_id` es su versión actual y `to_version_id` es del mismo restaurante. `automatic = true` es el paso del período abierto a una versión nueva; `false` es el cambio explícito (con motivo) de un período reabierto.

**period_hours** — horas totales de cada empleado en el período (se cargan como total al cerrar)
`id, restaurant_id, settlement_id FK, employee_id FK, hours NUMERIC(6,2) CHECK (>= 0), updated_by FK users, created_at, updated_at` · unique `(settlement_id, employee_id)`.
Trigger `fn_period_hours_guard`: solo con el período `OPEN` (alta, edición y baja; lee el período con `FOR SHARE`, así un cierre simultáneo espera), empleado y período del mismo restaurante, y horas ≤ 24 × días del período. El tope se deriva del período: **no es un límite de negocio**.

### 4.3 DAILY DISTRIBUTION (unidad de cálculo)

**daily_distributions** — un reparto de un día (`DAY`) o de un período entero (`PERIOD`)
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| restaurant_id | uuid FK | |
| scope | DistributionScope | `DAY` o `PERIOD` |
| date_from / date_to | date | `DAY`: el mismo día; `PERIOD`: primer y último día del período · `CHECK ((scope = 'DAY' AND date_to = date_from) OR (scope = 'PERIOD' AND date_to >= date_from))` |
| status | DailyDistributionStatus | `DRAFT` → `CLOSED` → `VOIDED` |
| tips_ars_cents | bigint | Σ propinas recibidas en pesos |
| tips_usd_cents | bigint | Σ propinas recibidas en dólares (monto original) |
| total_cents | bigint | **propina total en ARS** (pesos + USD convertidos) |
| total_points | NUMERIC(30,12) | Σ puntos |
| total_advances_cents | bigint | Σ adelantos descontados ese día |
| total_final_cents | bigint | Σ importes finales del día |
| settlement_id | uuid FK weekly_settlements null | se asigna al **cerrar la liquidación semanal**; con valor ≠ null la distribución no puede anularse |
| notes | text null | |
| created_by | uuid FK users | encargado que la cargó |
| closed_at / closed_by | null hasta cerrar | |
| voided_at / voided_by / void_reason | null | motivo obligatorio |

Totales (`tips_*`, `total_*`) y `*_snapshot` se fijan **al cerrar**; en `DRAFT` se calculan en vivo y no se persisten como definitivos.

**Un pozo = una distribución.** El motor de cálculo reparte *un* pozo. Con la configuración estándar (`split_timing = PER_PERIOD`, `pool_structure = SINGLE_POOL`) hay un reparto `PERIOD` por período: el pozo se anota por día (una `tip_entries` por fecha) y se reparte al cerrar con las horas totales del período. La pertenencia de un reparto a un período es por **rango de fechas**; `settlement_id` se asigna recién al cerrar el período (como antes).

**Sin superposición (I13):** los repartos vigentes (`status <> 'VOIDED'`) de un restaurante no se superponen. Lo garantiza una **restricción de exclusión** (requiere la extensión `btree_gist`, disponible en Neon, PGlite y el PostgreSQL del CI):
```sql
ALTER TABLE daily_distributions
  ADD CONSTRAINT ex_daily_distributions_no_overlap
    EXCLUDE USING gist (restaurant_id WITH =, daterange(date_from, date_to, '[]') WITH &&)
    WHERE (status <> 'VOIDED');
```
A diferencia de un trigger, la restricción ve las filas **sin confirmar** de otras transacciones: si dos transacciones crean repartos superpuestos a la vez, la segunda espera a la primera y falla si esta confirma (o se crea si esta se revierte), en cualquier nivel de aislamiento. No depende de que el servicio bloquee nada (demostrado en `test:pg`). Cubre también el caso anterior de "un reparto vigente por día" (dos repartos del mismo día se superponen).
Con `pool_structure = SINGLE_POOL` (lo único implementado) hay un solo pozo, así que un día o período tiene un solo reparto. Si una versión futura de la política admite varios pozos (p. ej. por equipo), esa migración agregará la clave del pozo al reparto y a esta restricción; hoy no se conserva ninguna columna ni regla del modelo anterior (`pool_mode`, `team_id`).
Índices: `(restaurant_id, date_from)`, `(settlement_id)` y el GiST de la restricción.

**tip_entries** — propinas recibidas ese día
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| daily_distribution_id | uuid FK | |
| entry_date | date | día en que entró la propina; cae dentro de `[date_from, date_to]` del reparto (trigger `fn_tip_entries_in_range`) |
| currency | Currency | |
| amount_cents | bigint | monto **en la moneda original**, `CHECK (> 0)` |
| exchange_rate | NUMERIC(18,6) null | **cotización usada** (copia). Obligatoria si USD |
| exchange_rate_date | date null | fecha de la cotización usada (puede ser anterior al día si no había una para esa fecha) |
| exchange_rate_id | uuid FK exchange_rates null | referencia informativa |
| amount_ars_cents | bigint | equivalente en ARS ya convertido |
| note | text null | |

`CHECK ((currency = 'USD') = (exchange_rate IS NOT NULL))` · `CHECK (currency <> 'ARS' OR amount_ars_cents = amount_cents)`.

**daily_distribution_items** — una fila por empleado que trabajó en el reparto
| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| daily_distribution_id | uuid FK | |
| employee_id | uuid FK | |
| position_id | uuid FK | |
| employee_name_snapshot | text | |
| position_name_snapshot | text | |
| team_name_snapshot | text null | el puesto puede no tener equipo |
| portion_snapshot | NUMERIC(20,10) | porción del puesto en la versión de la política usada, `CHECK (> 0)` |
| hours | NUMERIC(6,2) | `CHECK (hours > 0)`; tope 24 × días del reparto (trigger `fn_ddi_hours_in_range`: 24 en un `DAY`, 168 en un período semanal) |
| points | NUMERIC(30,12) | `hours × portion_snapshot` |
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
| voided_at / voided_by / void_reason | null | obligatorios (motivo ≥ 10 caracteres) si `VOIDED`, vacíos si no (`ck_advances_voided`, `ck_advances_void_data_only_when_voided`) |

**Inmutabilidad del adelanto** (trigger `fn_advances_guard`):
- Mientras tenga **aplicaciones vigentes** (`advance_applications.reverted_at IS NULL`) no se puede modificar `amount_cents`, `employee_id`, `restaurant_id` ni `date`, y **no se puede anular**. Primero hay que anular las distribuciones diarias que lo consumieron (eso revierte sus aplicaciones y reabre el saldo). `applied_cents` y `status` sí cambian en cada cierre.
- Sin aplicaciones vigentes (nunca aplicado, o todas revertidas) se puede corregir o anular.
- `VOIDED` es **final**: la fila no cambia más y el adelanto no puede aplicarse en ningún cierre.
- **Nunca se borra** (`DELETE` y `TRUNCATE` rechazados, aunque no se haya aplicado nunca): para descartarlo se anula (`VOIDED`).

**Saldo pendiente** = `amount_cents − applied_cents`. Un adelanto que supera el importe disponible de un día **no se pierde ni genera importes negativos**: se aplica hasta donde alcanza y su saldo sigue `PENDING`, disponible para los próximos cierres diarios y por lo tanto para futuras liquidaciones.

Ejemplo: propina correspondiente $30.000, adelanto $40.000 → `advances_cents = 3000000`, `final_cents = 0` ese día; el adelanto queda con `applied_cents = 3000000` y saldo pendiente `$10.000` (`status = PENDING`), que se descuenta en el siguiente cierre donde el empleado tenga importe.
El saldo pendiente **se consulta** (§8.4): no hay filas artificiales de "saldo anterior" en la base (la demo las muestra en pantalla, derivadas).

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
| policy_version_id | uuid FK distribution_policy_versions | versión de la política con la que se calcula el período, del mismo restaurante. Mientras está `OPEN` solo cambia si el cambio quedó registrado en `period_policy_changes` **en la misma transacción** (trigger `fn_weekly_settlements_policy`) |
| policy_snapshot | jsonb null | copia de la configuración usada, fijada **al cerrar** (auditoría; el modelo tipado es la versión) |
| calc_version | text null | versión del cálculo usada al cerrar (p. ej. `provisional-1`) |
| status | SettlementStatus | `OPEN` (acumulando) → `CLOSED` (congelada, sobres generados) → `VOIDED` |
| total_cents | bigint null | Σ importes brutos de la semana (al cerrar) |
| total_advances_cents | bigint null | Σ adelantos descontados en la semana |
| total_final_cents | bigint null | Σ importes finales = Σ sobres |
| notes | text null | |
| created_by | uuid FK users | |
| closed_at / closed_by | null | |
| voided_at / voided_by / void_reason | null | |

Índice único parcial: `UNIQUE (restaurant_id, week_start) WHERE status <> 'VOIDED'`. Además, unique `(restaurant_id, week_start, revision)` y unique `supersedes_settlement_id` (una liquidación solo puede ser reemplazada una vez).
`CHECK (status <> 'CLOSED' OR (policy_snapshot IS NOT NULL AND length(btrim(calc_version)) > 0))`: no se cierra sin congelar la configuración y la versión del cálculo.
El período **se abre al empezar** (fijado a la versión vigente) para registrar sus horas (`period_hours`) y sus cambios de versión.

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
| authorized_by | uuid FK users null | quién autorizó (obligatorio en `DELIVERY_REVERTED`; hoy coincide con `performed_by` porque la autorización es por rol `OWNER`/`MANAGER`) |
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
   - `BEFORE INSERT OR UPDATE OR DELETE` en `tip_entries` y `daily_distribution_items`: rechaza si la distribución padre no está `DRAFT`.
   - En `advance_applications`: se insertan solo con el padre en `DRAFT` (durante el cierre) y nunca para un adelanto `VOIDED`; no se borran; lo único que cambia después es `reverted_at`, una sola vez.
   - En `advances`: ver §4.4 (identidad y monto bloqueados con aplicaciones vigentes, no se anula con aplicaciones vigentes, `VOIDED` final, sin `DELETE` ni `TRUNCATE`).
   - En `daily_distributions`: solo se permiten estas transiciones cuando ya está `CLOSED`: `settlement_id NULL → valor` (al cerrar la semana), `settlement_id valor → NULL` (al anular la semana) y `CLOSED → VOIDED` (con motivo, solo si `settlement_id IS NULL`). Cualquier otro cambio falla.
   - En `weekly_settlements`: `OPEN` es editable. `CLOSED` congela **toda** la fila (incluidos `notes` y `closed_*`); la única salida es `CLOSED → VOIDED`, que solo completa `voided_at`, `voided_by` y `void_reason`. `VOIDED` congela toda la fila. No se borran.
   - En `weekly_payments`: identidad e importes son inmutables tras crearse. Mientras el sobre siga `DELIVERED`, `delivered_at`, `delivered_by`, `delivery_note`, `prepared_at` y `prepared_by` no cambian: un error en los datos de entrega se corrige con el flujo de reversión (§6), no editando. La reversión `DELIVERED → PREPARED` limpia `delivered_*` y puede limpiar `delivery_note` (no reemplazarla), y no puede tocar `prepared_*`. La nota correcta se registra en la nueva entrega. Un sobre `VOIDED` congela toda la fila. No se borran.
   - En `weekly_payment_events` y `audit_log`: `UPDATE` y `DELETE` siempre rechazados (bitácoras de solo inserción).
   - En `distribution_policy_versions`, `policy_version_positions` y `period_policy_changes`: solo inserción (`UPDATE`, `DELETE` y `TRUNCATE` rechazados). Los puestos de una versión solo se insertan en la transacción que la crea.
   - En `weekly_settlements.policy_version_id`: solo cambia con el período `OPEN` y con su fila en `period_policy_changes` en la misma transacción. Cerrado, la fila entera ya está congelada (incluidos `policy_snapshot` y `calc_version`).
   - En `period_hours`: solo con el período `OPEN`.
   - **Marcas por transacción:** los triggers que dicen "en la misma transacción" usan `set_config(clave, …, true)` (variables locales a la transacción: `gutip.new_policy_versions`, `gutip.period_policy_changes`). Se descartan al confirmar o revertir, y otra transacción no las ve (demostrado en `test:pg`).
3. **Corrección de errores:** no se edita; se **anula** (`VOIDED`, con motivo) y se crea una nueva distribución. Si el día ya está en una liquidación cerrada, primero hay que anular la liquidación (posible solo si ningún sobre fue entregado).

---

## 6. Reglas transaccionales

**Crear o copiar la política de un local** (una transacción): insertar la versión 1 (`STANDARD` con `template_code`/`template_version`, o `COPY` con `copied_from_version_id`), sus `policy_version_positions` y fijar `restaurants.current_policy_version_id`.

**Cambiar la política** (una transacción): insertar la versión `n + 1` (`CHANGE`, `previous_version_id`, `summary`) con **todos** sus puestos y porciones, y dejarla vigente. Si el período abierto usaba la versión anterior, pasa a la nueva: fila `period_policy_changes` con `automatic = true` y `UPDATE weekly_settlements SET policy_version_id`. El período se recalcula con la versión nueva. Dos cambios simultáneos: el segundo choca con unique `(restaurant_id, number)` y se reintenta.

**Período reabierto (rehacer):** la revisión nueva (`revision + 1`, `supersedes_settlement_id`) se abre **con la versión original**. Solo cambia a la vigente si se pide explícitamente, con motivo (`automatic = false`).

**Cerrar distribución diaria** (una transacción, `SELECT … FOR UPDATE` sobre la distribución):
1. Estado `DRAFT`; la fecha no cae en una liquidación `CLOSED`.
2. Al menos una propina y `total_points > 0`.
3. Convertir propinas USD con su cotización (enteros, redondeo half-up).
4. Repartir el total con el motor de cálculo (mayor resto) → `amount_cents` por empleado.
5. Bloquear (`FOR UPDATE`) los adelantos `PENDING` de esos empleados con `date <= fecha del día`; asignarlos **del más antiguo al más nuevo**, hasta `amount_cents` de cada empleado. Crear `advance_applications`, actualizar `applied_cents`/`status`.
6. Escribir ítems con snapshots (`advances_cents`, `final_cents`), totales del día y `status = CLOSED`.

**Anular distribución diaria:** solo `CLOSED` con `settlement_id IS NULL` (o `DRAFT` descartado). Marca `advance_applications.reverted_at`, recalcula `applied_cents` y reabre los adelantos (`PENDING`).

**Anular un adelanto:** solo si no tiene aplicaciones vigentes. Si ya se descontó en algún día, primero se anulan esas distribuciones diarias (paso anterior) y después se anula el adelanto. `VOIDED` es final.

**Cerrar liquidación semanal** (transacción, `FOR UPDATE` sobre el período **antes de calcular**: así calcula con la versión confirmada y un cambio de versión simultáneo espera y después se rechaza):
0. La versión del período no tiene puntos por definir (la configuración estándar nunca los tiene; solo una personalización incompleta bloquea el cierre).
1. Estado `OPEN`; no existen distribuciones `DRAFT` con fechas en `[week_start, week_end]` (se listan para resolverlas primero).
2. Asigna `settlement_id` a todas las `daily_distributions` `CLOSED` de la semana sin liquidación (todos los equipos).
3. Por empleado: `gross = Σ amount_cents`, `advances = Σ advances_cents`, `net = Σ final_cents` → crea `weekly_payment` `PENDING`.
4. Fija totales de la liquidación, `policy_snapshot`, `calc_version` y `status = CLOSED`.

**Anular liquidación semanal:** solo si ningún sobre está `DELIVERED`. Sobres → `VOIDED` (evento `VOIDED` con motivo); distribuciones → `settlement_id = NULL`.

> **Implementado (2026-09-28, `server/periods/service.ts` → `voidPeriod` / `redoPeriod`).** En una transacción: `FOR UPDATE` sobre el período, luego sus sobres (y los adelantos por id, mismo orden que Sobres); si hay algún `DELIVERED` se rechaza; sobres `PENDING`/`PREPARED` → `VOIDED` + evento `VOIDED`; el reparto del período se libera (`settlement_id = NULL`) y pasa a `VOIDED`, sus `advance_applications` reciben `reverted_at` y los adelantos recalculan `applied_cents` y vuelven a `PENDING`; el período pasa a `VOIDED` (`voided_*`) y se registra `period.voided` en `audit_log`. Rehacer crea un `weekly_settlements` nuevo de la misma semana (`revision + 1`, `supersedes_settlement_id`, misma `policy_version_id`); al cerrarlo, cada sobre nuevo lleva `supersedes_payment_id` del sobre anulado de la misma persona (`previously_delivered_cents = 0`: no se anula con entregas vigentes). Solo `OWNER`/`MANAGER`.

**Transiciones de sobre:** `PENDING → PREPARED → DELIVERED`; se permite `PREPARED → PENDING`. `delivered_at` lo fija el servidor (nunca el cliente). Cada transición inserta un `weekly_payment_events`.

**Corrección tras una entrega (flujo completo, nada se modifica en silencio):**
```
Sobre DELIVERED
 → 1. Autorización: solo OWNER/MANAGER (permiso payments.revert)
 → 2. Reversión de la entrega: DELIVERED → PREPARED
        · motivo obligatorio · evento DELIVERY_REVERTED (authorized_by) · fila en audit_log
        · se limpian delivered_at/by (y delivery_note) en la fila; el evento DELIVERED original se conserva
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
| I13 | Los repartos vigentes de un restaurante no se superponen en el tiempo (restricción de exclusión, también bajo concurrencia). Con el único pozo de `SINGLE_POOL`, equivale a "un solo reparto por día o período". Reemplaza a la versión anterior ("`pool_mode = SINGLE ⇔ team_id IS NULL`; no mezclar modos en un día"), retirada junto con `pool_mode` en la revisión 6. |
| I14 | Adelanto de $40.000 con propina de $30.000 → día en $0 y saldo pendiente $10.000 (caso explícito de test). |
| I15 | Una versión de la política no cambia nunca (ni ella ni sus puestos y porciones). |
| I16 | Todo cambio de versión de un período queda en `period_policy_changes`; un período cerrado no cambia de versión y conserva su `policy_snapshot`. |

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
  AND d.date_from >= :week_start AND d.date_to <= :week_end
GROUP BY i.employee_id;
```

### 8.2 Desglose diario del sobre de un empleado
```sql
SELECT d.date_from, d.date_to, SUM(i.amount_cents) AS gross, SUM(i.advances_cents) AS advances, SUM(i.final_cents) AS final
FROM daily_distribution_items i
JOIN daily_distributions d ON d.id = i.daily_distribution_id
WHERE d.settlement_id = :settlement_id AND i.employee_id = :employee_id
GROUP BY d.date_from, d.date_to ORDER BY d.date_from;
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

- Migraciones Prisma versionadas. `CHECK`, índices únicos parciales/por expresión y **triggers de inmutabilidad** se agregan como SQL dentro de la migración (Prisma no los modela). En `apps/web/prisma/sql/`: `constraints.sql` es el **conjunto vigente** (lo usan los tests); `0001_constraints.sql`, `0002_distribution_policies.sql` y `0003_auth.sql` son los deltas que embebe cada migración (congelados una vez aplicados).
- **Migración `20260926000000_distribution_policies`:** guarda explícita (falla con `MIGRATION GUARD` si hay filas en `restaurants`, `positions`, `daily_distributions`, `tip_entries`, `advances`, `weekly_settlements` o `weekly_payments`: cambia columnas y tipos que no tienen conversión sin datos de la política), borra el trigger anti-mezcla, DDL de Prisma (`prisma migrate diff` desde el esquema anterior) y copia literal de `sql/0002_distribution_policies.sql` (que crea la extensión `btree_gist` con `IF NOT EXISTS` para la restricción de exclusión; en Neon está en la lista de extensiones permitidas). Probada en PGlite (`test:db`) y con `prisma migrate deploy` sobre PostgreSQL 18 real (`test:pg`, `migrate diff` vacío). **Aplicada en Neon production** (ver "Estado en Neon" más abajo).
- **Migración `20260928000000_auth` (Fase 2, aplicada en Neon production el 2026-09-27, ver "Estado en Neon — autenticación"):** no destructiva. Guarda explícita (`MIGRATION GUARD` si hay membresías `ADMIN` o emails con mayúsculas: no borra ni reasigna nada por su cuenta) → DDL de Prisma: `membership_role` pasa a `OWNER, MANAGER, EDITOR, VIEWER, SELF` (conversión por texto: las filas existentes conservan su rol), `users.email_verified` (default false) e `image`, `memberships.employee_id`, tablas `sessions`, `accounts`, `verifications`, `auth_rate_limits` → `email_verified = true` donde había `email_verified_at` → copia literal de `sql/0003_auth.sql`. Probada: en PGlite (`test:db`: mismo catálogo que `constraints.sql`; conserva usuario y membresía; guardas), con `prisma migrate deploy` sobre PostgreSQL 18 (`test:pg`, `migrate diff` vacío) y sobre una base local con **los mismos datos que Neon** (usuario sin contraseña, restaurante, OWNER, v1 y v2): tras migrar, mismas filas e ids, v2 vigente, Salón 0,022 → 0,025, `migrate status` al día y `migrate diff` vacío.
- **Migración inicial:** `apps/web/prisma/migrations/20260925000000_init/migration.sql` = DDL generado por Prisma (`prisma migrate diff --from-empty`, sin editar) + copia literal de `sql/0001_constraints.sql` al final. Una migración aplicada no se edita: cualquier cambio posterior va en una migración nueva. `test-db/migrations.test.ts` verifica que la migración contiene el SQL de restricciones y que aplicar las migraciones en orden produce exactamente el mismo catálogo (columnas, restricciones, índices, triggers, funciones y enums) que la base usada por los demás tests.
- **Verificación de la migración (sin Neon):** se aplicó con `prisma migrate deploy` sobre un PostgreSQL 18.3 local y temporal (PGlite por socket) y `prisma migrate diff` desde esa base hacia `schema.prisma` resultó **vacío**: Prisma no intenta eliminar los índices parciales/por expresión, los CHECK ni los triggers. Desde 2026-09-25 lo mismo se comprueba en cada corrida de `pnpm test:pg` sobre un PostgreSQL real (ver abajo). La migración inicial está **aplicada en Neon** (PostgreSQL 18.6) y verificada sin drift el 2026-09-26.
- **Estado de verificación (Fase 0):** el esquema Prisma pasó `prisma validate` y `prisma generate`. Los tests de base de datos (`pnpm test:db`, carpeta `apps/web/test-db/`, también en el CI) ejecutan el DDL que Prisma genera desde `schema.prisma` (`prisma migrate diff`, sin duplicar tablas a mano) más `0001_constraints.sql` sobre **PGlite** (hoy: DDL + `constraints.sql`), y comprueban CHECK, índices únicos (incl. parciales y por expresión), claves foráneas, triggers de inmutabilidad, estados de distribución/liquidación/sobre, adelantos y bitácoras de solo inserción. No reimplementan reglas de negocio: insertan filas y verifican que PostgreSQL las acepta o rechaza. Cada test corre en una transacción que se revierte.
- **Limitaciones de PGlite (no es idéntico a un PostgreSQL de producción):**
  - Es PostgreSQL compilado a WebAssembly (32 bits) que corre dentro del proceso de Node, con **una única conexión**. Por eso `test:db` **no puede probar concurrencia**: bloqueos (`SELECT … FOR UPDATE`), condiciones de carrera, niveles de aislamiento, deadlocks ni la invariante I11 (adelanto aplicado desde dos cierres simultáneos). Eso lo cubre `test:pg` (siguiente punto).
  - Versión: PGlite 0.5.8 incluye PostgreSQL 18.3. Neon ofrece PostgreSQL 18.6 (misma versión mayor). Las funciones usadas son básicas (enums, CHECK, índices parciales y por expresión, triggers PL/pgSQL, operadores `jsonb`, `gen_random_uuid()`), pero la compatibilidad entre versiones no está probada.
  - No cubre: extensiones, roles y permisos, RLS, pooling de conexiones (PgBouncer), locale/collation/zona horaria del servidor, rendimiento, ni el flujo real de migraciones (`prisma migrate dev/deploy`): el DDL sale de `prisma migrate diff`, no de aplicar migraciones.
  - Los tests comprueban nombres de restricciones y prefijos propios de los mensajes (`IMMUTABLE:`, `INVALID_TRANSITION:`, `RULE:`); los textos de errores nativos de PostgreSQL (p. ej. claves foráneas) pueden variar entre versiones.
- **Tests contra PostgreSQL real (`pnpm test:pg`, carpeta `apps/web/test-pg/`):** requieren `TEST_DATABASE_URL` apuntando a un servidor PostgreSQL **descartable** con permiso `CREATEDB` (se rechazan hosts de Neon). Cada corrida crea una base temporal, le aplica las migraciones con `prisma migrate deploy` (el flujo real) y la borra al terminar. Cada test crea su propio restaurante, porque las transacciones se confirman y los triggers impiden borrar filas. Cubren (19 tests):
  - **Migraciones:** `prisma migrate diff` entre la base migrada y `schema.prisma` es vacío.
  - **I11 con `FOR UPDATE`:** dos cierres simultáneos que aplican el mismo adelanto; el segundo espera al primero y aplica solo el saldo (adelanto de $40.000, dos días de $30.000 → $30.000 + $10.000). También: el primero consume todo (el segundo ya no lo ve `PENDING`) y el primero se revierte (el segundo aplica completo). Si se quita el `FOR UPDATE`, estos tests fallan.
  - **Qué garantiza la base sin el bloqueo del servicio:** un incremento relativo (`applied_cents + x`) lo frena `ck_advances_applied_range`; en cambio, leer y escribir un valor absoluto sin bloquear pierde una actualización y rompe I4/I11 sin que la base lo detecte. Por eso el servicio **debe** usar `FOR UPDATE` (§6, paso 5).
  - **Cierre simultáneo de la misma distribución:** con `FOR UPDATE` el segundo espera y la ve `CLOSED`.
  - **I13 bajo concurrencia:** un `DAY` y un `PERIOD` superpuestos (distinto inicio) o dos repartos del mismo día creados a la vez → el segundo espera y falla (`ex_daily_distributions_no_overlap`) y queda solo el primero; si el primero se revierte, el segundo se crea; en `REPEATABLE READ` tampoco se confirman los dos; períodos contiguos no se bloquean entre sí.
  - **Índices únicos bajo concurrencia:** dos liquidaciones vigentes de la misma semana creadas a la vez → la segunda espera y falla (`ux_weekly_settlements_active`).
  - **Política:** dos versiones con el mismo número a la vez → la segunda falla; los puestos de una versión confirmada no se agregan desde otra transacción; el registro de un cambio de versión no autoriza el cambio desde otra transacción.
  - **Cierre vs. cambio de versión:** si el cierre va primero, el cambio espera y se rechaza (período ya `CLOSED`, sin registro huérfano); si el cambio va primero, el cierre (que bloquea el período antes de calcular) espera y cierra con la versión nueva. Horas cargadas durante un cierre: el cierre espera; después las horas se rechazan.
- **CI:** el job `postgres` de `.github/workflows/ci.yml` corre `pnpm test:pg` sobre un contenedor **PostgreSQL 18** (misma versión mayor que Neon 18.6, para aproximar ese entorno). No se conecta a Neon. Localmente también se verificó sobre PostgreSQL 16.
- **Estado en Neon (2026-09-26):** las dos migraciones están aplicadas en **production** (PostgreSQL 18.6).
  - **Validación previa en la branch `test-distribution-policies`** (creada desde production con esquema y datos, es decir, con `init` aplicada y tablas vacías): `migrate deploy` sin errores (incluida `CREATE EXTENSION btree_gist`), `migrate status` al día, `migrate diff` vacío, catálogo idéntico al de la base de los tests (columnas, restricciones, índices, triggers, funciones y enums) y prueba de la restricción de exclusión con datos ficticios dentro de una transacción revertida (solapamientos rechazados con `23P01`, rangos contiguos y otro restaurante aceptados; sin filas al terminar). La branch quedó sin datos.
  - **Production:** antes de migrar se verificó que no era la branch de prueba, que tenía solo `20260925000000_init` y 0 filas de negocio. `prisma migrate deploy` aplicó `20260926000000_distribution_policies` sin errores; `prisma migrate status`: "Database schema is up to date!" (2 migraciones, terminadas y sin rollback); `prisma migrate diff` contra `schema.prisma`: vacío. Catálogo idéntico a la base de los tests: 22 tablas (incluidas `distribution_policy_versions`, `policy_version_positions`, `period_policy_changes`, `period_hours`), 21 enums, 60 FK, 52 CHECK, 26 triggers (ninguno deshabilitado), 32 índices sin contar PK, restricción de exclusión `ex_daily_distributions_no_overlap` con su índice GiST, extensión `btree_gist` 1.8; ninguna restricción sin validar. **Sin datos de negocio**: no se insertaron datos de prueba, ni seed, ni se corrió `test:pg` en production.
- **Estado en Neon — autenticación (2026-09-27):** `20260928000000_auth` **aplicada en production** (3 migraciones).
  - **Validación previa en la branch `auth-test`** (creada desde production con sus datos: OWNER, restaurante, política v1/v2): guardas en solo lectura (endpoint distinto de production, exactamente 2 migraciones previas, datos idénticos a production, 0 `ADMIN`, emails en minúsculas) → `prisma migrate deploy` por conexión directa → `migrate status` al día, `migrate diff` vacío, tablas/índices/FK/CHECK/triggers nuevos presentes, 0 triggers deshabilitados y 0 restricciones sin validar, y huella de datos (filas + hash por tabla de las 22 tablas previas) idéntica antes y después.
  - **Production:** mismas guardas (branch y endpoint de production, 2 migraciones previas, OWNER y membresía OWNER, v2 vigente, Salón 0,025, 0 `ADMIN`) y `migrate diff` vacío contra el esquema anterior; luego `pnpm --filter @propinas/web exec prisma migrate deploy`. Después: `migrate status` "up to date", `migrate diff` vacío contra `schema.prisma`, 27 tablas, 63 FK, 55 CHECK, 28 triggers (ninguno deshabilitado), `sessions`/`accounts`/`verifications`/`auth_rate_limits` creadas, enum `OWNER, MANAGER, EDITOR, VIEWER, SELF`, y huella de datos **idéntica**: mismos usuarios, membresía OWNER, restaurante y versiones v1/v2.
  - **Better Auth habilitado sobre production:** el OWNER existente recibió su credencial con `db:operator-password --confirm --allow-remote` (contraseña ingresada por teclado; en la base solo el hash scrypt, 1 cuenta `credential`, sin usuarios duplicados). **Login real verificado** desde la app local (`GUTIP_DATA_SOURCE=database`, `BETTER_AUTH_URL=http://localhost:3000`, secreto local propio) contra Neon production: se creó exactamente 1 sesión, `/cuenta` mostró usuario, restaurante y rol Dueño, `/configuracion` leyó la política real (v2 vigente: Supervisor 0,014 · Barra 0,022 · Salón 0,025 · Bacha 0,007) y el logout borró la sesión (0 sesiones). La app **todavía no está desplegada** (Vercel pendiente, con su propio `BETTER_AUTH_SECRET`).
- **Próximas migraciones:** mismo procedimiento (branch de prueba de Neon → verificación → production), solo con autorización explícita. En Neon conviene `migrate deploy`; `migrate dev` necesita una base *shadow* (usar una rama de Neon aparte). `test:pg` no reemplaza verificar Neon en sí (roles, pooling, extensiones, configuración del proveedor).
- **Límites conocidos de las restricciones en base de datos:** la invariante I1 (Σ ítems = total) y I4 (`applied_cents` = Σ aplicaciones vigentes) no se pueden expresar con un CHECK; las garantiza el servicio dentro de su transacción y el motor de cálculo. "La versión no tiene puntos por definir" (bloqueo del cierre) la valida el servicio.
- **No hay seed automático.** No existe `prisma/seed.ts` ni `prisma.seed` en `package.json`, así que `migrate dev/reset` no insertan nada. Para inicializar un restaurante de desarrollo se usa `db:bootstrap` (§11), que se ejecuta solo a mano.

---

## 11. Acceso desde la aplicación (Fase 1, política de distribución)

Primera pantalla con persistencia real: **"Configuración de distribución"**. Las demás pantallas siguen en la demo del navegador (`localStorage`).

**Capas** (`apps/web/src/server/`, solo servidor; ningún componente de la interfaz importa Prisma):
- `db.ts`: cliente Prisma (conexión desde `DATABASE_URL`, nunca en el código).
- `auth/`: Better Auth (`auth.ts`), sesión del pedido (`session.ts`) y contraseña de usuarios existentes (`credentials.ts`). `access/`: `requireAccess` (sesión + membresía + rol), matriz de roles y alcance de SELF. `context.ts`: solo el switch de fuente de datos.
- `policy/repository.ts`: **lecturas**, todas con `restaurantId` en el filtro: restaurante, versión vigente, una versión con sus puestos y porciones, historial, períodos `CLOSED` por versión y personas activas por puesto. Las porciones `NUMERIC(20,10)` se convierten a texto exacto (sin floats).
- `policy/service.ts`: **escrituras**, cada una en **una transacción** que empieza con `SELECT … FROM restaurants … FOR UPDATE` (dos cambios simultáneos se ordenan: versiones 2 y 3 encadenadas, probado en `test:pg`):
  - *Cambiar un parámetro, agregar un puesto o cambiar una porción*: inserta la versión `n + 1` (`CHANGE`, `previous_version_id`, `summary`, `created_by`) con **todos** sus puestos, actualiza `restaurants.current_policy_version_id` y pasa cada período `OPEN` que no reemplaza a otro (`supersedes_settlement_id IS NULL`) a la versión nueva, con su fila automática en `period_policy_changes`. Un período reabierto (revisión que reemplaza a otra) conserva su versión. Nunca hace `UPDATE` de una versión (además, la base lo rechaza).
  - *Agregar un puesto*: crea su identidad en `positions` (o reutiliza la del mismo nombre, sin distinguir mayúsculas) y su porción en la versión nueva.
  - *Renombrar un puesto*: cambia `positions.name` y **no** crea versión (el servicio existe; la pantalla todavía no lo ofrece).
  - Las validaciones y mensajes son las mismas funciones puras que usa la demo (`src/lib/policy/changes.ts`).
- `app/configuracion/actions.ts`: acciones del servidor. Resuelven el acceso en cada llamada (el navegador nunca manda el restaurante ni el usuario) y llaman al servicio.

**Fuente de datos y acceso (Fase 2).** Sin `GUTIP_DATA_SOURCE=database` la pantalla usa la demo y no toca la base. Con esa variable exige **sesión** (Better Auth) y resuelve el acceso con `requireAccess`/`resolveAccess`: restaurante activo del usuario verificado contra `memberships`, rol que puede ver (OWNER, MANAGER, EDITOR, VIEWER) y, para cambiar, rol que puede configurar (OWNER, MANAGER). Las acciones del servidor vuelven a verificar todo en cada llamada (`server/policy/commands.ts`). `GUTIP_OPERATOR_EMAIL` y `GUTIP_RESTAURANT_ID` ya **no** intervienen en la autorización: solo los usa `db:bootstrap`.

**Bootstrap (`pnpm --filter @propinas/web db:bootstrap --confirm`)**, `apps/web/scripts/bootstrap-restaurant.ts`, idempotente, en una transacción:
- usuario dueño (`GUTIP_OPERATOR_EMAIL` / `GUTIP_OPERATOR_NAME`) si no existe (si existe se reutiliza: nunca se duplica); queda compatible con Better Auth pero **sin contraseña**;
- restaurante `GUTIP_RESTAURANT_ID` (`GUTIP_RESTAURANT_NAME`) si no existe;
- membresía `OWNER` del dueño si no existe (si el restaurante ya tiene **otro** dueño, falla sin crear nada);
- si el restaurante no tiene política: versión 1 `STANDARD` (`template_code = 'gutip-standard'`, `template_version = 1`, lunes como inicio) con los puestos estándar Supervisor 0,014 · Barra 0,022 · Salón 0,022 · Bacha 0,007, y `current_policy_version_id`.
No crea personal, períodos ni datos de negocio. Exige `--confirm`; se niega con `NODE_ENV=production`; contra una base no local exige `--allow-remote`; nunca imprime la URL ni el host (ante un error muestra solo el tipo). Probado en PostgreSQL local. **Neon production inicializado el 2026-09-27** (restaurante, OWNER y política v1; después v2 desde la pantalla).

**Contraseña del dueño (`pnpm --filter @propinas/web db:operator-password --confirm [--allow-remote] [--reset]`)**, `apps/web/scripts/operator-password.ts`: agrega la cuenta `credential` (hash scrypt de Better Auth) al usuario **existente** de `GUTIP_OPERATOR_EMAIL`; no crea usuarios. La contraseña se pide por teclado sin eco (o por stdin), nunca en argumentos ni variables. Si ya tiene contraseña exige `--reset`, que además cierra sus sesiones. Mismas protecciones que `db:bootstrap`. Es el camino del dueño que ya existe en Neon hacia el login, sin duplicarlo.

**Tests:** `test:pg` (`test-pg/policy-service.test.ts`, con Prisma contra PostgreSQL real): bootstrap estándar e idempotente (también dos a la vez), lectura de la vigente, versión nueva al cambiar porción/parámetro/puesto, versión anterior inmutable, puntero actualizado, historial con períodos cerrados, puesto estable con porción distinta entre versiones, renombrar sin versión, transacción revertida sin restos, cambios simultáneos encadenados, período abierto vs. reabierto con `period_policy_changes`, y aislamiento entre restaurantes (ids de otro restaurante rechazados, acceso sin membresía rechazado).

**Tests de acceso (Fase 2):** `test-pg/access.test.ts` — sin sesión (UNAUTHENTICATED), autenticado sin membresía / restaurante inexistente / id mal formado / archivado (NOT_FOUND), contexto tipado, cada rol en Configuración (OWNER y MANAGER ven y cambian; EDITOR y VIEWER ven, cambiar = FORBIDDEN sin escribir nada; SELF no ve), acción del servidor sin permiso llamada directo, otro restaurante (404 aunque se conozca el id; puesto ajeno rechazado), usuario en varios restaurantes con roles distintos, restaurante activo por cookie solo si es miembro, SELF limitado a su empleado, alta de restaurante con OWNER automático, OWNER único y bootstrap sin segundo dueño. `test-pg/auth.test.ts` — Better Auth de punta a punta sobre nuestras tablas: dueño de db:bootstrap sin contraseña → `db:operator-password` → login con el MISMO usuario → sesión → acceso real; reset que cierra sesiones; cookie httpOnly/SameSite=Lax (Secure solo en producción); cookie manipulada; logout borra la sesión; registro público deshabilitado; CSRF (cookie desde otro origen → 403); límite de intentos por IP. `test-db/access.test.ts` — restricciones de memberships y tablas de Better Auth en la base.
