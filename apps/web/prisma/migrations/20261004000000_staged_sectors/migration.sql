-- =============================================================================
-- Migración: reparto por sectores, en etapas.
--
-- ADITIVA y NO destructiva: no borra ni transforma filas. Lo existente queda así:
--   - políticas: pool_structure sigue en SINGLE_POOL (solo se agrega un valor al enum);
--   - puestos de cada versión: stage y stage_percent quedan NULL (sin asignar).
-- El nuevo valor del enum no se usa en esta misma migración (PostgreSQL no lo permite en la
-- transacción que lo crea).
--
-- Orden: DDL de Prisma (`prisma migrate diff` desde el esquema anterior) →
-- copia literal de sql/0005_staged_sectors.sql.
-- =============================================================================

-- AlterEnum
ALTER TYPE "pool_structure" ADD VALUE 'STAGED_SECTORS';

-- AlterTable
ALTER TABLE "policy_version_positions" ADD COLUMN     "stage" SMALLINT,
ADD COLUMN     "stage_percent" DECIMAL(5,2);

-- =============================================================================
-- 0005_staged_sectors.sql — reparto por sectores, en etapas
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 11. Reparto por sectores: etapa y porcentaje de cada puesto en una versión
-- -----------------------------------------------------------------------------

-- 11.1 Etapa y porcentaje van juntos (los dos o ninguno), la etapa es 1…9 y el porcentaje es
--      de su base (0 < % ≤ 100). Que cada etapa cierre (intermedias < 100 %, la última = 100 %)
--      lo valida el servicio al crear la versión, con mensajes para el usuario.
ALTER TABLE policy_version_positions
  ADD CONSTRAINT ck_pvp_stage_pair CHECK ((stage IS NULL) = (stage_percent IS NULL)),
  ADD CONSTRAINT ck_pvp_stage CHECK (stage IS NULL OR stage BETWEEN 1 AND 9),
  ADD CONSTRAINT ck_pvp_stage_percent
    CHECK (stage_percent IS NULL OR (stage_percent > 0 AND stage_percent <= 100));
