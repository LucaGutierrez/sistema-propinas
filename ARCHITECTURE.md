# ARCHITECTURE.md — Sistema de Propinas

Aplicación web para gestionar y distribuir propinas entre el personal de restaurantes, reemplazando las planillas de Excel.

Estado: **Fase 0 implementada** (motor de cálculo, tests, esquema Prisma, SQL de restricciones, CI). **Fase 1 en curso** como demo en el navegador (ver `PROGRESS.md` §6.2). Revisión 6: principio de configuración de distribución por restaurante (§2, principio 7, y §2.1).
El esquema completo está en [`DATABASE.md`](DATABASE.md); este documento explica arquitectura, flujo y decisiones.

---

## 1. El flujo real del negocio (base de todo el diseño)

> **Nota (2026-09-26):** cuándo se calcula (por día o por período), qué horas se usan y cada cuánto se paga **no son reglas del sistema sino configuración de cada restaurante** (§2, principio 7, y §2.1). El flujo de abajo es el modelo de la Fase 0; se mantiene como uno de los modos posibles.

La propina **se calcula por día** pero **se paga por semana**. Son tres conceptos distintos, y ninguno reemplaza a otro:

| Concepto | Qué hace | Unidad de… |
|---|---|---|
| **DAILY DISTRIBUTION** (distribución diaria) | Calcula la propina de un día: reparte el pozo entre quienes trabajaron según horas × peso. | **Cálculo** |
| **WEEKLY SETTLEMENT** (liquidación semanal) | **Acumula** las distribuciones diarias cerradas de la semana. No recalcula: suma. | Acumulación |
| **WEEKLY ENVELOPE / PAYMENT** (sobre) | El dinero que se prepara y se entrega a cada empleado, con estado y registro de entrega. | **Pago** |

```
LOGIN → RESTAURANTE → EQUIPO → PERSONAL
   → DISTRIBUCIÓN DIARIA → CÁLCULO → CERRAR DÍA        (se repite todos los días)
   → ACUMULACIÓN SEMANAL → LIQUIDACIÓN SEMANAL
   → PREPARAR SOBRES → ENTREGAR SOBRES                 (una vez por semana)
```

**Cada día se registra:** fecha, equipo, propina recibida (ARS y/o USD), cotización utilizada, empleados que trabajaron, horas, peso del puesto, puntos, porcentaje, importe bruto, adelantos e importe final.

**Ejemplo ilustrativo (no se usa como caso de test):** Roro: Lun $63.747 · Mar $70.000 · Mié $58.200 · Jue $72.400 · Vie $91.300 · Sáb $84.600 · Dom $76.200 → total semanal $516.447. Bandeja de sobres: Roro → $516.447 · Leo → $623.450 · Marcos → $184.320 …

### 1.1 Estructura del pozo (parámetro de la política)

Cómo se arma el pozo es un **parámetro de la política de distribución** de cada restaurante (`pool_structure`), no una columna suelta del restaurante ni de cada reparto. Hoy GUTIP implementa `SINGLE_POOL` (un pozo para todo el restaurante), que es lo que usa la configuración estándar. Otras estructuras (por ejemplo, un pozo por equipo o porcentajes por grupo) se agregan como opciones nuevas del parámetro cuando se implementen y se validen con casos reales.

- **El motor de cálculo reparte un pozo y no sabe nada de equipos.** La capa de servicios decide cuántos pozos hay según la versión de la política del período.
- La liquidación suma por empleado. Cambiar la política crea una versión nueva y no altera los períodos cerrados.
- Hasta la revisión 5 del modelo había `restaurants.pool_mode` (`SINGLE`/`PER_TEAM`) y `daily_distributions.team_id`; se retiraron en la revisión 6 (la base de Neon estaba vacía, así que no hubo datos que convertir).

### 1.2 Corrección de errores después de entregar un sobre

Nada se corrige en silencio ni compensando la semana siguiente. El flujo es:

`Entrega realizada → autorización (OWNER/ADMIN) → reversión de la entrega (motivo obligatorio, auditoría) → anulación de la liquidación → corrección de los días afectados → re-liquidación (nueva revisión) → nuevo importe → nueva entrega`

Todo queda en `weekly_payment_events` (bitácora inmutable) y en `audit_log`: quién, cuándo, por qué, importes anterior y nuevo. Detalle en `DATABASE.md` §6.

---

## 2. Principios de diseño

1. **Exactitud monetaria.** Nunca `float`. Enteros (centavos) y aritmética entera/`BigInt`.
2. **Historial inmutable.** Una distribución `CLOSED` no se modifica jamás: se anula (`VOIDED`) y se rehace. Guarda nombres, puestos, pesos, horas, puntos, porcentajes, cotizaciones, adelantos y resultados vigentes en ese momento.
3. **Motor de cálculo independiente.** Un paquete de TypeScript puro, sin Next.js, Prisma, React ni base de datos.
4. **Multi-restaurante desde el día 1** (`restaurant_id` en todo).
5. **Roles previstos, no implementados.** El modelo tiene membresías con rol; el MVP opera con `OWNER` pero el código ya consulta permisos.
6. **Simple y gratuita de operar.** Un repositorio, un despliegue, servicios con capa gratuita.
7. **Cada restaurante configura cómo reparte sus propinas** (2026-09-26). GUTIP no se diseña alrededor de la planilla de un restaurante: tiene **reglas estructurales** (iguales para todos, no negociables) y **parámetros de distribución** que elige cada restaurante. La configuración de un restaurante solo afecta a ese restaurante, y cada cierre guarda la configuración con la que se calculó, así que cambiarla nunca altera el historial. **Library (Hotel Faena)** es el caso de referencia: GUTIP tiene que poder reproducirlo exactamente, pero Library es *una configuración*, no el producto. Lo que todavía no sabemos de un restaurante queda como **configuración pendiente**, nunca como una regla inventada.

### 2.1 Reglas estructurales vs. parámetros configurables

**Estructurales** (el sistema las garantiza para todos los restaurantes):

| Regla | Por qué no se configura |
|---|---|
| Dinero exacto en enteros (centavos), sin floats | Evita errores de redondeo invisibles |
| El reparto suma **exactamente** el pozo; si la unidad de redondeo deja un sobrante, su destino es explícito | Nunca aparece ni desaparece plata |
| Un cierre es inmutable; se corrige anulando (con motivo) y rehaciendo; todo queda auditado | Confianza y trazabilidad |
| Cada cierre guarda un **snapshot** de datos y de la configuración usada | Cambiar la configuración no reescribe el pasado |
| Un sobre nunca es negativo | Protege al empleado |
| Adelantos y sobres no se borran: se anulan / revierten con motivo, quién y cuándo | Auditoría |
| Aislamiento total entre restaurantes (datos y configuración) | Multi-restaurante |
| Mismo cálculo para vista previa y cierre (motor puro y determinista) | Lo que se ve es lo que se paga |
| USD: la cotización usada se copia al registro | Historial estable |
| Permisos por restaurante y por persona, verificados en el servidor | Seguridad |

**Configurables por restaurante** (parámetros de distribución; entre paréntesis, lo que sabemos de Library):

| Parámetro | Opciones posibles | Library |
|---|---|---|
| Período de liquidación / pago | semanal, quincenal, mensual (+ día de inicio) | Semanal — *confirmado* |
| Cuándo se reparte | una vez por período con el pozo acumulado · cada día | Una vez por semana — *confirmado* |
| Qué horas se usan | total del período · del día · acumuladas hasta la fecha | Total de la semana — *confirmado* |
| Cómo se cargan las horas | total al cerrar · por día | Total al cerrar — *confirmado* |
| Fuentes del pozo | efectivo, tarjeta, recepción, cocina… (sumadas o separadas) | Efectivo; Recepción y Cocina — *pendiente* |
| Grupos y porcentajes | sin grupos · % por grupo (+ qué pasa si un grupo no trabajó) | Sin grupos según la planilla — *sin confirmar* |
| Peso de cada hora | por puesto · por puesto con excepción por persona · por persona; escala del valor | Por puesto con excepciones en Bacha según la planilla — *sin confirmar* |
| Redondeo | centavo · peso · $10 · $100; destino del sobrante | Pesos enteros según la planilla — *sin confirmar* |
| Descuento de adelantos | todo el período · desde su fecha · a elección / en cuotas | *pendiente* |
| Adelanto que no alcanza a descontarse | pasa como saldo al período siguiente · otras políticas a definir con casos reales | Pasa al período siguiente (decisión de la Fase 0) — *pendiente de confirmar*; **no es regla estructural** (2026-09-26) |
| Quién prepara y entrega sobres | solo Encargado · Encargado y Editor · rol "Pagador" | *pendiente* |

**Combinaciones que dependen entre sí:** "desde su fecha" en adelantos solo tiene sentido si se reparte por día; horas "del día" exigen cargar horas por día; un % por grupo exige definir grupos y la política para un grupo vacío. La configuración valida estas combinaciones.

**Modelo detallado:** [`CONFIG-MODEL.md`](CONFIG-MODEL.md) (aprobado 2026-09-26): política versionada por restaurante que arranca con la configuración estándar de GUTIP; cada período se fija a una versión y cada cierre guarda la versión y una copia de los valores. **Persistencia** (2026-09-26, `DATABASE.md` rev. 6): `distribution_policy_versions` (un parámetro por columna, enums con solo las opciones implementadas), `policy_version_positions` (porción de cada puesto en la versión), `period_policy_changes` (bitácora de cambios de versión de un período) y `period_hours`. La configuración estándar vive en el código y cada versión que sale de ella registra `template_code`/`template_version`. Migración aplicada en Neon production el 2026-09-26 (validada antes en una branch de prueba; ver `DATABASE.md` §10).

---

## 3. Arquitectura general

Monorepo con dos piezas: la **aplicación web** (Next.js) y el **motor de cálculo** (paquete puro).

```
┌───────────────────────────────────────────────────────────┐
│ Navegador (React)                                         │
└──────────────┬────────────────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────────────────┐
│ apps/web  (Next.js, App Router)                           │
│  UI → Server Actions/Route Handlers (Zod) → services      │
│        services: autorización, transacciones, orquestación│
│        adapters: filas Prisma ⇄ tipos del motor           │
│        repositories: Prisma                               │
└───────┬───────────────────────────────────┬───────────────┘
        │ importa                           │
┌───────▼──────────────┐          ┌─────────▼────────────────┐
│ packages/tip-engine  │          │ PostgreSQL (Neon/Supabase)│
│ TS puro, sin deps    │          └──────────────────────────┘
│ BigInt, sin I/O      │
└──────────────────────┘
```

Reglas de dependencia: `UI → actions → services → (tip-engine, repositories)`. **`tip-engine` no importa nada** del resto (ni `next`, ni `@prisma/client`, ni `react`). Se refuerza con: paquete separado sin dependencias en su `package.json`, regla ESLint `no-restricted-imports` y un chequeo en CI que falla si aparece una dependencia.

Por qué monolito: producto gratuito con equipo chico; dos despliegues duplican trabajo. Si más adelante hace falta app móvil o API pública, los `services` se exponen por Route Handlers sin reescribir lógica.

---

## 4. Stack tecnológico

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | **TypeScript** strict | Tipos de punta a punta |
| Monorepo | **pnpm workspaces** | `apps/web` + `packages/tip-engine` |
| Framework | **Next.js 15 (App Router)** | Full-stack, deploy gratuito |
| UI | **Tailwind + shadcn/ui** | Profesional y accesible |
| Formularios | **React Hook Form + Zod** | Un esquema valida cliente y servidor |
| Base de datos | **PostgreSQL** | Transacciones, `CHECK`, triggers, índices parciales |
| ORM | **Prisma** (+ SQL en migraciones) | Tipos y migraciones; triggers/CHECK en SQL |
| Auth | **Auth.js v5** (email + contraseña, Google opcional) | Estándar |
| Contraseñas | **argon2id** | Práctica recomendada |
| Motor de cálculo | **TypeScript + `BigInt`, cero dependencias** | Sin floats ni librerías decimales (ver §7) |
| Tests | **Vitest** (+ fast-check para propiedades) y **Playwright** (E2E) | Foco en el motor |
| Hosting | **Vercel + Neon** (o Supabase como Postgres) | Capa gratuita |
| CI | GitHub Actions: lint, typecheck, tests, chequeo de pureza del motor | |

Idioma: UI en **español (es-AR)**; código y esquema en inglés. Zona horaria: `America/Argentina/Buenos_Aires`.

**Versiones fijadas en la Fase 0 (y por qué):**
- **TypeScript 6.x**, no 7: `typescript-eslint` todavía no soporta TypeScript 7 y ESLint no arrancaba. Revisar al actualizar `typescript-eslint`.
- **Prisma 6.x**, no la serie 7/8: se evitan cambios de configuración de las versiones nuevas hasta la Fase 1.
- **pnpm 12.6** (campo `packageManager`), Node ≥ 24, Vitest 5, ESLint 10. pnpm bloquea los scripts de instalación por defecto; `pnpm-workspace.yaml` autoriza solo `prisma`, `@prisma/client` y `@prisma/engines` (`allowBuilds`).

---

## 5. Estructura de carpetas

```
sistema-propinas/
├─ ARCHITECTURE.md · DATABASE.md · README.md
├─ pnpm-workspace.yaml
├─ reference/                       # Excel original del restaurante (fuente de los tests)
├─ packages/
│  └─ tip-engine/                   # ★ Motor puro (sin Next/Prisma/UI)
│     ├─ package.json               #   sin dependencies
│     ├─ src/
│     │  ├─ money.ts                #   parseo/formato seguro, redondeo half-up
│     │  ├─ fixed.ts                #   decimales de escala fija sobre BigInt
│     │  ├─ exchange.ts             #   USD → ARS
│     │  ├─ daily-distribution.ts   #   puntos, mayor resto, adelantos
│     │  ├─ advances.ts             #   asignación FIFO de adelantos y saldo
│     │  ├─ weekly-settlement.ts    #   acumulación semanal y sobres
│     │  ├─ week.ts                 #   rango de semana para una fecha
│     │  ├─ types.ts
│     │  ├─ errors.ts               #   EngineError con códigos tipados
│     │  └─ index.ts
│     ├─ tsconfig.src.json          #   compila src/ SIN tipos de Node ni DOM
│     └─ test/
│        ├─ *.test.ts               #   un archivo por módulo
│        ├─ properties.test.ts      #   propiedades aleatorias (fast-check)
│        ├─ purity.test.ts          #   src/ sin Number/Math/Date/floats/imports externos
│        ├─ excel-reference.test.ts #   it.todo hasta tener el .xlsx real en reference/
│        └─ helpers.ts
├─ apps/
│  └─ web/
│     ├─ prisma/ (schema.prisma, migrations/ con SQL de CHECK/triggers, seed.ts)
│     ├─ src/
│     │  ├─ app/
│     │  │  ├─ (auth)/login, register
│     │  │  └─ (app)/
│     │  │     ├─ dashboard/
│     │  │     ├─ teams/            # equipos + puestos y pesos
│     │  │     ├─ employees/        # personal
│     │  │     ├─ advances/
│     │  │     ├─ daily/            # distribuciones diarias (lista, nueva, [id])
│     │  │     ├─ weeks/            # liquidaciones semanales ([id]: matriz + sobres)
│     │  │     ├─ envelopes/        # sobres por preparar/entregar
│     │  │     ├─ exchange-rates/
│     │  │     └─ settings/
│     │  ├─ components/ (ui/, features/)
│     │  ├─ actions/                # Server Actions (Zod → services)
│     │  ├─ server/
│     │  │  ├─ db.ts · auth.ts · permissions.ts
│     │  │  ├─ services/            # casos de uso transaccionales
│     │  │  ├─ adapters/            # Prisma ⇄ tip-engine
│     │  │  └─ repositories/
│     │  ├─ schemas/ (Zod)
│     │  └─ lib/ (formato es-AR, fechas)
│     └─ e2e/
└─ .github/workflows/ci.yml
```

---

## 6. Modelo de datos (resumen; detalle en `DATABASE.md`)

- **Acceso:** `users`, `restaurants`, `memberships` (rol).
- **Catálogos:** `teams`, `positions` (identidad estable del puesto; equipo opcional), `employees` (no versionados), `exchange_rates`.
- **Política versionada:** `distribution_policy_versions` (parámetros tipados, solo inserción), `policy_version_positions` (porción de cada puesto, `NUMERIC(20,10)`); `restaurants.current_policy_version_id` es la vigente.
- **Distribución:** `daily_distributions` (`DRAFT|CLOSED|VOIDED`, alcance `DAY` o `PERIOD` con `date_from`/`date_to`, sin superposición garantizada por una restricción de exclusión incluso ante concurrencia, totales ARS/USD), `tip_entries` (fecha de la propina, ARS/USD + cotización usada), `daily_distribution_items` (empleado, puesto, porción, horas, puntos, %, bruto, adelantos, final; todo en *snapshot*).
- **Adelantos:** `advances` (con saldo pendiente y datos de anulación) + `advance_applications`.
- **Liquidación (período):** `weekly_settlements` (`OPEN|CLOSED|VOIDED`, fijada a una versión de la política; al cerrar guarda `policy_snapshot` y `calc_version`), `period_policy_changes`, `period_hours`.
- **Sobres:** `weekly_payments` (`PENDING|PREPARED|DELIVERED`, quién y cuándo entregó) + `weekly_payment_events` (historia inmutable de cada cambio, incluidas reversiones con motivo).
- **Email/seguridad:** `auth_tokens` (verificación y recuperación), `rate_limits`.
- **Auditoría:** `audit_log`.

Vínculo entre niveles: `daily_distributions.settlement_id` (null hasta cerrar la semana). La liquidación **referencia y suma**; no copia ni recalcula los cálculos diarios.

**Inmutabilidad reforzada en tres capas:** servicios, triggers en PostgreSQL y política de "anular y rehacer". Un `CLOSED` no se edita nunca.

---

## 7. Motor de cálculo (`packages/tip-engine`)

### 7.1 Independencia
TypeScript puro, funciones puras, sin I/O, sin reloj, sin azar, sin dependencias. Entrada y salida son objetos simples (`bigint` y `string`). La app traduce filas de Prisma a tipos del motor y viceversa en `server/adapters/`. La vista previa en pantalla y el cierre del día usan **la misma función**; al cerrar, el servidor **recalcula** y no confía en valores del cliente.

### 7.2 Aritmética segura (sin floats ni librerías decimales)
Todo se representa como entero escalado:

| Dato | Representación |
|---|---|
| Dinero | centavos, `bigint` |
| Horas y peso | ×100 (`7,5 h` → `750n`; `1,50` → `150n`) |
| Puntos | `horas×100 · peso×100` → escala 10⁴, entero exacto |
| Cotización | ×10⁶ (`1180,50` → `1180500000n`) |

Los valores llegan como `string` (`"7.5"`, `"1180.50"`) y se parsean con un parser propio: **nunca pasan por `Number`**. Se rechazan más decimales de los permitidos en vez de redondearlos en silencio.

### 7.3 Algoritmos

**Conversión USD → ARS** (por cada propina):
`ars_cents = round_half_up(usd_cents × rate_e6 / 10⁶)`. Se redondea una vez por propina y se guarda la cotización usada.

**Reparto diario** (mayor resto, exacto):
```
P      = Σ puntos_i                              (entero)
num_i  = total_cents × puntos_i
base_i = num_i / P            (división entera)
resto_i= num_i mod P
sobran = total_cents − Σ base_i                  (0 ≤ sobran < N)
→ +1 centavo a los `sobran` empleados con mayor resto_i
  (desempate determinista: mayor puntos_i, luego employeeId ascendente)
```
Garantía: `Σ bruto_i = total_cents` **siempre**. El porcentaje (`puntos_i / P`) se calcula solo para mostrar/guardar; **el monto nunca se deriva de un porcentaje redondeado**.

**Adelantos** (al cerrar el día, por empleado):
- Se toman sus adelantos `PENDING` con fecha ≤ día, del más antiguo al más nuevo.
- `descontado = min(bruto, Σ saldos)`; `final = bruto − descontado` (nunca negativo).
- Si el adelanto supera lo disponible, **se aplica hasta donde alcanza** y el resto queda como **saldo pendiente** del mismo adelanto, aplicable en los próximos cierres y por lo tanto en futuras liquidaciones.

**Liquidación semanal:** suma por empleado de `bruto`, `adelantos` y `final` de los ítems de sus distribuciones diarias cerradas de la semana, con el desglose por día. No hay redondeo (todo ya es entero).

### 7.4 Casos de prueba
**Regla:** los números de ejemplo de la conversación son ilustrativos y **no** se convierten en tests. Los tests usan **casos explícitos, calculados a mano y coherentes con la fórmula** (cada caso documenta su cuenta en un comentario). Casos previstos:

- Reparto simple: 2–3 empleados con pesos distintos y total que divide exacto.
- Reparto con sobrante de centavos (mayor resto) y desempate determinista.
- Un solo empleado; horas decimales (7,5 h); pesos decimales (1,25).
- `total_points = 0` (error controlado); horas 0 (fila ignorada); horas > 24 (error).
- USD → ARS con cotización de 2 decimales y con 6; redondeo half-up en el límite exacto de `.5`; propina mixta ARS + USD.
- **Adelanto mayor al importe del día:** propina $30.000, adelanto $40.000 → día $0, saldo pendiente $10.000; ese saldo se aplica en el siguiente día con importe (incluido el caso en que ese día alcanza solo parcialmente).
- Varios adelantos del mismo empleado aplicados del más antiguo al más nuevo; adelanto con fecha posterior al día (no se aplica).
- Liquidación semanal: acumulación de 7 días con días faltantes, empleados que aparecen solo algunos días, empleado en dos pozos el mismo día, total y desglose por día.
- Semana: rango para una fecha con `week_starts_on` = lunes y domingo; cruces de mes y de año.

**Excel real:** cuando el `.xlsx` original se coloque en `reference/`, se exporta a fixtures y se agrega `excel-reference.test.ts` como caso adicional (verificación al centavo). Hasta entonces ese archivo de test queda como `it.todo`. La captura de pantalla del Excel sirve como referencia conceptual, no como fixture.

Además, tests de propiedades (fast-check) sobre entradas aleatorias:
- `Σ bruto = total` siempre.
- Ningún importe negativo; `final = bruto − adelantos`.
- El resultado no depende del orden de los empleados.
- Mismo input → mismo output (determinismo).
- Los adelantos aplicados nunca superan su monto ni el bruto.

### 7.5 API pública (esbozo)

> Referencia vigente: `packages/tip-engine/src/types.ts`. El código usa sufijos de escala en los nombres (`…Cents`, `…E2` horas/pesos, `…E4` puntos, `…E6` porcentajes y cotizaciones) y devuelve errores tipados (`EngineError` con `code`). Además de lo esbozado abajo expone `allocateAdvances`, `convertUsdToArs`, `weekRange`, `formatCentsEsAr` y utilidades de fechas sin `Date`.
```ts
convertToArs(usdCents: bigint, rate: string): bigint

computeDailyDistribution(input: {
  tips: { currency: 'ARS'|'USD'; amountCents: bigint; rate?: string }[];
  rows: { employeeId: string; hours: string; weight: string }[];
  pendingAdvances: { advanceId: string; employeeId: string; date: string; remainingCents: bigint }[];
}): {
  totalCents: bigint; totalPoints: bigint;
  items: { employeeId; points; percentage; grossCents; advancesCents; finalCents;
           applications: { advanceId; cents }[] }[];
}

computeWeeklySettlement(days: { date: string; distributionId: string;
  items: { employeeId; grossCents; advancesCents; finalCents }[] }[]): {
  payments: { employeeId; grossCents; advancesCents; netCents;
              perDay: { date; grossCents; advancesCents; finalCents }[] }[];
  totals: { grossCents; advancesCents; netCents };
}
```

---

## 8. Pesos y dólares

1. **Moneda base del cálculo: ARS.** Todo el reparto es en pesos.
2. **Cada propina en USD** guarda: monto original, cotización usada, fecha de esa cotización y equivalente en ARS. La distribución diaria muestra `tips_ars`, `tips_usd` y el total convertido.
3. **Cotización oficial venta por fecha** en `exchange_rates`, cargada a mano en el MVP. Al registrar USD: si existe cotización del día, se usa y se **copia**; si no, se pide cargarla o se ofrece la última anterior con **confirmación explícita** (queda guardada su fecha).
4. Editar `exchange_rates` después **no altera** el historial: cada `tip_entry` conserva su copia.
5. El pago del sobre es en ARS. Pagar en USD queda fuera del alcance inicial.
6. Importar cotización desde una API: fase posterior (`source = API`).

---

## 9. Autenticación y autorización

**Autenticación:** Auth.js con email + contraseña (argon2id); Google opcional. Cookies `httpOnly`, `secure`, `sameSite=lax`. Rate limiting en login, registro, reenvíos y recuperación (tabla `rate_limits` en Postgres).

**Email en el MVP (recuperación de contraseña + verificación de email).** Ambos flujos comparten el mismo mecanismo y no agregan infraestructura compleja: una tabla `auth_tokens` y **un servicio de envío de emails**.

- Tokens aleatorios de 32 bytes; en la base solo se guarda su **hash SHA-256**. Un solo uso, expiración corta (reset 1 h, verificación 24 h), los anteriores se invalidan al emitir uno nuevo.
- Recuperación: el formulario responde siempre lo mismo exista o no el email (no revela qué cuentas existen); al cambiar la contraseña se invalidan las sesiones anteriores.
- Verificación: al registrarse se envía el enlace. Propuesta: el usuario no accede a la aplicación hasta verificar (con opción de reenviar).
- El envío está detrás de una interfaz `Mailer`. En desarrollo/tests se usa `ConsoleMailer` (imprime el enlace), así que **la elección del proveedor no bloquea la Fase 0 ni el desarrollo**.
- Nota técnica: el proveedor *Credentials* de Auth.js no trae estos flujos incluidos, por lo que se implementan sobre `auth_tokens`. Alternativa evaluable antes de empezar la autenticación: Better Auth, que los incluye de fábrica.

**Decisión de infraestructura pendiente (no se implementa hasta que la confirmes):** el proveedor de email transaccional para producción.

| Opción | Capa gratuita | Consideración |
|---|---|---|
| **Resend** (recomendada) | ~3.000 emails/mes, 100/día | API simple; para enviar a cualquier destinatario hay que **verificar un dominio propio** (registros DNS SPF/DKIM) |
| Brevo (SMTP/API) | ~300/día | Se puede empezar con un remitente verificado; más configuración |
| Amazon SES | Muy barato | Más setup y salida de "sandbox"; excesivo para el MVP |
| Gmail SMTP | — | No recomendado (límites y bloqueos) |

Con esos volúmenes (una cuenta por restaurante, unos pocos emails por usuario) la capa gratuita alcanza con margen. Lo único que requiere una acción tuya es **tener un dominio** (o aceptar un remitente compartido con menor entregabilidad) y crear la cuenta en el proveedor elegido.

**Autorización:** cada request resuelve `session.user` + `membership` del restaurante activo; toda Server Action llama a `can(membership, action)`. Los repositorios exigen `restaurantId` (nunca se lee un registro solo por `id`).

| Acción | OWNER | ADMIN | MANAGER (encargado) | VIEWER |
|---|---|---|---|---|
| Configurar restaurante / miembros | ✔ | ✔ | ✘ | ✘ |
| Equipos, puestos, personal | ✔ | ✔ | ✘ | ✘ |
| Cotizaciones y adelantos | ✔ | ✔ | ✔ | ✘ |
| Crear/editar distribución diaria (DRAFT) y **cerrar el día** | ✔ | ✔ | ✔ | ✘ |
| Anular distribución diaria | ✔ | ✔ | ✘ | ✘ |
| Cerrar / anular liquidación semanal | ✔ | ✔ | ✘ | ✘ |
| Preparar y entregar sobres | ✔ | ✔ | ✔ | ✘ |
| Revertir un sobre ya entregado | ✔ | ✔ | ✘ | ✘ |
| Ver historial, dashboard, sobres | ✔ | ✔ | ✔ | ✔ |

En el MVP solo existe `OWNER`; la matriz es la prevista para cuando se habiliten los demás roles.

---

## 10. Pantallas

**Públicas:** Login · Registro · Recuperar contraseña.

**Configuración (orden del MVP):**
1. **Restaurante** — crear/editar (incluye día de inicio de semana).
2. **Equipos y puestos** — equipos (Salón, Barra, Cocina, Recepción, Bacha, Runner, Guardavidas…) y puestos con su peso.
3. **Personal** — empleados y puesto habitual.
4. **Adelantos** — alta por empleado; muestra saldo pendiente.
5. **Cotizaciones** — oficial venta por fecha (también editable en línea desde la distribución diaria).

**Operación diaria:**
6. **Distribuciones diarias** — lista por fecha/estado.
7. **Nueva/Editar distribución diaria** — fecha y equipo → propinas (ARS/USD, cotización) → horas por empleado (puesto y peso precargados) → **cálculo en vivo** (puntos, %, bruto, adelantos a descontar, final) → **Cerrar día**.
8. **Detalle de distribución** — solo lectura si `CLOSED`; botón Anular (con motivo, según rol).

**Operación semanal:**
9. **Liquidación semanal** — matriz *empleados × días* (réplica del Excel) con total, adelantos y final; indicadores de días sin cargar o en `DRAFT`; botón **Cerrar liquidación**.
10. **Sobres** — lista "Roro → $516.447 · Leo → $623.450 …" con estado `PENDING/PREPARED/DELIVERED`, acciones por sobre y masivas ("marcar preparados"), detalle diario del sobre, registro de entrega (empleado, período, importe, fecha/hora y usuario).

**Resumen:** 11. **Dashboard** — semana en curso (acumulado provisional), sobres pendientes de preparar/entregar, propina ARS vs USD, adelantos pendientes, evolución semanal.

Diseño responsive: los encargados cargan horas y entregan sobres desde el celular.

---

## 11. Casos especiales y problemas previsibles

| Caso | Tratamiento |
|---|---|
| Total de puntos = 0 | Bloquear el cierre del día con mensaje claro |
| Centavos que no cierran | Mayor resto, invariante testeada (I1) |
| USD sin cotización para el día (fin de semana, feriado) | Pedir cargarla o confirmar la última anterior; se guarda su fecha |
| Cotización editada luego | No afecta al historial (copia en `tip_entries`) |
| Adelanto mayor que el importe del día | Se aplica lo disponible; el saldo queda `PENDING` para próximos cierres |
| Adelanto cargado después de cerrar el día | No modifica días cerrados; se aplica en el siguiente cierre |
| Anular un día ya cerrado | Solo si no está en una liquidación; reabre los adelantos que había consumido |
| Error descubierto con la semana ya liquidada | Anular la liquidación (si ningún sobre se entregó), corregir y volver a cerrar |
| Error con sobres ya entregados | Flujo de §1.2: revertir entrega (OWNER/ADMIN, motivo obligatorio, auditoría) → anular liquidación → corregir → re-liquidar → nueva entrega. Nunca se compensa en la semana siguiente |
| Sobre re-liquidado con importe distinto al ya entregado | Se muestra "ya entregado antes" vs "nuevo importe"; ambos quedan registrados |
| Token de email vencido/reutilizado | Se rechaza; se ofrece reenviar (con límite de intentos) |
| Día sin distribución (local cerrado) | Simplemente no existe; la matriz lo muestra vacío |
| Distribución `DRAFT` al cerrar la semana | Se bloquea el cierre y se listan los pendientes |
| Fecha de una distribución dentro de una semana ya liquidada | Se rechaza hasta anular la liquidación |
| Dos pozos el mismo día (por equipo) | Todavía no: la única estructura implementada es `SINGLE_POOL` (§1.1). Se agrega como opción del parámetro cuando se implemente |
| Cambio de la política con un período abierto | Versión nueva vigente; el período abierto pasa a ella con registro automático y se recalcula. Un período reabierto conserva su versión salvo cambio explícito con motivo |
| Cierre y cambio de política al mismo tiempo | El cierre bloquea el período antes de calcular: el cambio espera y se rechaza, o el cierre espera y usa la versión nueva (`test:pg`) |
| Empleado que cambia de puesto durante el día | Un ítem por empleado por día: se carga con el puesto principal (limitación conocida; extensión posible) |
| Cambio de peso de un puesto | Solo afecta días futuros (snapshot en los cerrados) |
| Empleado dado de baja con historial | Archivado lógico, nunca borrado |
| Sobre con importe final $0 | Existe como registro; la UI indica "sin importe a entregar" |
| Doble clic al cerrar/entregar | Transacciones idempotentes con verificación de estado |
| Dos encargados editando el mismo día | Control optimista (`updated_at`) + bloqueo `FOR UPDATE` al cerrar |
| Entrega registrada por el cliente con hora falsa | `delivered_at` lo fija el servidor |
| Zonas horarias | Fechas de negocio como `DATE`; "hoy" según la zona del restaurante |
| Formato numérico argentino | Presentación `1.234,56`; almacenamiento neutro en enteros |

---

## 12. Decisiones

**Resueltas**
- **D1 — Pozo:** la estructura del pozo es un parámetro de la política versionada (`pool_structure`, hoy `SINGLE_POOL`); el motor no depende de la regla (§1.1). Reemplaza a `pool_mode` (revisión 6 del modelo).
- **D2 — Adelantos:** se descuentan al cerrar cada distribución diaria; el excedente queda como saldo pendiente aplicable a futuras distribuciones.
- **D3 — Excel:** tests con casos explícitos coherentes con la fórmula; el `.xlsx` real se agregará desde `reference/` cuando esté disponible.
- **D4 — Correcciones tras entrega:** reversión autorizada, con motivo y auditoría → re-liquidación → nueva entrega (§1.2).
- **D5 — Email:** recuperación de contraseña **y** verificación de email en el MVP, sobre `auth_tokens` + interfaz `Mailer`.

**Abiertas**
- **A1 — Proveedor de email en producción** (§9): recomiendo Resend; requiere un dominio propio para enviar a cualquier destinatario. Se decide antes de implementar la autenticación (Fase 1), no antes de la Fase 0.
- **A2 — Auth.js vs Better Auth**, dado que hay que construir verificación y reset (§9). Se decide al empezar la Fase 1.
- **A3 — Autorización de reversiones:** hoy es por rol (`OWNER`/`ADMIN` ejecutan y autorizan). Si querés un esquema de *solicitud + aprobación* de dos personas, el modelo ya tiene `performed_by` y `authorized_by` separados y solo cambiaría el flujo.
- **A4 — Verificación de la fórmula:** la fórmula (`puntos = horas × peso del puesto`, reparto proporcional a puntos) sale de tu descripción inicial. No pude ver la captura del Excel, así que no puedo confirmar que coincida con la mecánica real.

---

## 13. Roadmap

**Fase 0 — Motor y esquema (antes de cualquier pantalla) — ✅ implementada**
Monorepo, `tip-engine` con sus tests (casos explícitos + propiedades + pureza), esquema Prisma + SQL (CHECK, índices parciales, triggers de inmutabilidad), tests de base de datos con PGlite (`pnpm test:db`, con limitaciones documentadas en `DATABASE.md` §10), CI. El scaffolding de Next.js queda para el primer paso de la Fase 1. Pendientes: aplicar el SQL a una base PostgreSQL real, incorporar el Excel de referencia (`reference/`) y ejecutar el workflow de CI en GitHub (no se probó: no hay remoto).

**Fase 1 — MVP, en el orden del flujo real**
1. Login, registro, **verificación de email y recuperación de contraseña**.
2. Restaurante.
3. Equipos y puestos con pesos.
4. Personal (y adelantos básicos).
5. Distribución diaria: propinas ARS/USD, cotización, horas → cálculo → **cerrar día**.
6. Acumulación semanal (matriz empleados × días).
7. Liquidación semanal (cerrar semana).
8. Preparar sobres → entregar sobres (registro de fecha/hora y usuario).
9. Dashboard básico.

**Fase 2 — Pulido:** exportación PDF/CSV, recibos por empleado, importación de cotización, verificación de email, vista de auditoría.

**Fase 3 — Crecimiento:** invitar miembros y activar roles, múltiples restaurantes por usuario, portal del empleado, eventual monetización.

---

## 14. Estrategia de pruebas

- **Motor (prioridad máxima):** casos explícitos calculados a mano (§7.4), propiedades aleatorias, un test de pureza que verifica que `src/` no importa nada externo, y el Excel real como caso adicional cuando esté en `reference/`.
- **Servicios (contra Postgres real):** cierre diario y semanal transaccionales, inmutabilidad (los triggers rechazan escrituras), concurrencia sobre adelantos, aislamiento por restaurante, permisos por rol.
- **E2E (Playwright):** flujo completo login → … → sobre entregado.

---

## 15. Seguridad y operación

- Secretos solo en variables de entorno; nunca en el repositorio.
- Validación con Zod siempre en el servidor.
- Prisma parametrizado; React escapa por defecto.
- Backups automáticos del proveedor + exportación de datos del restaurante.
- Migraciones versionadas aplicadas por CI/CD; ambientes separados.
- Auditoría de cierres, anulaciones y cambios de estado de sobres.
