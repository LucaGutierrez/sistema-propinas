-- Migración: política de distribución versionada y períodos (CONFIG-MODEL.md).
-- Cambia tipos y columnas de tablas con datos de negocio: se aplica SOLO sobre tablas vacías.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM restaurants) OR EXISTS (SELECT 1 FROM positions)
     OR EXISTS (SELECT 1 FROM daily_distributions) OR EXISTS (SELECT 1 FROM tip_entries)
     OR EXISTS (SELECT 1 FROM advances) OR EXISTS (SELECT 1 FROM weekly_settlements)
     OR EXISTS (SELECT 1 FROM weekly_payments) THEN
    RAISE EXCEPTION 'MIGRATION GUARD: 20260926000000_distribution_policies expects empty business tables';
  END IF;
END $$;

-- El trigger anti-mezcla de pozos depende de columnas que se eliminan (pool_mode, date).
-- La estructura del pozo pasa a la política (pool_structure).
DROP TRIGGER trg_daily_distributions_no_mixed_modes ON daily_distributions;
DROP FUNCTION fn_daily_distributions_no_mixed_modes();

-- CreateEnum
CREATE TYPE "period_kind" AS ENUM ('WEEKLY');

-- CreateEnum
CREATE TYPE "split_timing" AS ENUM ('PER_PERIOD');

-- CreateEnum
CREATE TYPE "hours_basis" AS ENUM ('PERIOD_TOTAL');

-- CreateEnum
CREATE TYPE "hours_entry" AS ENUM ('PERIOD_TOTAL_AT_CLOSE');

-- CreateEnum
CREATE TYPE "pot_sources" AS ENUM ('SINGLE_DAILY_AMOUNT');

-- CreateEnum
CREATE TYPE "pool_structure" AS ENUM ('SINGLE_POOL');

-- CreateEnum
CREATE TYPE "portion_mode" AS ENUM ('BY_POSITION');

-- CreateEnum
CREATE TYPE "rounding_unit" AS ENUM ('CENT', 'PESO');

-- CreateEnum
CREATE TYPE "advance_deduction" AS ENUM ('WHOLE_PERIOD');

-- CreateEnum
CREATE TYPE "envelope_handlers" AS ENUM ('MANAGER_ONLY', 'MANAGER_AND_EDITOR');

-- CreateEnum
CREATE TYPE "policy_origin" AS ENUM ('STANDARD', 'COPY', 'CHANGE');

-- CreateEnum
CREATE TYPE "distribution_scope" AS ENUM ('DAY', 'PERIOD');

-- DropForeignKey
ALTER TABLE "daily_distributions" DROP CONSTRAINT "daily_distributions_team_id_fkey";

-- DropIndex
DROP INDEX "positions_team_id_name_key";

-- DropIndex
DROP INDEX "daily_distributions_restaurant_id_date_idx";

-- AlterTable
ALTER TABLE "restaurants" DROP COLUMN "pool_mode",
DROP COLUMN "week_starts_on",
ADD COLUMN     "current_policy_version_id" UUID;

-- AlterTable
ALTER TABLE "positions" DROP COLUMN "weight",
ALTER COLUMN "team_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "daily_distributions" DROP COLUMN "date",
DROP COLUMN "pool_mode",
DROP COLUMN "team_id",
DROP COLUMN "team_name_snapshot",
ADD COLUMN     "date_from" DATE NOT NULL,
ADD COLUMN     "date_to" DATE NOT NULL,
ADD COLUMN     "scope" "distribution_scope" NOT NULL,
ALTER COLUMN "total_points" SET DATA TYPE DECIMAL(30,12);

-- AlterTable
ALTER TABLE "tip_entries" ADD COLUMN     "entry_date" DATE NOT NULL;

-- AlterTable
ALTER TABLE "daily_distribution_items" DROP COLUMN "weight_snapshot",
ADD COLUMN     "portion_snapshot" DECIMAL(20,10) NOT NULL,
ALTER COLUMN "team_name_snapshot" DROP NOT NULL,
ALTER COLUMN "points" SET DATA TYPE DECIMAL(30,12);

-- AlterTable
ALTER TABLE "advances" ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMPTZ(6),
ADD COLUMN     "voided_by" UUID;

-- AlterTable
ALTER TABLE "weekly_settlements" ADD COLUMN     "calc_version" TEXT,
ADD COLUMN     "policy_snapshot" JSONB,
ADD COLUMN     "policy_version_id" UUID NOT NULL;

-- DropEnum
DROP TYPE "tip_pool_mode";

-- CreateTable
CREATE TABLE "distribution_policy_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "origin" "policy_origin" NOT NULL,
    "template_code" TEXT,
    "template_version" INTEGER,
    "previous_version_id" UUID,
    "copied_from_version_id" UUID,
    "summary" TEXT NOT NULL,
    "period_kind" "period_kind" NOT NULL,
    "period_start_weekday" SMALLINT NOT NULL,
    "split_timing" "split_timing" NOT NULL,
    "hours_basis" "hours_basis" NOT NULL,
    "hours_entry" "hours_entry" NOT NULL,
    "pot_sources" "pot_sources" NOT NULL,
    "pool_structure" "pool_structure" NOT NULL,
    "portion_mode" "portion_mode" NOT NULL,
    "rounding_unit" "rounding_unit" NOT NULL,
    "advance_deduction" "advance_deduction" NOT NULL,
    "envelope_handlers" "envelope_handlers" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "distribution_policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_version_positions" (
    "version_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "portion" DECIMAL(20,10) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "policy_version_positions_pkey" PRIMARY KEY ("version_id","position_id")
);

-- CreateTable
CREATE TABLE "period_policy_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "from_version_id" UUID NOT NULL,
    "to_version_id" UUID NOT NULL,
    "automatic" BOOLEAN NOT NULL,
    "reason" TEXT,
    "performed_by" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_policy_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "period_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "distribution_policy_versions_restaurant_id_number_key" ON "distribution_policy_versions"("restaurant_id", "number");

-- CreateIndex
CREATE INDEX "policy_version_positions_position_id_idx" ON "policy_version_positions"("position_id");

-- CreateIndex
CREATE INDEX "period_policy_changes_settlement_id_occurred_at_idx" ON "period_policy_changes"("settlement_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "period_hours_settlement_id_employee_id_key" ON "period_hours"("settlement_id", "employee_id");

-- CreateIndex
CREATE INDEX "daily_distributions_restaurant_id_date_from_idx" ON "daily_distributions"("restaurant_id", "date_from");

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_current_policy_version_id_fkey" FOREIGN KEY ("current_policy_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_policy_version_id_fkey" FOREIGN KEY ("policy_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_policy_versions" ADD CONSTRAINT "distribution_policy_versions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_policy_versions" ADD CONSTRAINT "distribution_policy_versions_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_policy_versions" ADD CONSTRAINT "distribution_policy_versions_copied_from_version_id_fkey" FOREIGN KEY ("copied_from_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "distribution_policy_versions" ADD CONSTRAINT "distribution_policy_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version_positions" ADD CONSTRAINT "policy_version_positions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_version_positions" ADD CONSTRAINT "policy_version_positions_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_policy_changes" ADD CONSTRAINT "period_policy_changes_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_policy_changes" ADD CONSTRAINT "period_policy_changes_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "weekly_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_policy_changes" ADD CONSTRAINT "period_policy_changes_from_version_id_fkey" FOREIGN KEY ("from_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_policy_changes" ADD CONSTRAINT "period_policy_changes_to_version_id_fkey" FOREIGN KEY ("to_version_id") REFERENCES "distribution_policy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_policy_changes" ADD CONSTRAINT "period_policy_changes_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_hours" ADD CONSTRAINT "period_hours_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_hours" ADD CONSTRAINT "period_hours_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "weekly_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_hours" ADD CONSTRAINT "period_hours_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_hours" ADD CONSTRAINT "period_hours_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 0002_distribution_policies.sql — cambios de la migración de políticas versionadas
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente). Las columnas eliminadas (pool_mode, team_id, date,
-- weight, weight_snapshot, week_starts_on) se llevaron sus CHECK e índices.
-- =============================================================================

-- El tope fijo de 24 horas pasa a depender del alcance del reparto (fn_ddi_hours_in_range).
ALTER TABLE daily_distribution_items DROP CONSTRAINT ck_ddi_hours;

-- -----------------------------------------------------------------------------
-- 7. Política de distribución versionada y períodos (CONFIG-MODEL.md)
-- -----------------------------------------------------------------------------

-- 7.1 CHECK de las tablas existentes que cambian con el alcance DAY/PERIOD, la porción y la
--     anulación de adelantos.

ALTER TABLE daily_distributions
  ADD CONSTRAINT ck_daily_distributions_scope_range
    CHECK ((scope = 'DAY' AND date_to = date_from) OR (scope = 'PERIOD' AND date_to >= date_from));

ALTER TABLE daily_distribution_items
  ADD CONSTRAINT ck_ddi_hours_positive CHECK (hours > 0),
  ADD CONSTRAINT ck_ddi_portion CHECK (portion_snapshot > 0);

ALTER TABLE advances
  ADD CONSTRAINT ck_advances_voided
    CHECK (status <> 'VOIDED'
           OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
               AND void_reason IS NOT NULL AND length(btrim(void_reason)) >= 10)),
  ADD CONSTRAINT ck_advances_void_data_only_when_voided
    CHECK (status = 'VOIDED' OR (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL));

ALTER TABLE weekly_settlements
  ADD CONSTRAINT ck_weekly_settlements_closed_snapshot
    CHECK (status <> 'CLOSED'
           OR (policy_snapshot IS NOT NULL AND calc_version IS NOT NULL
               AND length(btrim(calc_version)) > 0));

ALTER TABLE distribution_policy_versions
  ADD CONSTRAINT ck_policy_versions_number CHECK (number >= 1),
  ADD CONSTRAINT ck_policy_versions_weekday CHECK (period_start_weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT ck_policy_versions_summary CHECK (length(btrim(summary)) > 0),
  ADD CONSTRAINT ck_policy_versions_template
    CHECK (template_version IS NULL OR template_version >= 1),
  ADD CONSTRAINT ck_policy_versions_standard_has_template
    CHECK (origin <> 'STANDARD' OR (template_code IS NOT NULL AND template_version IS NOT NULL)),
  ADD CONSTRAINT ck_policy_versions_copy_has_source
    CHECK (origin <> 'COPY' OR copied_from_version_id IS NOT NULL),
  ADD CONSTRAINT ck_policy_versions_change_has_previous
    CHECK (origin <> 'CHANGE' OR previous_version_id IS NOT NULL);

ALTER TABLE policy_version_positions
  ADD CONSTRAINT ck_policy_version_positions_portion CHECK (portion > 0);

ALTER TABLE period_policy_changes
  ADD CONSTRAINT ck_period_policy_changes_versions CHECK (from_version_id <> to_version_id),
  ADD CONSTRAINT ck_period_policy_changes_reason
    CHECK (automatic OR (reason IS NOT NULL AND length(btrim(reason)) >= 10));

ALTER TABLE period_hours
  ADD CONSTRAINT ck_period_hours_nonnegative CHECK (hours >= 0);

-- 7.2 Índices únicos

-- Un reparto vigente por restaurante y fecha de inicio (DAY: el día; PERIOD: el inicio del período).
-- Que no se superpongan rangos lo valida fn_daily_distributions_no_overlap.
CREATE UNIQUE INDEX ux_daily_distributions_active
  ON daily_distributions (restaurant_id, date_from)
  WHERE status <> 'VOIDED';

-- El nombre del puesto es su identidad dentro del restaurante (sin distinguir mayúsculas).
CREATE UNIQUE INDEX ux_positions_restaurant_name
  ON positions (restaurant_id, lower(name));

-- 7.3 Marcas por transacción: "esto se creó en esta transacción" (GUC local; se revierte con la
--     transacción o el savepoint). Así una versión solo recibe sus puestos al crearse, y un
--     período solo cambia de versión si el cambio quedó registrado en la misma transacción.

CREATE FUNCTION fn_tx_mark(mark_key text, mark_value text) RETURNS void AS $$
BEGIN
  PERFORM set_config(mark_key, coalesce(current_setting(mark_key, true), '') || ',' || mark_value || ',', true);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION fn_tx_marked(mark_key text, mark_value text) RETURNS boolean AS $$
BEGIN
  RETURN position(',' || mark_value || ',' IN coalesce(current_setting(mark_key, true), '')) > 0;
END;
$$ LANGUAGE plpgsql;

-- 7.4 Repartos DAY/PERIOD: sin superposición de rangos, propinas dentro del rango y tope de horas
--     derivado del alcance (24 × días), no un límite de negocio.

CREATE FUNCTION fn_daily_distributions_no_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'VOIDED' AND EXISTS (
       SELECT 1
       FROM daily_distributions d
       WHERE d.restaurant_id = NEW.restaurant_id
         AND d.status <> 'VOIDED'
         AND d.id <> NEW.id
         AND d.date_from <= NEW.date_to
         AND d.date_to >= NEW.date_from
     )
  THEN
    RAISE EXCEPTION 'RULE: distributions of a restaurant cannot overlap (restaurant %, % to %)',
      NEW.restaurant_id, NEW.date_from, NEW.date_to;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_distributions_no_overlap
  BEFORE INSERT OR UPDATE OF status, date_from, date_to, restaurant_id ON daily_distributions
  FOR EACH ROW EXECUTE FUNCTION fn_daily_distributions_no_overlap();

CREATE FUNCTION fn_tip_entries_in_range() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM daily_distributions d
       WHERE d.id = NEW.daily_distribution_id
         AND NEW.entry_date BETWEEN d.date_from AND d.date_to
     )
  THEN
    RAISE EXCEPTION 'RULE: a tip entry must be dated within its distribution (entry date %)', NEW.entry_date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tip_entries_in_range
  BEFORE INSERT OR UPDATE OF entry_date, daily_distribution_id ON tip_entries
  FOR EACH ROW EXECUTE FUNCTION fn_tip_entries_in_range();

CREATE FUNCTION fn_ddi_hours_in_range() RETURNS trigger AS $$
DECLARE
  max_hours numeric;
BEGIN
  SELECT 24 * (d.date_to - d.date_from + 1) INTO max_hours
  FROM daily_distributions d WHERE d.id = NEW.daily_distribution_id;
  IF NEW.hours > max_hours THEN
    RAISE EXCEPTION 'RULE: hours (%) exceed the length of the distribution (% hours max)', NEW.hours, max_hours;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ddi_hours_in_range
  BEFORE INSERT OR UPDATE OF hours, daily_distribution_id ON daily_distribution_items
  FOR EACH ROW EXECUTE FUNCTION fn_ddi_hours_in_range();

-- 7.5 Versiones de la política: solo inserción; la versión anterior es del mismo restaurante.

CREATE FUNCTION fn_policy_versions_before_insert() RETURNS trigger AS $$
BEGIN
  IF NEW.previous_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM distribution_policy_versions v
       WHERE v.id = NEW.previous_version_id AND v.restaurant_id = NEW.restaurant_id
     )
  THEN
    RAISE EXCEPTION 'RULE: the previous policy version must belong to the same restaurant (version %)', NEW.id;
  END IF;
  PERFORM fn_tx_mark('gutip.new_policy_versions', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_versions_before_insert
  BEFORE INSERT ON distribution_policy_versions
  FOR EACH ROW EXECUTE FUNCTION fn_policy_versions_before_insert();

CREATE TRIGGER trg_policy_versions_append_only
  BEFORE UPDATE OR DELETE ON distribution_policy_versions
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_policy_versions_no_truncate
  BEFORE TRUNCATE ON distribution_policy_versions
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

-- Puestos de una versión: solo en la transacción que crea la versión, y del mismo restaurante.
CREATE FUNCTION fn_policy_version_positions_before_insert() RETURNS trigger AS $$
BEGIN
  IF NOT fn_tx_marked('gutip.new_policy_versions', NEW.version_id::text) THEN
    RAISE EXCEPTION 'IMMUTABLE: positions can only be added to a policy version in the transaction that creates it (version %)', NEW.version_id;
  END IF;
  IF NOT EXISTS (
       SELECT 1
       FROM distribution_policy_versions v
       JOIN positions p ON p.restaurant_id = v.restaurant_id
       WHERE v.id = NEW.version_id AND p.id = NEW.position_id
     )
  THEN
    RAISE EXCEPTION 'RULE: the position must belong to the restaurant of the policy version (position %)', NEW.position_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_policy_version_positions_before_insert
  BEFORE INSERT ON policy_version_positions
  FOR EACH ROW EXECUTE FUNCTION fn_policy_version_positions_before_insert();

CREATE TRIGGER trg_policy_version_positions_append_only
  BEFORE UPDATE OR DELETE ON policy_version_positions
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_policy_version_positions_no_truncate
  BEFORE TRUNCATE ON policy_version_positions
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

-- Versión vigente: del mismo restaurante; una vez que hay política, no se vuelve a "ninguna".
CREATE FUNCTION fn_restaurants_current_policy() RETURNS trigger AS $$
BEGIN
  IF NEW.current_policy_version_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM distribution_policy_versions v
       WHERE v.id = NEW.current_policy_version_id AND v.restaurant_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'RULE: the current policy version must belong to the restaurant (restaurant %)', NEW.id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.current_policy_version_id IS NOT NULL
     AND NEW.current_policy_version_id IS NULL THEN
    RAISE EXCEPTION 'RULE: a restaurant cannot be left without a current policy version (restaurant %)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restaurants_current_policy
  BEFORE INSERT OR UPDATE OF current_policy_version_id ON restaurants
  FOR EACH ROW EXECUTE FUNCTION fn_restaurants_current_policy();

-- 7.6 Período fijado a una versión: la versión es del mismo restaurante; mientras está OPEN solo
--     cambia si el cambio quedó registrado en period_policy_changes en la misma transacción.
--     CLOSED / VOIDED ya congelan toda la fila (fn_weekly_settlements_guard).

CREATE FUNCTION fn_weekly_settlements_policy() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM distribution_policy_versions v
       WHERE v.id = NEW.policy_version_id AND v.restaurant_id = NEW.restaurant_id
     )
  THEN
    RAISE EXCEPTION 'RULE: the policy version of a period must belong to its restaurant (settlement %)', NEW.id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.policy_version_id IS DISTINCT FROM OLD.policy_version_id
     AND NOT fn_tx_marked('gutip.period_policy_changes',
                          OLD.id::text || ':' || OLD.policy_version_id::text || ':' || NEW.policy_version_id::text)
  THEN
    RAISE EXCEPTION 'RULE: changing the policy version of a period must be recorded in period_policy_changes (settlement %)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_settlements_policy
  BEFORE INSERT OR UPDATE OF policy_version_id, restaurant_id ON weekly_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_weekly_settlements_policy();

-- Bitácora de cambios de versión: período OPEN, desde su versión actual, versiones del restaurante.
-- Bloquea el período (FOR UPDATE): un cierre simultáneo espera, o este cambio ve el período CLOSED.
CREATE FUNCTION fn_period_policy_changes_before_insert() RETURNS trigger AS $$
DECLARE
  s weekly_settlements%ROWTYPE;
BEGIN
  SELECT * INTO s FROM weekly_settlements WHERE id = NEW.settlement_id FOR UPDATE;
  IF s.restaurant_id IS DISTINCT FROM NEW.restaurant_id THEN
    RAISE EXCEPTION 'RULE: the period of a policy change must belong to the same restaurant';
  END IF;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'IMMUTABLE: only an OPEN period can change its policy version (settlement %)', NEW.settlement_id;
  END IF;
  IF s.policy_version_id <> NEW.from_version_id THEN
    RAISE EXCEPTION 'RULE: a policy change must start from the current version of the period (settlement %)', NEW.settlement_id;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM distribution_policy_versions v
       WHERE v.id = NEW.to_version_id AND v.restaurant_id = NEW.restaurant_id
     )
  THEN
    RAISE EXCEPTION 'RULE: the new policy version must belong to the same restaurant';
  END IF;
  PERFORM fn_tx_mark('gutip.period_policy_changes',
                     NEW.settlement_id::text || ':' || NEW.from_version_id::text || ':' || NEW.to_version_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_period_policy_changes_before_insert
  BEFORE INSERT ON period_policy_changes
  FOR EACH ROW EXECUTE FUNCTION fn_period_policy_changes_before_insert();

CREATE TRIGGER trg_period_policy_changes_append_only
  BEFORE UPDATE OR DELETE ON period_policy_changes
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_period_policy_changes_no_truncate
  BEFORE TRUNCATE ON period_policy_changes
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

-- 7.7 Horas del período: solo con el período OPEN; empleado y período del mismo restaurante;
--     tope 24 × días del período. Lee el período con FOR SHARE: un cierre simultáneo espera a
--     que termine la carga de horas (o la carga ve el período ya CLOSED).
CREATE FUNCTION fn_period_hours_guard() RETURNS trigger AS $$
DECLARE
  s weekly_settlements%ROWTYPE;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT * INTO s FROM weekly_settlements WHERE id = OLD.settlement_id FOR SHARE;
    IF s.status <> 'OPEN' THEN
      RAISE EXCEPTION 'IMMUTABLE: the hours of a period can only change while it is OPEN (settlement %)', OLD.settlement_id;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT * INTO s FROM weekly_settlements WHERE id = NEW.settlement_id FOR SHARE;
  IF s.status <> 'OPEN' THEN
    RAISE EXCEPTION 'IMMUTABLE: the hours of a period can only change while it is OPEN (settlement %)', NEW.settlement_id;
  END IF;
  IF s.restaurant_id <> NEW.restaurant_id OR NOT EXISTS (
       SELECT 1 FROM employees e WHERE e.id = NEW.employee_id AND e.restaurant_id = NEW.restaurant_id
     )
  THEN
    RAISE EXCEPTION 'RULE: period, employee and hours must belong to the same restaurant';
  END IF;
  IF NEW.hours > 24 * (s.week_end - s.week_start + 1) THEN
    RAISE EXCEPTION 'RULE: hours (%) exceed the length of the period (% hours max)',
      NEW.hours, 24 * (s.week_end - s.week_start + 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_period_hours_guard
  BEFORE INSERT OR UPDATE OR DELETE ON period_hours
  FOR EACH ROW EXECUTE FUNCTION fn_period_hours_guard();
