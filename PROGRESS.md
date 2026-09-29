# PROGRESS.md — Estado del proyecto

Última actualización: 2026-09-29 (M1: métodos de participación, puntos individuales y formato de la porción; migración `20260929000000_participation_methods` creada y probada en local, **NO aplicada en Neon**. Antes: Fase 2 cerrada, Better Auth en production. Pendiente: despliegue y M1 en Neon con autorización.)
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

**Neon migrado correctamente** (verificado el 2026-09-26, solo lectura, sin modificar la base): la migración `20260925000000_init` está aplicada en Neon (PostgreSQL 18.6). *(Estado de ese día para la migración inicial; después se aplicó también `20260926000000_distribution_policies`, ver §6.3.)*
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

Pasa a la base el modelo aprobado en [CONFIG-MODEL.md](CONFIG-MODEL.md) y ya implementado en la demo. Detalle en `DATABASE.md` rev. 6. No toca `packages/tip-engine`; la demo sigue en `localStorage`.

- **Tablas nuevas:** `distribution_policy_versions` (un parámetro por columna, enums con **solo** las opciones implementadas, `template_code`/`template_version` para la configuración estándar, que vive en el código; origen `STANDARD`/`COPY`/`CHANGE`; `period_start_weekday` configurable: lunes es el estándar, no una regla), `policy_version_positions` (porción `NUMERIC(20,10)` de cada puesto en la versión), `period_policy_changes` (bitácora automática o con motivo), `period_hours` (horas totales del período por empleado; tope 24 × días del período, sin límite de negocio inventado).
- **Cambios:** `restaurants.current_policy_version_id` (sin `pool_mode` ni `week_starts_on`); `positions` como identidad estable (sin `weight`, `team_id` opcional, nombre único por restaurante sin distinguir mayúsculas; renombrar no crea versión); repartos `DAY`/`PERIOD` con `date_from`/`date_to` y sin superposición mediante una **restricción de exclusión** (`btree_gist`), que la hace cumplir también entre transacciones concurrentes (reemplaza `date`, `pool_mode`, `team_id`, el índice por día y equipo y el trigger anti-mezcla; I13 pasa a "sin superposición"); `tip_entries.entry_date`; `portion_snapshot` y puntos `NUMERIC(30,12)`; datos de anulación en `advances`; `weekly_settlements.policy_version_id` + `policy_snapshot` (JSONB, solo auditoría) + `calc_version` obligatorios al cerrar.
- **Reglas en la base:** versiones, sus puestos y la bitácora son de solo inserción; los puestos de una versión solo se insertan en la transacción que la crea; el período solo cambia de versión con su registro en la misma transacción, y solo estando `OPEN`; un período cerrado conserva versión y snapshot. Se mantienen I1–I12, revisiones con `supersedes` y el modelo de saldo pendiente de adelantos (sin filas artificiales de "Saldo anterior").
- **Migración `20260926000000_distribution_policies`:** guarda "tablas de negocio vacías", DDL de Prisma y copia literal de `sql/0002_distribution_policies.sql`. `sql/constraints.sql` es el conjunto vigente que usan los tests; `0001_constraints.sql` no se tocó (ya está aplicado en Neon).
- **Tests:** `test:db` **250** (nuevo `policies.test.ts`, tests de alcance, superposición, fecha de la propina, tope de horas genérico — 24 × días del rango —, anulación de adelantos y la guarda de la migración); `test:pg` **19** (superposición bajo concurrencia incluso en `REPEATABLE READ`, versiones simultáneas, marcas por transacción, cierre vs. cambio de versión, horas durante un cierre; `migrate diff` vacío). App: los 12 importes de la semana de Library quedan fijados como regresión y son idénticos con la porción de 10 decimales; 0,65/45 se representa. La fórmula provisional y el motor no cambiaron.
- **Revisión de lo retirado con `pool_mode`/`team_id`:** el CHECK `SINGLE ⇔ team_id IS NULL`, el trigger anti-mezcla y el índice "una vigente por día y equipo" solo tenían sentido con dos modos de pozo; con `SINGLE_POOL` la restricción de exclusión es más fuerte que el índice anterior (también impide solapamientos entre rangos). No se perdió ninguna protección vigente. Un pozo por equipo se agregará como nueva opción de `pool_structure` con su migración (clave de pozo en el reparto y en la restricción).
- **Verificado localmente (2026-09-26):** `typecheck`, `lint`, `format:check`, `test` (web 82, tip-engine 257 + 3 `todo`), `test:db` (250), `test:pg` (19, sobre un PostgreSQL 18 local y descartable: `embedded-postgres` en una carpeta temporal, nunca Neon), `prisma validate`/`generate` y `next build`.
- **Neon (2026-09-26):** aplicada en Neon production el 2026-09-26 tras validarla en la branch de prueba `test-distribution-policies`: `migrate status` al día, `migrate diff` vacío, catálogo idéntico a la base de los tests y sin datos de negocio. Detalle en `DATABASE.md` §10 ("Estado en Neon").
- **Pendiente:** los servicios que escriben estas tablas (crear/cambiar política, abrir y cerrar período con snapshot) llegan con la persistencia real (§11).

### 6.4 Fase 1 — primera pantalla con persistencia real (2026-09-26)

**"Configuración de distribución" lee y escribe la política en la base** (Prisma). La demo sigue funcionando igual y es la fuente por defecto. Detalle en `DATABASE.md` §11 y `ARCHITECTURE.md` §6.1.

- **Fuente de datos:** sin `GUTIP_DATA_SOURCE=database`, la pantalla usa la demo (`localStorage`). Con esa variable usa la base, con el restaurante de `GUTIP_RESTAURANT_ID` y el operador de `GUTIP_OPERATOR_EMAIL` (se verifica su membresía; edita `OWNER`/`ADMIN`). No hay login todavía: **no activar en un despliegue**.
- **Capa de servidor:** `src/server/policy/repository.ts` (lecturas, todas por `restaurantId`) y `src/server/policy/service.ts` (cada cambio = versión nueva en una transacción con bloqueo del restaurante; puntero vigente; período abierto con registro automático; período reabierto conserva su versión; renombrar un puesto no crea versión). Acciones del servidor en `src/app/configuracion/actions.ts`.
- **Separación demo / base:** reglas puras compartidas en `src/lib/policy/` (la demo usa las mismas validaciones y mensajes); vista sin fuente de datos y un contenedor por fuente.
- **Bootstrap:** `pnpm --filter @propinas/web db:bootstrap --confirm` crea, idempotente, operador + membresía `OWNER` + restaurante + política estándar v1 (Supervisor 0,014, Barra 0,022, Salón 0,022, Bacha 0,007). No crea personal. No es un seed de Prisma; exige `--confirm`, se niega con `NODE_ENV=production` y pide `--allow-remote` para una base no local. **No se ejecutó contra Neon.**
- **Dependencias:** `tsx` (dev) para correr el bootstrap; `pnpm-workspace.yaml` declara `esbuild: false` (pnpm 12 lo exige; sin eso `pnpm install --frozen-lockfile` falla).
- **Tests:** web 91 (planificadores de cambios, plantilla estándar, traducción a la base), `test:pg` 33 (14 del servicio con Prisma: ver `DATABASE.md` §11). Probado además en el navegador contra un PostgreSQL local descartable: cambiar una porción crea la versión 2 y conserva la 1.
- **Pendiente:** inicializar el restaurante en Neon (con autorización); migrar Personal, Semana, adelantos y sobres; Better Auth (`requireAccess`).

### 6.5 Fase 2 — autenticación y acceso real con Better Auth (2026-09-27; commit `934f1a6`; aplicada en Neon production)

- **Better Auth 1.7.6** (única dependencia nueva) sobre nuestras tablas: `users` es su modelo `user` (sin usuarios paralelos); tablas nuevas `sessions`, `accounts`, `verifications`, `auth_rate_limits`. Email + contraseña (scrypt), registro público deshabilitado, sesión de 7 días en Postgres, cookie `httpOnly`/`sameSite=lax`/`secure` en producción, control de origen y límite de intentos en Postgres. Sin plugin de organizaciones.
- **Acceso:** `src/server/access/` — `requireAccess({ restaurantId, roles })` = sesión real → membresía → rol → contexto tipado; sin sesión → login, sin membresía / otro restaurante → 404, rol insuficiente → sin permiso. Roles `OWNER` (uno por restaurante), `MANAGER`, `EDITOR`, `VIEWER`, `SELF` (con `memberships.employee_id`, solo su empleado). Restaurante activo: preferencia en cookie validada contra las membresías. Alta de restaurante (`server/restaurants/service.ts`) crea la membresía OWNER.
- **Configuración de distribución** ya no usa `GUTIP_OPERATOR_EMAIL`/`GUTIP_RESTAURANT_ID`: página y acciones usan sesión + membresía; cada acción vuelve a verificar el rol (OWNER/MANAGER cambian; EDITOR/VIEWER solo ven; SELF no ve).
- **UI mínima:** `/login`, `/cuenta` (sesión, restaurantes y rol, restaurante activo, cerrar sesión) y una barra de sesión en Configuración. El resto del shell sigue siendo el de la demo.
- **Transición del dueño existente (Neon):** migración `20260928000000_auth` no destructiva (conserva usuarios, membresías y roles; guarda si hay `ADMIN` o emails con mayúsculas) + `db:operator-password` (agrega la contraseña al usuario existente, sin duplicarlo). `db:bootstrap` se conserva (no agrega un segundo OWNER).
- **Verificado localmente:** lint, format, typecheck, `test` (web 102 + tip-engine 257), `test:db` 270, `test:pg` 66 (PostgreSQL 18 descartable), prisma validate/generate, build. Migración probada sobre una copia local con los mismos datos que Neon. Navegador (base local): login, error de contraseña, Configuración como OWNER (cambio → versión nueva a su nombre) y como VIEWER (sin edición), `/cuenta`, logout (borra la sesión).

- **Neon production (2026-09-27):** migración `20260928000000_auth` validada primero en la branch `auth-test` (creada desde production con sus datos) y luego aplicada en production con guardas previas; `migrate status` al día, `migrate diff` vacío, huella de datos idéntica (detalle en `DATABASE.md` §10, "Estado en Neon — autenticación"). El OWNER existente tiene su credencial (`db:operator-password`, sin duplicar el usuario). **Login real verificado** desde la app local contra production: sesión creada, `/cuenta` y `/configuracion` (política v2 real, Salón 0,025) correctos, logout borra la sesión. Falta el despliegue (Vercel).

### 6.7 Primer reparto real con la base (P0, 2026-09-28; sin migraciones)

- **"Repartir propinas"** (`/reparto`): elegir la semana (esta o la pasada; se ajusta al día de inicio de la política y a la zona del restaurante), propina del período (total o por día), horas totales por persona (Enter avanza, pegar una columna de Excel, 0 = no trabajó, vacío = "Sin horas cargadas"), adelantos (registrar / anular con motivo), resultado **en vivo** con el valor de la hora por puesto y "¿Cómo se calculó?", revisión y **cierre**. Detalle de un reparto cerrado en `/reparto/[id]` (imprimible). `/semana` y `/semanas/[id]` redirigen ahí en modo base.
- **Modelo existente, sin tablas nuevas:** `weekly_settlements` (período OPEN → CLOSED con `policy_snapshot` y `calc_version = provisional-1`), `daily_distributions` alcance `PERIOD` (DRAFT → CLOSED ligado al período) con `tip_entries` (la propina; el total va en una fila con nota "Total del período"), `period_hours`, `advances` + `advance_applications`, `weekly_payments` (PENDING) + evento CREATED y `audit_log`.
- **Cálculo:** `buildPeriodPreview` (`lib/distribution/period-preview.ts`) sobre la fórmula existente `computeProvisionalDistribution` (sin cambios). La pantalla y el cierre usan la misma función con los mismos datos (`loadPeriodData`). Caso Library verificado: 5,398 puntos, $ 64.466,47 por punto, Ivan $ 40.613,88, suma exacta.
- **Reglas de cierre:** propina > 0; toda persona activa con horas cargadas (0 vale); al menos una con horas; puesto de la configuración; en pesos enteros, propina sin centavos. Un reparto abierto a la vez. Cerrado = inmutable (servicio + triggers); corregir (anular y rehacer) queda para la siguiente etapa.
- **Permisos:** ver repartos `OWNER/MANAGER/EDITOR/VIEWER`; cargar `OWNER/MANAGER/EDITOR`; cerrar `OWNER/MANAGER` (`CAN.viewPeriods/editPeriod/closePeriod`).
- **Rendimiento:** sesión y acceso memoizados por pedido (`cache`), restaurante activo en una sola lectura, `loading.tsx`/`error.tsx`, middleware que manda al login sin renderizar si no hay cookie, rate limit fuera de `/get-session`, guardar horas/propina sin re-render, `apps/web/vercel.json` con `regions: ["gru1"]` (misma región que Neon). Consultas por pantalla (local): `/` 21 → 12, `/personal` 20 → 10, `/configuracion` 21 → 11.

### 6.8 Sobres con la base (2026-09-28; sin migraciones)

- **`/sobres`** (menú "Sobres"): repartos cerrados con cuántos sobres faltan preparar/entregar; **`/sobres/[id]`**: un sobre por persona con importe (propina − adelanto), estado (Pendiente / Preparado / Entregado / Sin importe), quién y cuándo, historial. "Preparar todos", preparar uno, deshacer la preparación (motivo), entregar (confirmación) y revertir la entrega (motivo). Desde el reparto cerrado: "Preparar y entregar sobres". `/mis-sobres` redirige a `/sobres`.
- **Modelo existente:** `weekly_payments` (los crea el cierre del reparto, PENDING, con los importes de `daily_distribution_items`) + `weekly_payment_events` (un evento por transición) + `audit_log` (entregas y reversiones). Sobres **no recalcula nada**: si a un reparto cerrado le faltara un sobre, se crea desde sus ítems (idempotente, `@@unique(settlement_id, employee_id)`).
- **Reglas:** `PENDING → PREPARED → DELIVERED`; `PREPARED → PENDING` y `DELIVERED → PREPARED` con motivo (≥ 10) — la reversión además con `authorized_by` y audit_log. Solo repartos CLOSED (abierto: todavía no hay sobres; VOIDED: congelado). Los importes y la entrega los congela la base (`fn_weekly_payments_guard`).
- **Permisos:** ver `OWNER/MANAGER/EDITOR/VIEWER` y `SELF` (solo lo suyo, `employeeScope`); preparar/entregar Dueño y Encargado, y el Editor si la versión de la política del período dice "Encargado y Editor" (`canHandleEnvelopes`); revertir solo Dueño/Encargado (`CAN.revertDelivery`).
- **Concurrencia:** cada operación bloquea el reparto o el sobre (`FOR UPDATE`) y relee su estado: preparar/entregar a la vez no duplica eventos (test).

### 6.9 Historial con la base (2026-09-28; sin migraciones, solo lectura)

- **`/historial`** (menú "Historial"): repartos CLOSED y VOIDED (los abiertos no), del más nuevo al más viejo, con total, personas, sobres entregados, lo que falta entregar y quién/cuándo cerró. Filtros por URL (estado, rango de semanas, persona) y paginación de 20. **`/historial/[id]`**: resumen (totales, puntos, versión de la política y redondeo del snapshot), detalle por persona (horas, porción, puntos, %, bruto, adelanto, final, estado del sobre y si tuvo una entrega revertida), adelantos (registrado / descontado en este reparto / pendiente hoy) y actividad (cierre, preparación, entrega, reversión con motivo, anulación). "Ver sobres" lleva a `/sobres/[id]`.
- **Fuente de verdad:** lo guardado al cerrar (`daily_distribution_items`, `weekly_settlements` con su `policy_snapshot`, `weekly_payments`/`weekly_payment_events`, `advances`/`advance_applications`). No usa el motor ni la política actual (lo verifica un test estático y uno que cambia la política después del cierre). Un reparto anulado se muestra con su motivo; si su reparto diario se desvinculó al anularlo, se lo encuentra por fechas.
- **Permisos:** todos los roles leen; SELF solo lo suyo (sin totales ni otras personas). No hay ninguna acción: es solo lectura.

### 6.10 Anular y rehacer un reparto cerrado (2026-09-28; sin migraciones)

- **Anular** (`/historial/[id]`, Dueño/Encargado, motivo ≥ 10 y confirmación): una transacción que sigue DATABASE.md §6. Solo si ningún sobre está entregado (si lo hay, primero se revierte la entrega en Sobres); sobres PENDING/PREPARED → VOIDED con evento y motivo; el reparto diario se desvincula y queda VOIDED; sus descuentos de adelantos se revierten (`reverted_at`, no se borran) y esos adelantos vuelven a tener saldo; el período queda VOIDED (quién, cuándo, motivo) + `audit_log`. Nada del original se edita ni se borra.
- **Rehacer** (reparto anulado, Dueño/Encargado): período nuevo de la misma semana con `revision + 1`, `supersedes_settlement_id` y la **misma versión de la política** que el anulado; propina, horas y cierre se cargan de nuevo; al cerrar, cada sobre nuevo apunta al anulado (`supersedes_payment_id`) y los adelantos se aplican con aplicaciones nuevas. Idempotente; no se puede con otro reparto abierto. "Empezar" esa semana también la rehace (y lo bloquea para el Editor).
- **Concurrencia:** bloqueos en el orden de Sobres (período → sobres → adelantos por id): dos anulaciones a la vez dejan un solo evento; anular vs entregar nunca deja un período anulado con un sobre entregado (tests).

### 6.11 Motor de participación puro (Fase 1 del modelo de participación, 2026-09-29; sin migraciones)

- `lib/distribution/participation.ts` (puro, enteros): `participationWeight` (UNA función para los tres métodos: ponderado = horas E2 × porción E4 × puntos E2 = E8; el factor que el método no usa vale 1), `computePool` (mayor resto en la unidad de redondeo), `applyAdvances` (adelanto por persona, una vez, sobre el bruto total) y `spreadAdvances` (reparte ese descuento entre los ítems de la persona en orden).
- `buildPeriodPreview` (pozo único) usa ese motor; con BY_POSITION da exactamente los importes, porcentajes, adelantos y puntos de `computeProvisionalDistribution` (propiedad sobre 500 + 500 repartos aleatorios y los 12 importes de Library). `shift-preview.ts` (pozos por día y turno) está listo como función pura, **sin uso** hasta M3.

### 6.12 M1: métodos de participación, puntos individuales y formato de la porción (2026-09-29; migración creada, NO aplicada en Neon)

- **Modelo:** porción = factor del puesto (política, versionada) · puntos = de cada persona (`employees.individual_points`, 1,00 por defecto, > 0; NO versionados; `audit_log` `employee.points_changed`) · ponderado = según `portion_mode` (BY_POSITION horas × porción · BY_POINTS horas × puntos · BY_POSITION_TIMES_POINTS horas × porción × puntos) · formato de la porción = `restaurants.portion_display` (DECIMAL/PERCENT), solo presentación: no crea versión (`audit_log` `restaurant.portion_display_changed`).
- **Base:** migración `20260929000000_participation_methods` (aditiva; ver `DATABASE.md` rev. 7 y §10) + `sql/0004_participation.sql`. Lo existente queda en BY_POSITION, DECIMAL y 1,00 punto; los ítems cerrados no cambian.
- **Cierre:** guarda en cada ítem la porción usada (NULL con BY_POINTS), los puntos usados (NULL con BY_POSITION) y el ponderado exacto (8 decimales); `policy_snapshot` suma `portionMode` y `portionDisplay` (auditoría). `calc_version`: `provisional-1` con BY_POSITION (idéntico al anterior) y `provisional-2` con puntos.
- **Pantallas:** Configuración (método de participación; "Mostrar la porción como" decimal/porcentaje; porciones que se escriben en el formato elegido y se guardan siempre como fracción), Personal (Porción vs. Puntos explicados, puntos editables por Dueño/Encargado), Reparto (método visible, puntos por persona si el método los usa, "¿Cómo se calculó?" con el ponderado del método), Historial y detalle de un reparto cerrado (del snapshot). En la UI, "Ponderado" es horas × porción/puntos, "Participación" es el % y "Puntos" son solo los individuales. La demo del navegador no tiene puntos: ahí esos métodos aparecen como "Solo con la base de datos".
- **Pruebas:** web 213, tip-engine 257 (+3 todo), `test:db` 286 (nuevo `participation.test.ts` y la migración M1 aplicada sobre una base con un reparto cerrado), `test:pg` 183 (nuevo `participation.test.ts`: 28 casos — restaurantes existentes, BY_POSITION idéntico, BY_POINTS, puesto × puntos, formato sin versión, puntos inválidos, cambios después del cierre, sobres, aislamiento, permisos y cierre concurrente con un cambio de puntos). Verificado además en el navegador contra un PostgreSQL local descartable (configurar método y formato, porción escrita en %, puntos, reparto, cierre, historial y sobres).

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
- No implementar registro público, invitaciones, verificación de email ni recuperación de contraseña sin aprobación (el login con email y contraseña ya existe, §6.5). Cambios a `schema.prisma` requieren aprobación.
- No convertir la fórmula provisional en regla definitiva ni cambiar el contrato del motor hasta resolver P1–P6 (§10).
- No aplicar migraciones en Neon ni modificar esa base sin autorización explícita del usuario.
- No modificar el motor de cálculo ni el esquema "por costumbre": cualquier cambio debe pasar `test`, `test:db` y actualizar `DATABASE.md`.
- No usar `Number`, `Math`, `Date` ni floats en `packages/tip-engine` (ESLint y los tests lo impiden).
- No convertir en tests los números de ejemplo de la conversación (Roro $516.447, etc.).
- No versionar datos reales (Excel con sueldos, `.env`, credenciales).
- No agregar a los enums de la política opciones que GUTIP todavía no calcula. En Neon se verificó la **estructura** (objetos, checksum, sin drift), no el **comportamiento**: los triggers y la concurrencia se probaron en PGlite y en PostgreSQL real descartable (`test:pg`), no en Neon.
- No correr `test:pg` apuntando a Neon ni a una base con datos (crea y borra bases).
- No aplicar `20260928000000_auth` en Neon, ni correr `db:bootstrap`/`db:operator-password` contra Neon, ni activar `GUTIP_DATA_SOURCE=database` en un despliegue sin autorización explícita.
- No hacer `push` sin que el usuario lo pida, ni merge a `main` sin su aprobación.

## 10. Problemas y decisiones pendientes

| # | Pendiente | Detalle |
|---|---|---|
| A1 | Proveedor de email en producción | **Postergado (2026-09-25).** No hay dominio propio todavía. Se desarrolla con `ConsoleMailer` detrás de la interfaz `Mailer`; el proveedor (Resend recomendado, requiere dominio) se elige antes de publicar. No bloquea la Fase 1. |
| A2 | Auth.js vs Better Auth | **Implementado (2026-09-27): Better Auth** sobre `users` + `sessions`/`accounts`/`verifications`/`auth_rate_limits` (§6.5). Quedan sin uso `auth_tokens`, `rate_limits` y las columnas `password_hash`, `email_verified_at`, `password_changed_at` (limpieza en una migración futura). |
| A3 | Autorización de reversiones | Hoy es por rol (`OWNER`/`MANAGER` ejecutan y autorizan). Si se prefiere "solicitud + aprobación" de dos personas, el modelo ya separa `performed_by` y `authorized_by`. |
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

## 11. Pendiente después del núcleo de Better Auth (§6.5)

- ~~**Neon:** aplicar `20260928000000_auth` y definir la credencial del dueño~~ (hecho el 2026-09-27, §6.5). La branch `auth-test` quedó migrada y ya no hace falta: se puede borrar desde la consola de Neon.
- **Despliegue (Vercel, con autorización):** `DATABASE_URL`, `GUTIP_DATA_SOURCE=database`, `BETTER_AUTH_URL` (dominio público `https://…`) y un `BETTER_AUTH_SECRET` propio del entorno, distinto del local.
- **Invitaciones** (tablas propias) y alta de miembros con rol; **registro** público (hoy deshabilitado).
- **Email** (A1): verificación y recuperación de contraseña con Better Auth + `Mailer`.
- **IP del cliente para el límite de intentos** según el hosting (encabezado confiable / proxies de confianza): sin eso, en producción todos comparten un contador por ruta.
- **Shell:** el menú y el encabezado siguen siendo los de la demo ("Modo demo", selector de locales); pasarlos a la sesión cuando se migren las demás pantallas.
- **Pantallas en la demo:** Inicio, Semana, Historial, Personal, Acceso, Mis sobres, Mis locales. Cada una pasa a `requireAccess` + repositorios por `restaurantId` (SELF con `employeeScope`) al migrarla.
- **Limpieza** de lo anterior a Better Auth (`auth_tokens`, `rate_limits`, columnas viejas de `users`) en una migración aparte.

---

## NEXT STEP

**Cuando retomemos: M1 (participación) implementada y probada en local, sin commit. La migración `20260929000000_participation_methods` NO está en Neon: aplicarla solo con autorización (branch de prueba → verificación → production). Después: M2 (catálogo de turnos) y M3 (pozos por día y turno). Neon production tiene las 3 migraciones anteriores, el restaurante real con su OWNER (con credencial de Better Auth) y la política v1/v2; el login real contra production se verificó desde la app local. La app todavía no está desplegada.**

1. **Verificar el estado:** `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (web 213 + tip-engine 257), `pnpm test:db` (286), `pnpm test:pg` (183, PostgreSQL descartable en UTF8), `pnpm prisma validate/generate`, `pnpm --filter @propinas/web build`.
2. **Despliegue (solo con autorización):** Vercel con sus variables (§11) y el encabezado confiable de IP para el límite de intentos.
3. **Siguientes pantallas** con `requireAccess` (Personal, Semana…) y las decisiones pendientes de §10/§11.

No se modifica `schema.prisma`, las migraciones ni Neon sin aprobación explícita del usuario.
