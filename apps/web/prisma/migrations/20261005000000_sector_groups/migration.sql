-- =============================================================================
-- Migración: sectores propios del reparto por sectores.
--
-- ADITIVA y NO destructiva: crea `policy_version_sectors` y agrega `sector_id` (NULL) a
-- `policy_version_positions`. No borra ni transforma filas: las versiones guardadas con el
-- formato anterior (etapa y % por puesto) quedan como están; la app pide volver a guardarlas
-- antes de repartir y los repartos ya cerrados se siguen viendo desde su snapshot.
--
-- Orden: DDL de Prisma (`prisma migrate diff` desde el esquema anterior) →
-- copia literal de sql/0007_sector_groups.sql.
-- =============================================================================

-- CreateEnum
CREATE TYPE "sector_base" AS ENUM ('TOTAL', 'REMAINDER');

-- AlterTable
ALTER TABLE "policy_version_positions" ADD COLUMN     "sector_id" UUID;

-- CreateTable
CREATE TABLE "policy_version_sectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "base" "sector_base" NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "policy_version_sectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_version_sectors_version_id_sort_order_key" ON "policy_version_sectors"("version_id", "sort_order");

-- CreateIndex
CREATE INDEX "policy_version_positions_sector_id_idx" ON "policy_version_positions"("sector_id");

-- AddForeignKey
ALTER TABLE "policy_version_positions" ADD CONSTRAINT "policy_version_positions_sector_id_fkey" FOREIGN KEY ("sector_id") REFERENCES "policy_version_sectors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version_sectors" ADD CONSTRAINT "policy_version_sectors_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- 0007_sector_groups.sql — sectores propios del reparto por sectores
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 13. Reparto por sectores: sectores de una versión (nombre, orden, base, %) y sus puestos
-- -----------------------------------------------------------------------------

-- 13.1 Nombre de 1 a 60 caracteres y único en la versión (sin distinguir mayúsculas), orden 1…9
--      y porcentaje de su base (0 < % ≤ 100). Que ningún sector pida más de lo que queda lo
--      valida el servicio al crear la versión, con mensajes para el usuario.
ALTER TABLE policy_version_sectors
  ADD CONSTRAINT ck_pvs_name CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  ADD CONSTRAINT ck_pvs_sort_order CHECK (sort_order BETWEEN 1 AND 9),
  ADD CONSTRAINT ck_pvs_percent CHECK (percent > 0 AND percent <= 100);

CREATE UNIQUE INDEX ux_pvs_version_name ON policy_version_sectors (version_id, lower(btrim(name)));

-- 13.2 Un puesto de una versión usa el formato nuevo (sector) o el anterior (etapa), nunca los dos.
ALTER TABLE policy_version_positions
  ADD CONSTRAINT ck_pvp_sector_or_stage CHECK (sector_id IS NULL OR stage IS NULL);

-- 13.3 Sectores: solo en la transacción que crea la versión; después, inmutables.
CREATE FUNCTION fn_policy_version_sectors_before_insert() RETURNS trigger AS $$
BEGIN
  IF NOT fn_tx_marked('gutip.new_policy_versions', NEW.version_id::text) THEN
    RAISE EXCEPTION 'IMMUTABLE: sectors can only be added to a policy version in the transaction that creates it (version %)', NEW.version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_version_sectors_before_insert
  BEFORE INSERT ON policy_version_sectors
  FOR EACH ROW EXECUTE FUNCTION fn_policy_version_sectors_before_insert();

CREATE TRIGGER trg_policy_version_sectors_append_only
  BEFORE UPDATE OR DELETE ON policy_version_sectors
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_policy_version_sectors_no_truncate
  BEFORE TRUNCATE ON policy_version_sectors
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

-- 13.4 El sector de un puesto es de la MISMA versión (la FK sola permitiría uno de otra versión).
CREATE FUNCTION fn_pvp_sector_same_version() RETURNS trigger AS $$
BEGIN
  IF NEW.sector_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM policy_version_sectors s
       WHERE s.id = NEW.sector_id AND s.version_id = NEW.version_id
     )
  THEN
    RAISE EXCEPTION 'RULE: the sector must belong to the same policy version (sector %)', NEW.sector_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pvp_sector_same_version
  BEFORE INSERT ON policy_version_positions
  FOR EACH ROW EXECUTE FUNCTION fn_pvp_sector_same_version();
