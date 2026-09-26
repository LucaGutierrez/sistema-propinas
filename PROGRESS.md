# PROGRESS.md — Estado del proyecto

Última actualización: 2026-09-26 (Fase 1 en curso como demo en el navegador. Política de distribución versionada por restaurante — CONFIG-MODEL.md; Library es el caso de referencia. **Persistencia de la política en Prisma** con la migración `20260926000000_distribution_policies`, probada en local; **no aplicada en Neon**).
Repositorio: https://github.com/LucaGutierrez/sistema-propinas (rama principal `main`; el trabajo en curso se revisa en ramas antes de integrarlo). Commit inicial: `d3ac4d83bd736451445737a7533b1be66660a381`.

Documentos de referencia: [ARCHITECTURE.md](ARCHITECTURE.md) (arquitectura, flujo y decisiones) · [DATABASE.md](DATABASE.md) (modelo de datos) · [CONFIG-MODEL.md](CONFIG-MODEL.md) (política de distribución por restaurante) · [README.md](README.md) (comandos).

---

## 1. Qué proyecto estamos construyendo

Una aplicación web para gestionar y distribuir propinas entre el personal de restaurantes. Reemplaza las planillas de Excel con fórmulas manuales por un sistema simple, profesional y que pueda crecer. Es un proyecto nuevo, sin relación con ningún proyecto anterior.

## 2. Objetivo del sistema

Reflejar exactamente el flujo real del restaurante:

- La propina **se calcula por día** (distribución diaria) pero **se paga por semana**. **(En revisión, 2026-09-26):** la planilla real reparte con las horas **acumuladas de la semana**; cómo se combina eso con el pozo diario es la decisión pendiente P1 (§10).
- Tres conceptos distintos, ninguno reemplaza a otro:
  - **DAILY DISTRIBUTION**: calcula la propina de un día (horas × peso del puesto). Es la unidad de cálculo.
  - **WEEKLY SETTLEMENT**: acumula las distribuciones diarias cerradas de una semana. Suma, no recalcula.
  - **WEEKLY ENVELOPE / PAYMENT (sobre)**: el dinero que se prepara y se entrega a cada empleado (`PENDING → PREPARED → DELIVERED`, con fecha/hora y usuario de entrega).
- Propinas en pesos y en dólares (cotización oficial venta por fecha, guardada en el historial).
- Adelantos que se descuentan al cerrar cada día; si superan el importe disponible queda un saldo pendiente para próximos días.
- Historial inmutable: una distribución `CLOSED` no se modifica; se anula (`VOIDED`) y se rehace.
- Correcciones tras una entrega: autorización → reversión con motivo obligatorio → auditoría → re-liquidación → nueva entrega. Nada se compensa en silencio en la semana siguiente.
- Gratuita al inicio; roles de usuario previstos para el futuro.

## 3. Arquitectura elegida

- **Monorepo pnpm** con dos piezas: `packages/tip-engine` (motor de cálculo) y `apps/web` (aplicación Next.js 15 + Prisma y sus tests).
- **Monolito full-stack** (Next.js 15 App Router, instalado en la Fase 1) con capas `UI → actions → services → (tip-engine, repositories)`. Hoy la UI funciona como **demo en el navegador** (`localStorage`), sin servidor ni base: ver §6.2.
- **Motor de cálculo independiente**: TypeScript puro, `BigInt`, sin dependencias, sin Next.js/Prisma/React/base de datos/APIs de Node. Recibe y devuelve objetos simples; la app traduce filas de Prisma a tipos del motor. La vista previa y el cierre usan la misma función.
- **Aritmética exacta**: dinero en centavos (`bigint`), horas y pesos ×100, cotización ×10⁶. Reparto por **mayor resto** (la suma de los pagos coincide siempre con el total).
- **Pozo único o por equipo** sin rehacer nada: `restaurants.pool_mode` (`SINGLE` | `PER_TEAM`, sin valor por defecto) y `daily_distributions.team_id` opcional. El motor no conoce equipos.
- **Inmutabilidad en tres capas**: servicios, triggers de PostgreSQL y política "anular y rehacer".
- **Multi-restaurante** desde el día 1 (`restaurant_id` en todo). Membresías con rol (`OWNER/ADMIN/MANAGER/VIEWER`); el MVP opera con `OWNER`.

## 4. Stack tecnológico

| Capa | Elección |
|---|---|
| Lenguaje | TypeScript 6.x (estricto) |
| Monorepo | pnpm 12.6 (`packageManager`), Node ≥ 24 |
| Motor | TypeScript + `BigInt`, cero dependencias; Vitest 5 + fast-check |
| Base de datos | PostgreSQL (Neon o Supabase, capa gratuita) |
| ORM | Prisma 6.19 (+ SQL propio para CHECK/índices parciales/triggers) |
| Calidad | ESLint 10 (reglas de pureza del motor), Prettier, GitHub Actions |
| Tests de BD | PGlite (PostgreSQL en WebAssembly) con Vitest |
| **Fase 1 (instalado)** | Next.js 15.5 App Router, React 19, Tailwind 4, componentes shadcn/ui (escritos a mano, `components.json` listo para el CLI), lucide-react, Vitest para la lógica de la app |
| **Fase 1 (pendiente)** | Better Auth (A2), React Hook Form + Zod, Playwright, email transaccional (A1; Resend recomendado) |

Versiones fijadas a propósito: TypeScript 6 (typescript-eslint aún no soporta TS 7) y Prisma 6 (se evitan cambios de la serie 7/8 hasta la Fase 1). pnpm 12 bloquea scripts de instalación por defecto; `pnpm-workspace.yaml` autoriza solo `prisma`, `@prisma/client` y `@prisma/engines`.

## 5. Decisiones ya aprobadas

- Flujo real: distribución diaria (cálculo) → liquidación semanal (acumulación) → sobre (pago).
- Adelantos: se descuentan al cerrar cada distribución diaria; el excedente queda como saldo pendiente aplicable a futuras distribuciones (ejemplo: propina $30.000, adelanto $40.000 → día $0, saldo $10.000). **(2026-09-26)** Qué pasa con el excedente pasa a ser **configuración por restaurante, pendiente de confirmar con casos reales** (no regla estructural); lo estructural es que un sobre nunca es negativo. La demo solo implementa "pasa al período siguiente".
- Pozo: ~~mantener `team_id` opcional y soportar ambos modos~~ **(2026-09-26)** la estructura del pozo es un parámetro de la política versionada (`pool_structure`; hoy solo `SINGLE_POOL`). `pool_mode` y `team_id` de la distribución se retiraron.
- Correcciones tras entrega: reversión autorizada, con motivo obligatorio y auditoría; luego re-liquidación y nueva entrega.
- Email: recuperación de contraseña **y** verificación de email desde el MVP (tabla `auth_tokens` + interfaz `Mailer`). El proveedor de producción se documenta antes de implementarlo.
- Excel: los números de ejemplo de la conversación son solo ilustrativos, no casos de test. Los tests usan casos explícitos coherentes con la fórmula. El `.xlsx` real se agregará después en `reference/` como caso adicional.
- MVP en el orden: LOGIN → RESTAURANTE → EQUIPO → PERSONAL → DISTRIBUCIÓN DIARIA → CÁLCULO → CERRAR DÍA → ACUMULACIÓN SEMANAL → LIQUIDACIÓN SEMANAL → PREPARAR SOBRES → ENTREGAR SOBRES.
- Se usa pnpm; no se necesita Docker ni PostgreSQL local en la Fase 0.
- PGlite como dependencia de desarrollo para tests de base de datos reproducibles (con limitaciones documentadas).
- Commit local, sin push a ningún remoto. **(Actualizado 2026-09-25)** El repositorio ya está publicado en GitHub; se hace push solo cuando el usuario lo pide, y nunca merge a `main` sin su aprobación.
- **(2026-09-25)** A2: Better Auth. A1: proveedor de email postergado (no hay dominio propio; `ConsoleMailer` en desarrollo).
- **(2026-09-25)** Base real: Neon (PostgreSQL 18.6, región São Paulo). `DATABASE_URL` directa (sin `-pooler`) solo en `apps/web/.env` (ignorado por git).
- **(2026-09-25)** Adelantos: con aplicaciones vigentes no se modifican (`amount_cents`, `employee_id`, `restaurant_id`, `date`) ni se anulan; primero se anulan las distribuciones que los consumieron. `VOIDED` es final y un adelanto `VOIDED` no se aplica. Nunca se borran físicamente (`DELETE`/`TRUNCATE` bloqueados por trigger): se anulan.
- **(2026-09-25)** Sobres: `DELIVERED` congela `delivered_*`, `delivery_note` y `prepared_*` mientras siga entregado; un error en la entrega se corrige con la reversión `DELIVERED → PREPARED`, que solo limpia la entrega (incluida la nota) y no toca `prepared_*`; `VOIDED` congela todo el sobre.
- **(2026-09-25)** Liquidaciones: `CLOSED` y `VOIDED` congelan toda la fila (incluidos `notes`, `closed_*`, `voided_*`); `CLOSED → VOIDED` solo completa `voided_*`.
- **(2026-09-26) Principio de diseño: la distribución se configura por restaurante.** GUTIP no tiene una única regla de reparto: tiene reglas estructurales (iguales para todos) y parámetros que elige cada restaurante (período, cuándo se reparte, horas, fuentes, grupos, pesos, redondeo, adelantos, quién entrega sobres). La configuración de un restaurante no afecta a otros y cada cierre guarda la que usó. **Library (Hotel Faena)** es el caso de referencia para validar, no el diseño del producto. Detalle en `ARCHITECTURE.md` §2 (principio 7) y §2.1. Library confirmó: pozo semanal, reparto una vez por semana, horas totales de la semana cargadas al cerrar.

## 6. Qué se implementó hasta ahora

### 6.1 Fase 0 (base de datos y motor)

**Repositorio en GitHub** (`LucaGutierrez/sistema-propinas`). En `main`: `d3ac4d8` (inicial), `3ab16a8` (este archivo) y `1e7f0f4` (migración inicial e invariantes). El CI corrió en verde sobre `1e7f0f4`. Los tests contra PostgreSQL real (rama `claude/proyecto-continuacion-j1jaup`) se integraron a `main` con el PR #1 (`cb41b3c`).

**`packages/tip-engine`** (motor puro):
- `fixed.ts`, `money.ts`, `exchange.ts`: decimales de escala fija sobre `BigInt`, redondeo half-up, USD → ARS.
- `daily-distribution.ts`, `advances.ts`: puntos = horas × peso, mayor resto, adelantos del más antiguo al más nuevo, saldo pendiente.
- `weekly-settlement.ts`, `week.ts`: acumulación semanal, sobres con desglose por día, días sin distribución, fechas sin `Date`.
- **257 tests** pasan (casos calculados a mano, propiedades aleatorias con fast-check, test de pureza del código fuente) + 3 `todo` del Excel real.

**`apps/web/prisma`**:
- `schema.prisma` completo (usuarios, tokens de email, restaurantes, catálogos, distribución diaria, propinas, ítems, adelantos y aplicaciones, liquidación, sobres, eventos de sobre, auditoría). `prisma validate` y `prisma generate` correctos.
- `sql/0001_constraints.sql`: CHECK, índices únicos parciales y por expresión, triggers de inmutabilidad, transiciones de estado, bitácoras de solo inserción.

**`apps/web/test-db`**: **206 tests** de base de datos sobre PGlite (`pnpm test:db`), con el DDL generado desde `schema.prisma`. Verificados con pruebas de mutación (con el SQL anterior fallan los 40 tests de flujos prohibidos agregados el 2026-09-25).

**`apps/web/prisma/migrations/20260925000000_init`**: DDL de Prisma + copia literal de `sql/0001_constraints.sql`. Probada con `prisma migrate deploy` (primero en PGlite por socket; ahora en cada corrida de `test:pg` sobre PostgreSQL real); `prisma migrate diff` posterior vacío (Prisma no borra índices parciales, CHECK ni triggers). `test-db/migrations.test.ts` garantiza que la migración y la base de los tests son idénticas. **Aplicada en Neon** (ver abajo).

**`apps/web/test-pg`** (2026-09-25): **11 tests** contra un PostgreSQL real (`pnpm test:pg`, requiere `TEST_DATABASE_URL` de un servidor descartable; se niega a correr contra Neon). Cada corrida crea una base temporal, aplica la migración con `prisma migrate deploy` y la borra al final. Verifica: migración sin diferencias con `schema.prisma`; invariante **I11** con `FOR UPDATE` (dos cierres simultáneos sobre el mismo adelanto: el segundo espera y aplica solo el saldo; verificado que sin `FOR UPDATE` fallan); qué frena la base sola (CHECK ante incrementos relativos) y qué no (escritura absoluta sin bloqueo pierde una actualización → el servicio **debe** bloquear); cierre simultáneo del mismo día; índices únicos bajo concurrencia; y el límite del trigger anti-mezcla de pozos (documentado, lo valida el servicio). Detalle en `DATABASE.md` §10.

**Neon migrado correctamente** (verificado el 2026-09-26, solo lectura, sin modificar la base): la migración `20260925000000_init` está aplicada en Neon (PostgreSQL 18.6).
- `prisma migrate status`: 1 migración encontrada, "Database schema is up to date!"; **no hay migraciones pendientes**.
- `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script --exit-code` (desde `apps/web`): migración vacía, código de salida 0 → **sin drift**.
- Catálogo de PostgreSQL comparado por nombre contra `migration.sql` (transacción `READ ONLY` + `ROLLBACK`): 18 tablas, 10 enums (con los mismos valores y orden), 28 índices (sin contar claves primarias), 8 funciones, 13 triggers, 40 CHECK constraints y 43 foreign keys; ninguno falta ni sobra. Sin triggers deshabilitados ni constraints sin validar.
- `_prisma_migrations`: una sola fila (`20260925000000_init`, terminada el 2026-09-25 17:13:58 UTC, sin rollback) cuyo **checksum coincide** con `migration.sql`.
- Todas las tablas están **vacías**.

**Infraestructura**: ESLint con reglas que impiden `Number`, `Math`, `Date`, floats e imports externos en el motor; Prettier; `.gitattributes` (LF); `.gitignore` verificado (secretos, `.env*`, `reference/*` ignorados; `.env.example` versionado); `.github/workflows/ci.yml` con dos jobs: `check` (lint, typecheck, `test`, `test:db`, Prisma, motor sin dependencias) y `postgres` (`test:pg` sobre un contenedor **PostgreSQL 18**, misma versión mayor que Neon 18.6, para aproximar ese entorno; no se conecta a Neon).

**Documentación**: `ARCHITECTURE.md`, `DATABASE.md` (rev. 6 desde el 2026-09-26), `README.md`, este `PROGRESS.md`.

**Verificado el 2026-09-25**: `lint`, `typecheck`, `test` (257 + 3 `todo`), `test:db` (206), `test:pg` (11, sobre PostgreSQL 16 local y temporal), `prisma validate`, `prisma generate` y `format:check` sin errores. `test:pg` se ejecutó **localmente** contra un PostgreSQL temporal, no en GitHub. El job `postgres` (PostgreSQL 18) fue agregado al CI pero **todavía no fue ejecutado por GitHub Actions**: el workflow solo corre con push a `main` o en un Pull Request, y el push de la rama no lo dispara.

### 6.2 Fase 1 — interfaz GUTIP (demo en el navegador)

Commits: `8fbf56f` (demo con locales, permisos e invitaciones) + los cambios de esta sesión (sobres, reglas). **No toca Prisma, migraciones, Neon ni `packages/tip-engine`.** Todo se guarda en `localStorage` del navegador (`gutip-demo-v2`, con migración del formato anterior `gutip-demo-v1`); cada navegador tiene su copia y no se comparte.

**Terminado (funciona y tiene tests; reglas ya decididas):**
- **Estructura de la app:** barra lateral, encabezado, menú deslizable en celular, tarjetas de resumen, estados vacíos, marca GUTIP, textos en español.
- **Locales** ("Mis locales"): varios locales por cuenta (p. ej. Faena Library / Faena Mercado), cada uno con su personal, puestos, semanas e historial; selector en la barra lateral; crear (opcionalmente copiando puestos), renombrar.
- **Personal y puestos:** agregar personas, crear puestos con factor, cambiar de puesto, dar de baja / reactivar (nunca se borra: las semanas cerradas conservan a la persona).
- **Semana:** empezar semana (fecha sugerida), cargar el pozo de cada día, horas y adelantos; vista previa; cerrar semana (queda congelada).
- **Sobres** (reglas de DATABASE.md): uno por persona con propina; `Pendiente → Preparado → Entregado` con fecha/hora y quién; deshacer preparación y **revertir entrega con motivo obligatorio (≥ 10 caracteres)**, que vuelve a Preparado sin tocar la preparación; bitácora por sobre; "Preparar todos"; sobres sin importe marcados como tales; **planilla imprimible con columna de firma**.
- **Registro de adelantos:** cada adelanto es un movimiento (persona, fecha dentro de la semana, monto, nota, quién y cuándo). No se borra: se anula con motivo (≥ 10 caracteres) y queda tachado en el registro. Lo que no alcanza a descontarse pasa a la semana siguiente como movimiento "Saldo anterior". Los datos guardados con el formato anterior (un monto por persona) se convierten solos.
- **Anular y rehacer una semana cerrada** (regla de DATABASE.md §6): solo si ningún sobre está entregado y con motivo. La semana vuelve a quedar abierta con sus datos, el cierre anulado se guarda completo (revisión, sobres con evento "Semana anulada", quién, cuándo, motivo) y al volver a cerrarla se generan sobres nuevos. Solo se puede anular la **última semana registrada** del local, para no dejar inconsistente el saldo de adelantos que ya pasó a otra semana (criterio de "anular en orden inverso", como los adelantos en la base).
- **Historial:** propina generada por mes, semanas cerradas y total en sobres.
- **Acceso por local:** cuatro permisos (Encargado, Editor, Solo ver, Solo lo suyo), invitaciones pendientes, cambiar permiso, quitar acceso, **"Ver como…"** para probar lo que ve cada uno. Las secciones sin permiso muestran "No tenés acceso" aunque se escriba la URL. Reglas en `apps/web/src/lib/demo-store/permissions.ts`.
- **Mis sobres:** cada persona ve solo sus sobres (con estado de entrega), sus horas y adelantos.
- **Configuración de distribución** (`/configuracion`; `/reglas` redirige) — modelo aprobado en [CONFIG-MODEL.md](CONFIG-MODEL.md): cada local tiene una **política versionada** que arranca con la **configuración estándar de GUTIP** (válida: puede cerrar enseguida; incluye puestos y pesos iniciales) o con una copia de la de otro local. Los **puestos y sus pesos son parte de la política**; el personal no. Cada cambio (parámetro, puesto o peso) crea una versión nueva, vigente para los próximos períodos y para la semana abierta (registrado); una semana reabierta conserva su versión salvo elección explícita con motivo. Cada cierre guarda la versión y una copia de los valores usados; los cierres nunca cambian. El cierre se bloquea solo si una personalización deja algo **por definir**. Pantalla con estándar/personalizado por parámetro, edición de puestos y pesos, historial de versiones y validación de Library (no bloquea). Ya configurables: redondeo (centavo o peso) y quién maneja los sobres.

**En demo / provisional (funciona, pero no es definitivo):**
- **Fórmula PROVISIONAL** (`apps/web/src/lib/distribution/provisional-formula.ts`, `FORMULA_STATUS = 'PROVISIONAL'`): pozo = suma de los días; puntos = horas semanales × factor; reparto por mayor resto al centavo; sobre = importe − adelantos. Vive en la app, **no** en el motor, cuyo contrato no se cambió.
- Los factores demo (0,014 / 0,022 / 0,007) son los redondeados que muestra la planilla: los importes difieren de ella (ver P3).
- Permisos e invitaciones se aplican **solo en la pantalla** (no hay servidor); las invitaciones quedan pendientes porque nadie puede aceptarlas todavía.
- Quién aparece como autor de una acción es "Encargado" o la persona simulada con "Ver como…".
- Los datos demo usan los **nombres reales** de la planilla (`apps/web/src/lib/demo/data.ts`): anonimizar si el repositorio es público.

**Verificado (2026-09-26, antes de la persistencia):** `typecheck`, `lint`, `format:check`, `test` (web 79, tip-engine 257 + 3 `todo`), `test:db` (206) y `next build` sin errores. Probado en el navegador: flujo de semana, locales, "Ver como" (Editor y Solo lo suyo), sobres (preparar, entregar, revertir con motivo), reglas, registro de adelantos (alta, anulación, conversión de datos viejos) y anular / reabrir una semana cerrada. **No verificado visualmente en celular** (el diseño adaptable está hecho, pero el navegador de prueba no permitió achicar la ventana).

### 6.3 Persistencia de la política versionada (Prisma, 2026-09-26)

Pasa a la base el modelo aprobado en [CONFIG-MODEL.md](CONFIG-MODEL.md) y ya implementado en la demo. Detalle en `DATABASE.md` rev. 6. **No toca Neon** ni `packages/tip-engine`; la demo sigue en `localStorage`.

- **Tablas nuevas:** `distribution_policy_versions` (un parámetro por columna, enums con **solo** las opciones implementadas, `template_code`/`template_version` para la configuración estándar, que vive en el código; origen `STANDARD`/`COPY`/`CHANGE`; `period_start_weekday` configurable: lunes es el estándar, no una regla), `policy_version_positions` (porción `NUMERIC(20,10)` de cada puesto en la versión), `period_policy_changes` (bitácora automática o con motivo), `period_hours` (horas totales del período por empleado; tope 24 × días del período, sin límite de negocio inventado).
- **Cambios:** `restaurants.current_policy_version_id` (sin `pool_mode` ni `week_starts_on`); `positions` como identidad estable (sin `weight`, `team_id` opcional, nombre único por restaurante sin distinguir mayúsculas; renombrar no crea versión); repartos `DAY`/`PERIOD` con `date_from`/`date_to` y sin superposición (reemplaza `date`, `pool_mode`, `team_id` y el trigger anti-mezcla; I13 pasa a "sin superposición"); `tip_entries.entry_date`; `portion_snapshot` y puntos `NUMERIC(30,12)`; datos de anulación en `advances`; `weekly_settlements.policy_version_id` + `policy_snapshot` (JSONB, solo auditoría) + `calc_version` obligatorios al cerrar.
- **Reglas en la base:** versiones, sus puestos y la bitácora son de solo inserción; los puestos de una versión solo se insertan en la transacción que la crea; el período solo cambia de versión con su registro en la misma transacción, y solo estando `OPEN`; un período cerrado conserva versión y snapshot. Se mantienen I1–I12, revisiones con `supersedes` y el modelo de saldo pendiente de adelantos (sin filas artificiales de "Saldo anterior").
- **Migración `20260926000000_distribution_policies`:** guarda "tablas de negocio vacías", DDL de Prisma y copia literal de `sql/0002_distribution_policies.sql`. `sql/constraints.sql` es el conjunto vigente que usan los tests; `0001_constraints.sql` no se tocó (ya está aplicado en Neon).
- **Tests:** `test:db` **248** (nuevo `policies.test.ts`, tests de alcance, superposición, fecha de la propina, tope de horas, anulación de adelantos y la guarda de la migración); `test:pg` **18** (superposición bajo concurrencia, versiones simultáneas, marcas por transacción, cierre vs. cambio de versión, horas durante un cierre; `migrate diff` vacío). App: la porción de 10 decimales no cambia los importes de Library y representa 0,65/45. La fórmula provisional y el motor no cambiaron.
- **Verificado localmente (2026-09-26):** `typecheck`, `lint`, `format:check`, `test` (web 82, tip-engine 257 + 3 `todo`), `test:db` (248), `test:pg` (18, sobre un PostgreSQL 18 local y descartable: `embedded-postgres` en una carpeta temporal, nunca Neon), `prisma validate`/`generate` y `next build`.
- **Pendiente:** aplicar la migración en Neon (con autorización; primero en una rama de Neon, `migrate diff` sin drift); los servicios que escriben estas tablas (crear/cambiar política, abrir y cerrar período con snapshot) llegan con la persistencia real (§11).

## 7. Qué falta de la Fase 0

Todo lo construible sin recursos externos está hecho. Faltan verificaciones que dependen de cosas externas:

1. ~~**PostgreSQL real**~~: migración inicial creada y verificada en cada corrida de `test:pg`; **aplicada en Neon** y verificada sin drift el 2026-09-26 (ver sección 6).
2. ~~**Concurrencia**~~: cubierta por `test:pg` (bloqueos `FOR UPDATE`, condiciones de carrera, índices únicos e invariante I11) contra PostgreSQL real, sin tocar Neon.
3. ~~**CI en GitHub**~~: el repositorio está en GitHub y el CI corrió en verde sobre `main`. El job `postgres` llegó a `main` con el PR #1; GitHub Actions **confirmado en verde** en `main` (jobs `check` y `postgres`, 2026-09-26).
4. **Excel real**: colocar el `.xlsx` en `reference/` y convertirlo en fixtures anonimizados (los 3 `todo` de `excel-reference.test.ts`).

## 8. Qué debemos hacer inmediatamente al continuar

1. Correr los comandos de verificación para confirmar que todo sigue en verde (ver más abajo).
2. ~~Decidir A1 y A2~~ (hecho el 2026-09-25). Si es posible, confirmar el pozo (D1).
3. ~~Conseguir una base PostgreSQL real~~ (Neon, hecho el 2026-09-25). ~~Probar concurrencia~~ (hecho con `test:pg`). ~~Aplicar la migración en Neon~~ (aplicada y verificada el 2026-09-26).

Comandos (desde la raíz; en PowerShell/Bash puede hacer falta agregar `%APPDATA%\npm` al `PATH` porque pnpm se instaló con `npm install -g pnpm`):

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db
# Requiere un PostgreSQL descartable (nunca Neon):
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test:pg
# Prisma necesita DATABASE_URL; para validate/generate sirve un valor ficticio:
DATABASE_URL="postgresql://user:password@localhost:5432/propinas" pnpm prisma validate
DATABASE_URL="postgresql://user:password@localhost:5432/propinas" pnpm prisma generate
# Estado de Neon (solo lectura; usa apps/web/.env). `@propinas/web` no tiene script "prisma": usar exec.
pnpm --filter @propinas/web exec prisma migrate status
# Interfaz GUTIP (demo): http://localhost:3000
pnpm --filter @propinas/web dev
pnpm --filter @propinas/web build
```

## 9. Qué NO debemos hacer todavía

- ~~No construir la interfaz ni instalar Next.js~~ (Fase 1 aprobada: la interfaz existe como demo).
- No implementar login, registro, verificación de email ni recuperación de contraseña hasta que el usuario apruebe el plan de Better Auth + persistencia (§11). El esquema de la política versionada ya está hecho (§6.3); otros cambios a `schema.prisma` requieren aprobación.
- No convertir la fórmula provisional en regla definitiva ni cambiar el contrato del motor hasta resolver P1–P6 (§10).
- No aplicar migraciones en Neon ni modificar esa base sin autorización explícita del usuario.
- No modificar el motor de cálculo ni el esquema "por costumbre": cualquier cambio debe pasar `test`, `test:db` y actualizar `DATABASE.md`.
- No usar `Number`, `Math`, `Date` ni floats en `packages/tip-engine` (ESLint y los tests lo impiden).
- No convertir en tests los números de ejemplo de la conversación (Roro $516.447, etc.).
- No versionar datos reales (Excel con sueldos, `.env`, credenciales).
- No agregar a los enums de la política opciones que GUTIP todavía no calcula. En Neon se verificó la **estructura** (objetos, checksum, sin drift), no el **comportamiento**: los triggers y la concurrencia se probaron en PGlite y en PostgreSQL real descartable (`test:pg`), no en Neon.
- No correr `test:pg` apuntando a Neon ni a una base con datos (crea y borra bases).
- No hacer `push` sin que el usuario lo pida, ni merge a `main` sin su aprobación.

## 10. Problemas y decisiones pendientes

| # | Pendiente | Detalle |
|---|---|---|
| A1 | Proveedor de email en producción | **Postergado (2026-09-25).** No hay dominio propio todavía. Se desarrolla con `ConsoleMailer` detrás de la interfaz `Mailer`; el proveedor (Resend recomendado, requiere dominio) se elige antes de publicar. No bloquea la Fase 1. |
| A2 | Auth.js vs Better Auth | **Decidido (2026-09-25): Better Auth.** Trae verificación de email y reset. Pendiente al empezar la Fase 1: conciliar sus tablas (`user`, `session`, `account`, `verification`) con `users` y `auth_tokens` del esquema actual, y actualizar `DATABASE.md`. |
| A3 | Autorización de reversiones | Hoy es por rol (`OWNER`/`ADMIN` ejecutan y autorizan). Si se prefiere "solicitud + aprobación" de dos personas, el modelo ya separa `performed_by` y `authorized_by`. |
| A4 | Verificación de la fórmula | **Parcialmente resuelto (2026-09-26).** Se analizó la foto de la planilla (`reference/`, ignorada por git): confirma el reparto proporcional a horas × factor y el descuento del adelanto. Diferencias con el motor: horas semanales (> 24), factores con más decimales y distintos dentro de un puesto, redondeo a pesos. Quedan P1–P7. |
| D1 | Pozo del negocio real | **Reemplazado por P2** (porcentajes por grupo). En la base, `pool_structure` de la política (hoy `SINGLE_POOL`). |

**Parámetros de distribución (P1–P8) — configuración por restaurante, no reglas globales** (2026-09-26). Cada restaurante elige su valor en "Configuración de distribución". La tabla dice qué opciones calcula GUTIP hoy y qué sabemos de Library (caso de referencia). Lo que no sabemos queda como configuración pendiente, nunca como regla inventada:

| # | Parámetro | GUTIP calcula hoy | Library (referencia) |
|---|---|---|---|
| P1 | Cuándo se reparte y qué horas se usan | Una vez por período, con las horas totales del período (cargadas al cerrar). Por día / horas del día / acumuladas: próximamente. | **Confirmado:** pozo semanal, reparto semanal, horas totales de la semana. |
| P2 | Grupos y porcentajes | Sin grupos. % por grupo (+ qué pasa si un grupo no trabajó): próximamente. | La planilla no muestra %: sin confirmar. |
| P3 | Peso de cada hora | Por puesto (factor con hasta 4 decimales). Con excepción por persona / por persona: próximamente. | Factor = peso ÷ 45; en Bacha, factores distintos entre personas: sin confirmar. |
| P4 | Redondeo | Centavos o pesos enteros (configurable). $10 / $100 (+ destino del sobrante): próximamente. | Pesos enteros reproducen la planilla exacta: sin confirmar. |
| P5 | Fuentes del pozo | Un monto por día. Varias fuentes sumadas / pozos separados: próximamente. | Efectivo; "Recepción" y "Cocina" en 0: pendiente. |
| P6 | Descuento de adelantos | De todo el período (cada adelanto se registra con fecha). Desde su fecha / a elección o en cuotas: próximamente. | Se descuenta en la misma planilla; sin fechas: pendiente. |
| P7 | Validación con datos reales | — (no es un parámetro) | Falta el `.xlsx` (fórmulas, Hoja2/Hoja3) y más semanas para completar los 3 `todo` del motor. |
| P8 | Quién prepara y entrega sobres | Solo Encargado, o Encargado y Editor (configurable). Permiso "Pagador": próximamente. Revertir: siempre Encargado (A3). | Pendiente. |
| — | Verificación de email obligatoria | Propuesta: el usuario no accede a la app hasta verificar el correo (con opción de reenviar). Confirmar. |
| — | Regla de días fuera de una liquidación cerrada | Una distribución con fecha dentro de una semana ya liquidada se rechaza hasta anular la liquidación. Confirmar que es lo deseado. |
| — | Versiones de PostgreSQL | Resuelto: Neon ofrece 18.6 y PGlite 18.3 (misma versión mayor). |
| — | Tipos de ítem por día | Un ítem por empleado por distribución (si cambia de puesto en el día se carga el principal). Limitación conocida; extensión posible. |

## 11. Pendiente para Better Auth + persistencia real

Plan presentado el 2026-09-26 (en la conversación; **no aprobado ni empezado**). Resumen:

- **Better Auth, solo el núcleo** (email + contraseña, sesiones, verificación, recuperación). Restaurantes, membresías e invitaciones quedan como tablas propias (no el plugin de organizaciones).
- **Tablas nuevas:** `sessions`, `accounts`, `verifications` (y `auth_rate_limits`), `invitations`. Se adapta `users` (sin `password_hash`; `email_verified` booleano); se eliminan `auth_tokens` y `rate_limits`. Confirmar los nombres exactos con el CLI de Better Auth de la versión instalada.
- **Permisos:** `MembershipRole` pasa a `OWNER, MANAGER, EDITOR, VIEWER, SELF` (Dueño, Encargado, Editor, Solo ver, Solo lo suyo); `memberships.employee_id` para vincular cuenta ↔ empleado; un único `OWNER` por restaurante.
- **Servidor:** rutas `/l/[restaurantId]/…`, `requireAccess(restaurantId, capacidad)` en cada página y acción, repositorios que reciben el contexto de acceso (filtran por `employee_id` para "Solo lo suyo"), 404 a quien no es miembro. Reutiliza la matriz de `permissions.ts`.
- **Migraciones separadas:** M2 (acceso: no depende de la fórmula) y M3 (distribución: después de P1–P6). Cada una con guarda "tablas vacías", primero en una rama de Neon, verificación de drift y tests (`test:db`, `test:pg`, por rol, Playwright).
- **Bloqueantes externos:** A1 (proveedor de email) para recuperar contraseñas en producción.

---

## NEXT STEP

**Cuando retomemos: la Fase 0 está cerrada (Neon con la migración inicial, CI en verde). La Fase 1 avanza como demo en el navegador; la política versionada ya tiene su esquema y migración probados en local (§6.3), sin aplicar en Neon.**

1. **Verificar el estado:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (web 82 + tip-engine 257), `pnpm test:db` (248), `pnpm test:pg` (18, PostgreSQL descartable), `pnpm --filter @propinas/web build`. Confirmar que el CI (job `postgres`) quedó en verde con la migración nueva.
2. **Configuración de Library:** confirmar con el restaurante los parámetros pendientes (§10, pantalla "Configuración de distribución") y conseguir el `.xlsx` (P7). No son decisiones globales de GUTIP.
3. ~~**Diseño de datos (Prisma)** de la política versionada~~ (hecho el 2026-09-26, §6.3). **Neon:** aplicar `20260926000000_distribution_policies` solo con autorización explícita.
4. ~~**Demo:** adelantos como movimientos y anular / rehacer una semana~~ (hecho el 2026-09-26). La demo cubre todo el flujo acordado; lo que falta depende de decisiones (§10) o de la persistencia (§11).
5. **Persistencia (solo con aprobación explícita):** plan de §11, empezando por M2 + Better Auth en local, sin tocar Neon. Al pasar a la base: los adelantos de la demo corresponden a `advances` (+ `advance_applications` al cerrar) y las revisiones anuladas a `weekly_settlements` con `revision` / `supersedes` y sobres `VOIDED`.

No se modifica `schema.prisma`, las migraciones ni Neon sin aprobación explícita del usuario.
