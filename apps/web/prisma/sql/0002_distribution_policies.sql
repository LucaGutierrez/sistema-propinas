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

-- 7.2 Repartos sin superposición e índices únicos

-- I13: los repartos vigentes de un restaurante no se superponen (con la estructura de pozo
-- SINGLE_POOL hay un solo pozo por día o período). Restricción de exclusión: PostgreSQL la
-- hace cumplir también entre transacciones concurrentes (la segunda espera a la primera y,
-- si esta confirma, falla), en cualquier nivel de aislamiento. btree_gist permite combinar
-- la igualdad de restaurant_id con el solapamiento de rangos en un índice GiST.
-- Si en el futuro la política admite varios pozos, esta restricción incorporará la clave
-- del pozo (p. ej. el equipo) en una migración nueva.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE daily_distributions
  ADD CONSTRAINT ex_daily_distributions_no_overlap
    EXCLUDE USING gist (restaurant_id WITH =, daterange(date_from, date_to, '[]') WITH &&)
    WHERE (status <> 'VOIDED');

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

-- 7.4 Repartos DAY/PERIOD: propinas dentro del rango y tope de horas derivado del alcance
--     (24 × días del rango, cualquiera sea su largo), no un límite de negocio.

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
