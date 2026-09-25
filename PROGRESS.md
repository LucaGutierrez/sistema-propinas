# PROGRESS.md — Estado del proyecto

Última actualización: 2026-09-25 (tests contra PostgreSQL real: migraciones, concurrencia e I11; job de CI con PostgreSQL 18). La migración **sigue sin aplicarse en Neon**.
Repositorio: https://github.com/LucaGutierrez/sistema-propinas (rama principal `main`; el trabajo en curso se revisa en ramas antes de integrarlo). Commit inicial: `d3ac4d83bd736451445737a7533b1be66660a381`.

Documentos de referencia: [ARCHITECTURE.md](ARCHITECTURE.md) (arquitectura, flujo y decisiones) · [DATABASE.md](DATABASE.md) (modelo de datos) · [README.md](README.md) (comandos).

---

## 1. Qué proyecto estamos construyendo

Una aplicación web para gestionar y distribuir propinas entre el personal de restaurantes. Reemplaza las planillas de Excel con fórmulas manuales por un sistema simple, profesional y que pueda crecer. Es un proyecto nuevo, sin relación con ningún proyecto anterior.

## 2. Objetivo del sistema

Reflejar exactamente el flujo real del restaurante:

- La propina **se calcula por día** (distribución diaria) pero **se paga por semana**.
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

- **Monorepo pnpm** con dos piezas: `packages/tip-engine` (motor de cálculo) y `apps/web` (aplicación; por ahora solo Prisma y sus tests).
- **Monolito full-stack** (Next.js, se agrega en la Fase 1) con capas `UI → actions → services → (tip-engine, repositories)`.
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
| **Fase 1 (aún no instalado)** | Next.js 15 App Router, Tailwind + shadcn/ui, React Hook Form + Zod, Auth.js (o Better Auth), Playwright, email transaccional (Resend recomendado) |

Versiones fijadas a propósito: TypeScript 6 (typescript-eslint aún no soporta TS 7) y Prisma 6 (se evitan cambios de la serie 7/8 hasta la Fase 1). pnpm 12 bloquea scripts de instalación por defecto; `pnpm-workspace.yaml` autoriza solo `prisma`, `@prisma/client` y `@prisma/engines`.

## 5. Decisiones ya aprobadas

- Flujo real: distribución diaria (cálculo) → liquidación semanal (acumulación) → sobre (pago).
- Adelantos: se descuentan al cerrar cada distribución diaria; el excedente queda como saldo pendiente aplicable a futuras distribuciones (ejemplo: propina $30.000, adelanto $40.000 → día $0, saldo $10.000).
- Pozo: mantener `team_id` opcional y soportar ambos modos; **no asumir una regla** hasta confirmarla con el negocio.
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

## 6. Qué se implementó hasta ahora (Fase 0)

**Repositorio en GitHub** (`LucaGutierrez/sistema-propinas`). En `main`: `d3ac4d8` (inicial), `3ab16a8` (este archivo) y `1e7f0f4` (migración inicial e invariantes). El CI corrió en verde sobre `1e7f0f4`. Los tests contra PostgreSQL real se agregan en la rama `claude/proyecto-continuacion-j1jaup`, pendiente de revisión.

**`packages/tip-engine`** (motor puro):
- `fixed.ts`, `money.ts`, `exchange.ts`: decimales de escala fija sobre `BigInt`, redondeo half-up, USD → ARS.
- `daily-distribution.ts`, `advances.ts`: puntos = horas × peso, mayor resto, adelantos del más antiguo al más nuevo, saldo pendiente.
- `weekly-settlement.ts`, `week.ts`: acumulación semanal, sobres con desglose por día, días sin distribución, fechas sin `Date`.
- **257 tests** pasan (casos calculados a mano, propiedades aleatorias con fast-check, test de pureza del código fuente) + 3 `todo` del Excel real.

**`apps/web/prisma`**:
- `schema.prisma` completo (usuarios, tokens de email, restaurantes, catálogos, distribución diaria, propinas, ítems, adelantos y aplicaciones, liquidación, sobres, eventos de sobre, auditoría). `prisma validate` y `prisma generate` correctos.
- `sql/0001_constraints.sql`: CHECK, índices únicos parciales y por expresión, triggers de inmutabilidad, transiciones de estado, bitácoras de solo inserción.

**`apps/web/test-db`**: **206 tests** de base de datos sobre PGlite (`pnpm test:db`), con el DDL generado desde `schema.prisma`. Verificados con pruebas de mutación (con el SQL anterior fallan los 40 tests de flujos prohibidos agregados el 2026-09-25).

**`apps/web/prisma/migrations/20260925000000_init`**: DDL de Prisma + copia literal de `sql/0001_constraints.sql`. Probada con `prisma migrate deploy` (primero en PGlite por socket; ahora en cada corrida de `test:pg` sobre PostgreSQL real); `prisma migrate diff` posterior vacío (Prisma no borra índices parciales, CHECK ni triggers). `test-db/migrations.test.ts` garantiza que la migración y la base de los tests son idénticas. **No aplicada en Neon.**

**`apps/web/test-pg`** (2026-09-25): **11 tests** contra un PostgreSQL real (`pnpm test:pg`, requiere `TEST_DATABASE_URL` de un servidor descartable; se niega a correr contra Neon). Cada corrida crea una base temporal, aplica la migración con `prisma migrate deploy` y la borra al final. Verifica: migración sin diferencias con `schema.prisma`; invariante **I11** con `FOR UPDATE` (dos cierres simultáneos sobre el mismo adelanto: el segundo espera y aplica solo el saldo; verificado que sin `FOR UPDATE` fallan); qué frena la base sola (CHECK ante incrementos relativos) y qué no (escritura absoluta sin bloqueo pierde una actualización → el servicio **debe** bloquear); cierre simultáneo del mismo día; índices únicos bajo concurrencia; y el límite del trigger anti-mezcla de pozos (documentado, lo valida el servicio). Detalle en `DATABASE.md` §10.

**Infraestructura**: ESLint con reglas que impiden `Number`, `Math`, `Date`, floats e imports externos en el motor; Prettier; `.gitattributes` (LF); `.gitignore` verificado (secretos, `.env*`, `reference/*` ignorados; `.env.example` versionado); `.github/workflows/ci.yml` con dos jobs: `check` (lint, typecheck, `test`, `test:db`, Prisma, motor sin dependencias) y `postgres` (`test:pg` sobre un contenedor **PostgreSQL 18**, misma versión mayor que Neon 18.6, para aproximar ese entorno; no se conecta a Neon).

**Documentación**: `ARCHITECTURE.md` (rev. 5), `DATABASE.md` (rev. 5), `README.md`, este `PROGRESS.md`.

**Verificado el 2026-09-25**: `lint`, `typecheck`, `test` (257 + 3 `todo`), `test:db` (206), `test:pg` (11, sobre PostgreSQL 16 local y temporal), `prisma validate`, `prisma generate` y `format:check` sin errores. `test:pg` se ejecutó **localmente** contra un PostgreSQL temporal, no en GitHub. El job `postgres` (PostgreSQL 18) fue agregado al CI pero **todavía no fue ejecutado por GitHub Actions**: el workflow solo corre con push a `main` o en un Pull Request, y el push de la rama no lo dispara.

## 7. Qué falta de la Fase 0

Todo lo construible sin recursos externos está hecho. Faltan verificaciones que dependen de cosas externas:

1. **PostgreSQL real**: ~~crear la migración inicial y revisar el drift~~ (hecho; verificado en cada corrida de `test:pg`). Falta **aplicarla en Neon** con `prisma migrate deploy` (requiere autorización explícita del usuario).
2. ~~**Concurrencia**~~: cubierta por `test:pg` (bloqueos `FOR UPDATE`, condiciones de carrera, índices únicos e invariante I11) contra PostgreSQL real, sin tocar Neon.
3. ~~**CI en GitHub**~~: el repositorio está en GitHub y el CI corrió en verde sobre `main`. El nuevo job `postgres` fue agregado pero **aún no corrió en GitHub Actions**; para verificarlo hay que abrir un Pull Request de la rama hacia `main`.
4. **Excel real**: colocar el `.xlsx` en `reference/` y convertirlo en fixtures anonimizados (los 3 `todo` de `excel-reference.test.ts`).

## 8. Qué debemos hacer inmediatamente al continuar

1. Correr los comandos de verificación para confirmar que todo sigue en verde (ver más abajo).
2. ~~Decidir A1 y A2~~ (hecho el 2026-09-25). Si es posible, confirmar el pozo (D1).
3. ~~Conseguir una base PostgreSQL real~~ (Neon, hecho el 2026-09-25). ~~Probar concurrencia~~ (hecho con `test:pg`). Queda aplicar la migración en Neon (pendiente 1 de la sección 7), solo con autorización.

Comandos (desde la raíz; en PowerShell/Bash puede hacer falta agregar `%APPDATA%\npm` al `PATH` porque pnpm se instaló con `npm install -g pnpm`):

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db
# Requiere un PostgreSQL descartable (nunca Neon):
TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test:pg
# Prisma necesita DATABASE_URL; para validate/generate sirve un valor ficticio:
DATABASE_URL="postgresql://user:password@localhost:5432/propinas" pnpm prisma validate
DATABASE_URL="postgresql://user:password@localhost:5432/propinas" pnpm prisma generate
```

## 9. Qué NO debemos hacer todavía

- No construir la interfaz ni instalar Next.js hasta tener aprobación explícita de la Fase 1.
- No implementar login, registro, verificación de email ni recuperación de contraseña antes de aprobar la Fase 1 (A1 y A2 ya están decididos).
- No aplicar migraciones en Neon ni modificar esa base sin autorización explícita del usuario.
- No modificar el motor de cálculo ni el esquema "por costumbre": cualquier cambio debe pasar `test`, `test:db` y actualizar `DATABASE.md`.
- No usar `Number`, `Math`, `Date` ni floats en `packages/tip-engine` (ESLint y los tests lo impiden).
- No convertir en tests los números de ejemplo de la conversación (Roro $516.447, etc.).
- No versionar datos reales (Excel con sueldos, `.env`, credenciales).
- No asumir la regla del pozo (único o por equipo). No afirmar que el SQL fue probado en Neon: se probó en PGlite y en PostgreSQL real descartable (`test:pg`), no en Neon.
- No correr `test:pg` apuntando a Neon ni a una base con datos (crea y borra bases).
- No hacer `push` sin que el usuario lo pida, ni merge a `main` sin su aprobación.

## 10. Problemas y decisiones pendientes

| # | Pendiente | Detalle |
|---|---|---|
| A1 | Proveedor de email en producción | **Postergado (2026-09-25).** No hay dominio propio todavía. Se desarrolla con `ConsoleMailer` detrás de la interfaz `Mailer`; el proveedor (Resend recomendado, requiere dominio) se elige antes de publicar. No bloquea la Fase 1. |
| A2 | Auth.js vs Better Auth | **Decidido (2026-09-25): Better Auth.** Trae verificación de email y reset. Pendiente al empezar la Fase 1: conciliar sus tablas (`user`, `session`, `account`, `verification`) con `users` y `auth_tokens` del esquema actual, y actualizar `DATABASE.md`. |
| A3 | Autorización de reversiones | Hoy es por rol (`OWNER`/`ADMIN` ejecutan y autorizan). Si se prefiere "solicitud + aprobación" de dos personas, el modelo ya separa `performed_by` y `authorized_by`. |
| A4 | Verificación de la fórmula | `puntos = horas × peso del puesto` y reparto proporcional salen de la descripción inicial. **No se pudo ver la captura del Excel** (no llegó a la conversación); reenviarla o colocar el `.xlsx` en `reference/` para confirmarlo. |
| D1 | Pozo del negocio real | Confirmar si el restaurante usa pozo único o pozos por equipo. El modelo soporta ambos; no bloquea nada. |
| — | Verificación de email obligatoria | Propuesta: el usuario no accede a la app hasta verificar el correo (con opción de reenviar). Confirmar. |
| — | Regla de días fuera de una liquidación cerrada | Una distribución con fecha dentro de una semana ya liquidada se rechaza hasta anular la liquidación. Confirmar que es lo deseado. |
| — | Versiones de PostgreSQL | Resuelto: Neon ofrece 18.6 y PGlite 18.3 (misma versión mayor). |
| — | Tipos de ítem por día | Un ítem por empleado por distribución (si cambia de puesto en el día se carga el principal). Limitación conocida; extensión posible. |

---

## NEXT STEP

**Cuando retomemos: revisar la rama `claude/proyecto-continuacion-j1jaup` (tests contra PostgreSQL real) y, si se aprueba, integrarla a `main`. Después, aplicar la migración en Neon (solo con autorización explícita).**

1. **Verificar el estado:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (257), `pnpm test:db` (206) y `pnpm test:pg` (11) en verde.
2. **Verificar el CI real:** abrir un Pull Request de `claude/proyecto-continuacion-j1jaup` hacia `main` (solo con aprobación del usuario; abrirlo no hace merge) para que GitHub Actions ejecute por primera vez los jobs `check` y `postgres` (PostgreSQL 18), y confirmarlos en verde.
3. **Integrar a `main`** (cuando el usuario lo apruebe).
4. **Aplicar en Neon** (cuando el usuario lo autorice): desde `apps/web`, `pnpm exec prisma migrate deploy`; después `prisma migrate status` y `prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma` (debe dar vacío).
5. **Fase 1, paso 1** (solo con aprobación explícita): scaffold de Next.js en `apps/web` + Better Auth (conciliar sus tablas con `users`/`auth_tokens`), siguiendo el orden del MVP. Al escribir los servicios de cierre, respetar el protocolo de bloqueo que prueba `test:pg` (`FOR UPDATE` sobre la distribución y los adelantos; validar la mezcla de pozos dentro de la transacción).

No se avanza a la Fase 1 sin que el usuario lo apruebe.
