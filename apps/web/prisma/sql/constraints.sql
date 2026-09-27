-- =============================================================================
-- constraints.sql — CONJUNTO VIGENTE de lo que Prisma no puede expresar
--
-- CHECK, índices únicos parciales / por expresión y triggers, tal como deben quedar HOY sobre
-- el esquema de schema.prisma. Lo usan los tests de base (test-db) sobre el DDL de Prisma.
-- A la base real llega por las migraciones: 0001_constraints.sql (migración inicial, sin cambios)
-- + 0002_distribution_policies.sql (migración de políticas) + 0003_auth.sql (autenticación y
-- acceso). test-db/migrations.test.ts
-- garantiza que ambos caminos producen exactamente la misma base.
--
-- Fuente de verdad: DATABASE.md (§4 tablas, §5 inmutabilidad, §6 reglas, §7 invariantes).
--
-- Los mensajes de error de los triggers empiezan con un prefijo estable para que la
-- aplicación los pueda distinguir:  IMMUTABLE: / INVALID_TRANSITION: / RULE:
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECK constraints
-- -----------------------------------------------------------------------------

ALTER TABLE exchange_rates
  ADD CONSTRAINT ck_exchange_rates_rate_positive CHECK (rate > 0);

ALTER TABLE daily_distributions
  ADD CONSTRAINT ck_daily_distributions_amounts
    CHECK (tips_ars_cents >= 0 AND tips_usd_cents >= 0 AND total_cents >= 0
           AND total_points >= 0 AND total_advances_cents >= 0 AND total_final_cents >= 0),
  ADD CONSTRAINT ck_daily_distributions_final
    CHECK (total_final_cents = total_cents - total_advances_cents),
  ADD CONSTRAINT ck_daily_distributions_closed
    CHECK (status <> 'CLOSED' OR (closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  ADD CONSTRAINT ck_daily_distributions_voided
    CHECK (status <> 'VOIDED'
           OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
               AND void_reason IS NOT NULL AND length(btrim(void_reason)) >= 10)),
  ADD CONSTRAINT ck_daily_distributions_settlement_only_closed
    CHECK (settlement_id IS NULL OR status = 'CLOSED');

ALTER TABLE tip_entries
  ADD CONSTRAINT ck_tip_entries_amount_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT ck_tip_entries_ars_nonnegative CHECK (amount_ars_cents >= 0),
  ADD CONSTRAINT ck_tip_entries_rate_positive CHECK (exchange_rate IS NULL OR exchange_rate > 0),
  ADD CONSTRAINT ck_tip_entries_usd_has_rate CHECK ((currency = 'USD') = (exchange_rate IS NOT NULL)),
  ADD CONSTRAINT ck_tip_entries_ars_no_conversion
    CHECK (currency <> 'ARS' OR amount_ars_cents = amount_cents);

ALTER TABLE daily_distribution_items
  ADD CONSTRAINT ck_ddi_points CHECK (points >= 0),
  ADD CONSTRAINT ck_ddi_percentage CHECK (percentage >= 0 AND percentage <= 1),
  ADD CONSTRAINT ck_ddi_amount CHECK (amount_cents >= 0),
  ADD CONSTRAINT ck_ddi_advances CHECK (advances_cents >= 0 AND advances_cents <= amount_cents),
  ADD CONSTRAINT ck_ddi_final CHECK (final_cents = amount_cents - advances_cents);

ALTER TABLE advances
  ADD CONSTRAINT ck_advances_amount_positive CHECK (amount_cents > 0),
  ADD CONSTRAINT ck_advances_applied_range CHECK (applied_cents >= 0 AND applied_cents <= amount_cents),
  ADD CONSTRAINT ck_advances_status_matches_balance
    CHECK (status = 'VOIDED' OR ((status = 'APPLIED') = (applied_cents = amount_cents)));

ALTER TABLE advance_applications
  ADD CONSTRAINT ck_advance_applications_amount_positive CHECK (amount_cents > 0);

ALTER TABLE weekly_settlements
  ADD CONSTRAINT ck_weekly_settlements_week CHECK (week_end = week_start + 6),
  ADD CONSTRAINT ck_weekly_settlements_revision CHECK (revision >= 1),
  ADD CONSTRAINT ck_weekly_settlements_totals
    CHECK (total_cents IS NULL OR total_advances_cents IS NULL OR total_final_cents IS NULL
           OR total_final_cents = total_cents - total_advances_cents),
  ADD CONSTRAINT ck_weekly_settlements_closed
    CHECK (status <> 'CLOSED'
           OR (total_cents IS NOT NULL AND total_advances_cents IS NOT NULL
               AND total_final_cents IS NOT NULL AND closed_at IS NOT NULL AND closed_by IS NOT NULL)),
  ADD CONSTRAINT ck_weekly_settlements_voided
    CHECK (status <> 'VOIDED'
           OR (voided_at IS NOT NULL AND voided_by IS NOT NULL
               AND void_reason IS NOT NULL AND length(btrim(void_reason)) >= 10));

ALTER TABLE weekly_payments
  ADD CONSTRAINT ck_weekly_payments_period CHECK (period_end = period_start + 6),
  ADD CONSTRAINT ck_weekly_payments_amounts
    CHECK (gross_cents >= 0 AND advances_cents >= 0 AND advances_cents <= gross_cents
           AND net_cents >= 0 AND gross_cents - advances_cents = net_cents
           AND previously_delivered_cents >= 0),
  ADD CONSTRAINT ck_weekly_payments_delivered_has_who_when
    CHECK (status <> 'DELIVERED' OR (delivered_at IS NOT NULL AND delivered_by IS NOT NULL)),
  ADD CONSTRAINT ck_weekly_payments_delivery_only_when_delivered
    CHECK (status = 'DELIVERED' OR (delivered_at IS NULL AND delivered_by IS NULL)),
  ADD CONSTRAINT ck_weekly_payments_prepared_has_who_when
    CHECK (status NOT IN ('PREPARED', 'DELIVERED') OR (prepared_at IS NOT NULL AND prepared_by IS NOT NULL)),
  ADD CONSTRAINT ck_weekly_payments_pending_is_clean
    CHECK (status <> 'PENDING' OR (prepared_at IS NULL AND prepared_by IS NULL));

ALTER TABLE weekly_payment_events
  ADD CONSTRAINT ck_wpe_amount CHECK (amount_cents >= 0),
  ADD CONSTRAINT ck_wpe_reason_required
    CHECK (event_type NOT IN ('DELIVERY_REVERTED', 'VOIDED', 'PREPARATION_UNDONE')
           OR (reason IS NOT NULL AND length(btrim(reason)) >= 10)),
  ADD CONSTRAINT ck_wpe_revert_needs_authorizer
    CHECK (event_type <> 'DELIVERY_REVERTED' OR authorized_by IS NOT NULL);

ALTER TABLE rate_limits
  ADD CONSTRAINT ck_rate_limits_count CHECK (count >= 0);

-- -----------------------------------------------------------------------------
-- 2. Índices únicos parciales / por expresión
-- -----------------------------------------------------------------------------

-- Una liquidación vigente por restaurante y semana.
CREATE UNIQUE INDEX ux_weekly_settlements_active
  ON weekly_settlements (restaurant_id, week_start)
  WHERE status <> 'VOIDED';

-- -----------------------------------------------------------------------------
-- 4. Triggers: inmutabilidad de la distribución diaria
--    DRAFT: editable. CLOSED: inmutable (salvo settlement_id y CLOSED -> VOIDED).
--    VOIDED: inmutable.
-- -----------------------------------------------------------------------------

CREATE FUNCTION fn_daily_distributions_guard() RETURNS trigger AS $$
DECLARE
  old_j jsonb;
  new_j jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'IMMUTABLE: only DRAFT daily distributions can be deleted (id %, status %)',
        OLD.id, OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW; -- editable; DRAFT -> CLOSED / VOIDED allowed (CHECKs validate the result)
  END IF;

  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);

  IF OLD.status = 'CLOSED' THEN
    IF NEW.status = 'CLOSED' THEN
      -- Only the link to a weekly settlement may change.
      IF (old_j - 'settlement_id' - 'updated_at') IS DISTINCT FROM (new_j - 'settlement_id' - 'updated_at') THEN
        RAISE EXCEPTION 'IMMUTABLE: a CLOSED daily distribution cannot be modified (id %)', OLD.id;
      END IF;
      IF OLD.settlement_id IS NOT NULL AND NEW.settlement_id IS NOT NULL
         AND OLD.settlement_id <> NEW.settlement_id THEN
        RAISE EXCEPTION 'RULE: release the distribution from its settlement before assigning another (id %)', OLD.id;
      END IF;
      RETURN NEW;
    ELSIF NEW.status = 'VOIDED' THEN
      IF OLD.settlement_id IS NOT NULL OR NEW.settlement_id IS NOT NULL THEN
        RAISE EXCEPTION 'RULE: a distribution that belongs to a weekly settlement cannot be voided (id %)', OLD.id;
      END IF;
      IF (old_j - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at')
         IS DISTINCT FROM
         (new_j - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at') THEN
        RAISE EXCEPTION 'IMMUTABLE: voiding a CLOSED distribution cannot change anything else (id %)', OLD.id;
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'INVALID_TRANSITION: daily distribution % -> % (id %)', OLD.status, NEW.status, OLD.id;
    END IF;
  END IF;

  -- OLD.status = 'VOIDED'
  RAISE EXCEPTION 'IMMUTABLE: a VOIDED daily distribution cannot be modified (id %)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_distributions_guard
  BEFORE UPDATE OR DELETE ON daily_distributions
  FOR EACH ROW EXECUTE FUNCTION fn_daily_distributions_guard();

-- tip_entries and daily_distribution_items: only writable while the parent is DRAFT.
CREATE FUNCTION fn_require_draft_parent() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status::text INTO parent_status
    FROM daily_distributions WHERE id = OLD.daily_distribution_id;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'IMMUTABLE: % row % belongs to a non-DRAFT daily distribution', TG_TABLE_NAME, OLD.id;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status::text INTO parent_status
    FROM daily_distributions WHERE id = NEW.daily_distribution_id;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'IMMUTABLE: cannot write % for a non-DRAFT daily distribution', TG_TABLE_NAME;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tip_entries_require_draft
  BEFORE INSERT OR UPDATE OR DELETE ON tip_entries
  FOR EACH ROW EXECUTE FUNCTION fn_require_draft_parent();

CREATE TRIGGER trg_daily_distribution_items_require_draft
  BEFORE INSERT OR UPDATE OR DELETE ON daily_distribution_items
  FOR EACH ROW EXECUTE FUNCTION fn_require_draft_parent();

-- advance_applications: created while the distribution is DRAFT (at close); afterwards the only
-- allowed change is setting reverted_at once (when the distribution is voided).
CREATE FUNCTION fn_advance_applications_guard() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: advance_applications cannot be deleted (set reverted_at instead)';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT d.status::text INTO parent_status
    FROM daily_distribution_items i
    JOIN daily_distributions d ON d.id = i.daily_distribution_id
    WHERE i.id = NEW.daily_distribution_item_id;
    IF parent_status IS DISTINCT FROM 'DRAFT' THEN
      RAISE EXCEPTION 'IMMUTABLE: advances can only be applied while the daily distribution is being closed (DRAFT)';
    END IF;
    IF EXISTS (SELECT 1 FROM advances a WHERE a.id = NEW.advance_id AND a.status = 'VOIDED') THEN
      RAISE EXCEPTION 'RULE: a VOIDED advance cannot be applied (advance %)', NEW.advance_id;
    END IF;
    IF NEW.reverted_at IS NOT NULL THEN
      RAISE EXCEPTION 'RULE: an advance application must be created active (reverted_at NULL)';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF (to_jsonb(NEW) - 'reverted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'reverted_at') THEN
    RAISE EXCEPTION 'IMMUTABLE: only reverted_at can change on an advance application (id %)', OLD.id;
  END IF;
  IF OLD.reverted_at IS NOT NULL AND NEW.reverted_at IS DISTINCT FROM OLD.reverted_at THEN
    RAISE EXCEPTION 'IMMUTABLE: advance application % is already reverted', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_advance_applications_guard
  BEFORE INSERT OR UPDATE OR DELETE ON advance_applications
  FOR EACH ROW EXECUTE FUNCTION fn_advance_applications_guard();

-- advances: never deleted (they are voided). VOIDED is final. While the advance has active
-- applications (reverted_at NULL) its identity and amount are frozen and it cannot be voided: the
-- distributions that consumed it must be voided first (which reverts the applications).
-- applied_cents / status keep changing at each close.
CREATE FUNCTION fn_advances_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'IMMUTABLE: advances cannot be deleted (void them instead)';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: advances cannot be deleted (void them instead) (id %)', OLD.id;
  END IF;

  IF OLD.status = 'VOIDED' THEN
    IF (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'IMMUTABLE: a VOIDED advance cannot be modified (id %)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM advance_applications ap
             WHERE ap.advance_id = OLD.id AND ap.reverted_at IS NULL) THEN
    IF (OLD.restaurant_id, OLD.employee_id, OLD.date, OLD.amount_cents)
       IS DISTINCT FROM
       (NEW.restaurant_id, NEW.employee_id, NEW.date, NEW.amount_cents) THEN
      RAISE EXCEPTION 'IMMUTABLE: an advance with active applications cannot change its employee, date or amount (id %)', OLD.id;
    END IF;
    IF NEW.status = 'VOIDED' THEN
      RAISE EXCEPTION 'RULE: an advance with active applications cannot be voided; void the distributions that consumed it first (id %)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_advances_guard
  BEFORE UPDATE OR DELETE ON advances
  FOR EACH ROW EXECUTE FUNCTION fn_advances_guard();

CREATE TRIGGER trg_advances_no_truncate
  BEFORE TRUNCATE ON advances
  FOR EACH STATEMENT EXECUTE FUNCTION fn_advances_guard();

-- -----------------------------------------------------------------------------
-- 5. Triggers: liquidación semanal y sobres
-- -----------------------------------------------------------------------------

-- OPEN: editable. CLOSED: frozen (the only allowed change is CLOSED -> VOIDED, which may only
-- fill voided_at / voided_by / void_reason). VOIDED: frozen.
CREATE FUNCTION fn_weekly_settlements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: weekly settlements cannot be deleted (void them instead)';
  END IF;

  IF OLD.status = 'VOIDED' THEN
    IF (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'IMMUTABLE: a VOIDED settlement cannot be modified (id %)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'OPEN' AND NEW.status IN ('CLOSED', 'VOIDED'))
            OR (OLD.status = 'CLOSED' AND NEW.status = 'VOIDED')) THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: settlement % -> % (id %)', OLD.status, NEW.status, OLD.id;
    END IF;

    IF NEW.status = 'VOIDED' AND EXISTS (
         SELECT 1 FROM weekly_payments p WHERE p.settlement_id = OLD.id AND p.status = 'DELIVERED'
       )
    THEN
      RAISE EXCEPTION 'RULE: cannot void a settlement with DELIVERED payments; revert the deliveries first (id %)', OLD.id;
    END IF;
  END IF;

  IF OLD.status = 'CLOSED' THEN
    IF NEW.status = 'CLOSED'
       AND (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'IMMUTABLE: a CLOSED settlement cannot be modified (id %)', OLD.id;
    END IF;
    IF NEW.status = 'VOIDED'
       AND (to_jsonb(OLD) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at')
           IS DISTINCT FROM
           (to_jsonb(NEW) - 'status' - 'voided_at' - 'voided_by' - 'void_reason' - 'updated_at') THEN
      RAISE EXCEPTION 'IMMUTABLE: voiding a CLOSED settlement cannot change anything else (id %)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_settlements_guard
  BEFORE UPDATE OR DELETE ON weekly_settlements
  FOR EACH ROW EXECUTE FUNCTION fn_weekly_settlements_guard();

-- Identity and money: frozen always. DELIVERED: delivery data (incl. delivery_note) and preparation
-- data frozen while it stays DELIVERED; reverting (DELIVERED -> PREPARED) may only clear the delivery
-- data. VOIDED: frozen.
CREATE FUNCTION fn_weekly_payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE: weekly payments cannot be deleted (void them instead)';
  END IF;

  IF OLD.status = 'VOIDED' THEN
    IF (to_jsonb(OLD) - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at') THEN
      RAISE EXCEPTION 'IMMUTABLE: a VOIDED weekly payment cannot be modified (id %)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  -- Identity and money are frozen; only status / preparation / delivery fields may change.
  IF (OLD.restaurant_id, OLD.settlement_id, OLD.employee_id, OLD.employee_name_snapshot,
      OLD.period_start, OLD.period_end, OLD.gross_cents, OLD.advances_cents, OLD.net_cents,
      OLD.supersedes_payment_id, OLD.previously_delivered_cents)
     IS DISTINCT FROM
     (NEW.restaurant_id, NEW.settlement_id, NEW.employee_id, NEW.employee_name_snapshot,
      NEW.period_start, NEW.period_end, NEW.gross_cents, NEW.advances_cents, NEW.net_cents,
      NEW.supersedes_payment_id, NEW.previously_delivered_cents)
  THEN
    RAISE EXCEPTION 'IMMUTABLE: the amounts and identity of a weekly payment cannot change (id %)', OLD.id;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'PENDING'   AND NEW.status IN ('PREPARED', 'VOIDED'))
         OR (OLD.status = 'PREPARED'  AND NEW.status IN ('PENDING', 'DELIVERED', 'VOIDED'))
         OR (OLD.status = 'DELIVERED' AND NEW.status = 'PREPARED')) THEN
      RAISE EXCEPTION 'INVALID_TRANSITION: payment % -> % (id %)', OLD.status, NEW.status, OLD.id;
    END IF;
  END IF;

  IF OLD.status = 'DELIVERED' THEN
    IF NEW.status = 'DELIVERED'
       AND (OLD.delivered_at, OLD.delivered_by, OLD.delivery_note, OLD.prepared_at, OLD.prepared_by)
           IS DISTINCT FROM
           (NEW.delivered_at, NEW.delivered_by, NEW.delivery_note, NEW.prepared_at, NEW.prepared_by) THEN
      RAISE EXCEPTION 'IMMUTABLE: the delivery and preparation data of a DELIVERED payment cannot change (id %)', OLD.id;
    END IF;
    IF NEW.status = 'PREPARED'
       AND (OLD.prepared_at, OLD.prepared_by) IS DISTINCT FROM (NEW.prepared_at, NEW.prepared_by) THEN
      RAISE EXCEPTION 'IMMUTABLE: reverting a delivery cannot change the preparation data (id %)', OLD.id;
    END IF;
    IF NEW.status = 'PREPARED'
       AND NEW.delivery_note IS NOT NULL AND NEW.delivery_note IS DISTINCT FROM OLD.delivery_note THEN
      RAISE EXCEPTION 'IMMUTABLE: reverting a delivery can only clear the delivery note (id %)', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_payments_guard
  BEFORE UPDATE OR DELETE ON weekly_payments
  FOR EACH ROW EXECUTE FUNCTION fn_weekly_payments_guard();

-- -----------------------------------------------------------------------------
-- 6. Bitácoras de solo inserción
-- -----------------------------------------------------------------------------

CREATE FUNCTION fn_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE: % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_weekly_payment_events_append_only
  BEFORE UPDATE OR DELETE ON weekly_payment_events
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_weekly_payment_events_no_truncate
  BEFORE TRUNCATE ON weekly_payment_events
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_append_only();

CREATE TRIGGER trg_audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION fn_append_only();

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

-- -----------------------------------------------------------------------------
-- 8. Acceso: memberships (ARCHITECTURE.md §9)
-- -----------------------------------------------------------------------------

-- 8.1 Un solo OWNER por restaurante.
CREATE UNIQUE INDEX ux_memberships_one_owner
  ON memberships (restaurant_id) WHERE role = 'OWNER';

-- 8.2 Un empleado se vincula a lo sumo a una membresía (un empleado es de un solo restaurante).
CREATE UNIQUE INDEX ux_memberships_employee
  ON memberships (employee_id) WHERE employee_id IS NOT NULL;

-- 8.3 SELF solo ve lo de su empleado: sin empleado vinculado no tiene sentido.
ALTER TABLE memberships
  ADD CONSTRAINT ck_memberships_self_employee
    CHECK (role <> 'SELF' OR employee_id IS NOT NULL);

-- 8.4 El empleado vinculado es del mismo restaurante que la membresía.
CREATE FUNCTION fn_memberships_employee_same_restaurant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.employee_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM employees e
       WHERE e.id = NEW.employee_id AND e.restaurant_id = NEW.restaurant_id) THEN
    RAISE EXCEPTION 'RULE: the linked employee must belong to the restaurant of the membership (membership %)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_memberships_employee_same_restaurant
  BEFORE INSERT OR UPDATE OF employee_id, restaurant_id ON memberships
  FOR EACH ROW EXECUTE FUNCTION fn_memberships_employee_same_restaurant();

-- 8.5 Un empleado vinculado a una membresía no se pasa a otro restaurante.
CREATE FUNCTION fn_employees_linked_membership_restaurant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.restaurant_id <> OLD.restaurant_id AND EXISTS (
       SELECT 1 FROM memberships m WHERE m.employee_id = NEW.id) THEN
    RAISE EXCEPTION 'RULE: an employee linked to a membership cannot change restaurant (employee %)', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_employees_linked_membership_restaurant
  BEFORE UPDATE OF restaurant_id ON employees
  FOR EACH ROW EXECUTE FUNCTION fn_employees_linked_membership_restaurant();

-- -----------------------------------------------------------------------------
-- 9. Autenticación (Better Auth)
-- -----------------------------------------------------------------------------

-- 9.1 Emails siempre en minúsculas (Better Auth y db:bootstrap los normalizan; la base lo exige).
ALTER TABLE users
  ADD CONSTRAINT ck_users_email_lowercase CHECK (email = lower(email));

ALTER TABLE auth_rate_limits
  ADD CONSTRAINT ck_auth_rate_limits_count CHECK (count >= 0);
