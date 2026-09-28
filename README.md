# Sistema de Propinas

Aplicación web para gestionar y distribuir propinas entre el personal de restaurantes.

- Arquitectura y decisiones: [ARCHITECTURE.md](ARCHITECTURE.md)
- Modelo de datos: [DATABASE.md](DATABASE.md)
- Estado y próximos pasos: [PROGRESS.md](PROGRESS.md)
- Repositorio: https://github.com/LucaGutierrez/sistema-propinas

## Estado

**Fase 0 completa (motor y esquema).** Todavía no hay interfaz ni login: Next.js se agrega en la Fase 1.

| Pieza | Estado |
|---|---|
| `packages/tip-engine` — motor de cálculo (TypeScript puro, `BigInt`, sin dependencias) | Implementado y testeado |
| `apps/web/prisma/schema.prisma` — esquema completo | Validado; cliente generado |
| `apps/web/prisma/sql/constraints.sql` — CHECK, índices parciales, triggers (conjunto vigente; `0001_*`/`0002_*` son los deltas de cada migración) | Probado con `pnpm test:db` (PGlite) y `pnpm test:pg` (PostgreSQL real) |
| `apps/web/prisma/migrations/` — inicial + política de distribución versionada + autenticación (Better Auth) | Probadas con `prisma migrate deploy` en `test:pg`; **las tres aplicadas en Neon production** |
| `apps/web/test-db/` — tests de base de datos (PGlite) | Implementados; corren en el CI |
| `apps/web/test-pg/` — migraciones, concurrencia e invariante I11 (PostgreSQL real) | Implementados; corren en el CI (job `postgres`, PostgreSQL 18) |
| Excel de referencia | Pendiente: colocar el `.xlsx` en `reference/` (no se versiona) |

## Requisitos

- Node.js 24 o superior
- pnpm (`npm install -g pnpm`; la versión se fija en `packageManager`)

## Comandos

```bash
pnpm install
pnpm lint          # ESLint (incluye reglas de pureza del motor)
pnpm typecheck     # tsc: el motor se compila también sin tipos de Node ni DOM
pnpm test          # tests del motor (Vitest + fast-check)
pnpm test:db       # tests del SQL/esquema sobre PGlite (PostgreSQL en memoria)
pnpm test:pg       # migraciones y concurrencia sobre un PostgreSQL real (ver abajo)
pnpm format        # Prettier

# Prisma (requiere DATABASE_URL; para validate/generate sirve un valor ficticio)
cp .env.example apps/web/.env
pnpm prisma validate
pnpm prisma generate
```

### App con base de datos y login (Better Auth)

En `apps/web/.env`: `DATABASE_URL`, `GUTIP_DATA_SOURCE=database`, `BETTER_AUTH_SECRET` (32+ caracteres
aleatorios) y `BETTER_AUTH_URL=http://localhost:3000`. No hay registro público: la primera cuenta es el
dueño que crea `db:bootstrap`, y su contraseña se define aparte (se pide por teclado, nunca en `.env`):

```bash
pnpm --filter @propinas/web db:bootstrap --confirm           # restaurante + dueño (OWNER) + política v1
pnpm --filter @propinas/web db:operator-password --confirm   # contraseña del dueño (--reset para cambiarla)
pnpm --filter @propinas/web dev                               # http://localhost:3000/login
```

Contra una base no local (Neon) los dos scripts exigen además `--allow-remote`. Roles y acceso:
`ARCHITECTURE.md` §9.

## Estructura

```
packages/tip-engine/   Motor de cálculo puro (sin Next.js, Prisma ni base de datos)
apps/web/prisma/       Esquema Prisma y SQL de restricciones/triggers
apps/web/test-db/      Tests de base de datos (PGlite)
apps/web/test-pg/      Tests contra PostgreSQL real: migraciones y concurrencia
reference/             Excel real del restaurante (solo local, ignorado por git)
```

## El motor de cálculo

- Dinero en centavos (`bigint`); horas y pesos ×100; cotización ×10⁶. Nunca `Number`.
- Reparto por mayor resto: la suma de los pagos coincide siempre con el total, al centavo.
- Independiente de la aplicación: `tip-engine` solo importa sus propios archivos. Lo verifican el
  compilador (`tsconfig.src.json` sin tipos de Node/DOM), ESLint y un test de pureza.

## Base de datos: qué está verificado y qué no

- `prisma validate` y `prisma generate`: ejecutados con éxito.
- `pnpm test:db`: aplica el DDL que Prisma genera desde `schema.prisma` y `sql/constraints.sql` sobre
  **PGlite** (PostgreSQL 18.3 compilado a WebAssembly, en memoria) y comprueba CHECK, índices únicos,
  claves foráneas, triggers de inmutabilidad, estados, adelantos y bitácoras de solo inserción. No
  duplica lógica de negocio: inserta filas y verifica que PostgreSQL las acepta o rechaza.
- **PGlite no es idéntico a un PostgreSQL de producción.** Una sola conexión, así que no prueba
  concurrencia (bloqueos `FOR UPDATE`, condiciones de carrera); versión distinta a la del proveedor
  que se elija; no cubre extensiones, roles/permisos, pooling ni el flujo real de `prisma migrate`
  (la concurrencia y el flujo de migraciones los cubre `test:pg`). Detalle en [DATABASE.md](DATABASE.md) §10.
- `pnpm test:pg`: corre contra un PostgreSQL **real y descartable** indicado en `TEST_DATABASE_URL`
  (con permiso `CREATEDB`; se niega a correr contra Neon). Crea una base temporal, aplica la migración
  con `prisma migrate deploy`, comprueba que `prisma migrate diff` quede vacío y prueba concurrencia
  con varias conexiones: bloqueos `FOR UPDATE`, la invariante I11 (un adelanto aplicado desde dos
  cierres simultáneos nunca supera su monto), índices únicos, versiones de la política y cierre de un
  período frente a un cambio de versión. Al terminar borra la base temporal.
  Detalle en [DATABASE.md](DATABASE.md) §10.

  ```bash
  TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres" pnpm test:pg
  ```

- CI (GitHub Actions): el job `check` corre lint, typecheck, `test`, `test:db` y Prisma; el job
  `postgres` corre `test:pg` sobre un contenedor PostgreSQL 18 (misma versión mayor que Neon).
- En Neon production están aplicadas las tres migraciones (`20260925000000_init`,
  `20260926000000_distribution_policies` —validada en la branch `test-distribution-policies`— y
  `20260928000000_auth`, el 2026-09-27, validada en la branch `auth-test`). `prisma migrate status` está al
  día y `prisma migrate diff` contra `schema.prisma` es vacío. Production tiene el restaurante real con su
  OWNER (con credencial de Better Auth) y la política v1/v2; el login real se verificó desde la app local.
  La app todavía no está desplegada. Detalle en [DATABASE.md](DATABASE.md) §10.
