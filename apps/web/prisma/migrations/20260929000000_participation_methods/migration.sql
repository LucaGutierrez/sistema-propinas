-- =============================================================================
-- Migración M1: métodos de participación, puntos individuales y formato de la porción.
--
-- ADITIVA y NO destructiva: no borra ni transforma filas. Lo existente queda así:
--   - políticas: portion_mode sigue en BY_POSITION (solo se agregan valores al enum);
--   - restaurantes: portion_display = DECIMAL (valor por defecto);
--   - empleados: individual_points = 1.00 (valor por defecto);
--   - ítems cerrados: conservan su portion_snapshot; individual_points_snapshot queda NULL
--     (con BY_POSITION los puntos no intervinieron). portion_snapshot pasa a admitir NULL
--     para los repartos futuros con BY_POINTS (la porción no interviene).
-- Los nuevos valores del enum no se usan en esta misma migración (PostgreSQL no lo permite
-- en la transacción que los crea).
--
-- Orden: DDL de Prisma (`prisma migrate diff` desde el esquema anterior) →
-- copia literal de sql/0004_participation.sql.
-- =============================================================================

-- CreateEnum
CREATE TYPE "portion_display" AS ENUM ('DECIMAL', 'PERCENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "portion_mode" ADD VALUE 'BY_POINTS';
ALTER TYPE "portion_mode" ADD VALUE 'BY_POSITION_TIMES_POINTS';

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "portion_display" "portion_display" NOT NULL DEFAULT 'DECIMAL';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "individual_points" DECIMAL(6,2) NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "daily_distribution_items" ADD COLUMN     "individual_points_snapshot" DECIMAL(6,2),
ALTER COLUMN "portion_snapshot" DROP NOT NULL;

-- =============================================================================
-- 0004_participation.sql — métodos de participación y puntos individuales (M1)
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 10. Participación: puntos individuales y snapshot del cálculo
-- -----------------------------------------------------------------------------

-- 10.1 Los puntos individuales del empleado son siempre positivos (1,00 por defecto).
ALTER TABLE employees
  ADD CONSTRAINT ck_employees_individual_points CHECK (individual_points > 0);

-- 10.2 Ítem de un reparto: los puntos usados, si el método los usó, son positivos; y el ponderado
--      siempre sale de al menos uno de los dos datos (la porción del puesto o los puntos).
ALTER TABLE daily_distribution_items
  ADD CONSTRAINT ck_ddi_individual_points
    CHECK (individual_points_snapshot IS NULL OR individual_points_snapshot > 0),
  ADD CONSTRAINT ck_ddi_weight_inputs
    CHECK (portion_snapshot IS NOT NULL OR individual_points_snapshot IS NOT NULL);
