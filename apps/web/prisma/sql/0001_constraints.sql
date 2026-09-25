-- =============================================================================
-- 0001_constraints.sql
--
-- Lo que Prisma no puede expresar: CHECK, índices únicos parciales / por expresión y
-- triggers de inmutabilidad. Se aplica DESPUÉS de las tablas generadas por Prisma
-- (es decir, se copia dentro de la migración inicial, o como una migración posterior).
--
-- Fuente de verdad: DATABASE.md (§4 tablas, §5 inmutabilidad, §6 reglas, §7 invariantes).
--
-- Los mensajes de error de los triggers empiezan con un prefijo estable para que la
-- aplicación los pueda distinguir:  IMMUTABLE: / INVALID_TRANSITION: / RULE:
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CHECK constraints
-- -----------------------------------------------------------------------------

ALTER TABLE restaurants
  ADD CONSTRAINT ck_restaurants_week_starts_on CHECK (week_starts_on BETWEEN 1 AND 7);

ALTER TABLE positions
  ADD CONSTRAINT ck_positions_weight_positive CHECK (weight > 0);

ALTER TABLE exchange_rates
  ADD CONSTRAINT ck_exchange_rates_rate_positive CHECK (rate > 0);

ALTER TABLE daily_distributions
  ADD CONSTRAINT ck_daily_distributions_pool_team
    CHECK ((pool_mode = 'SINGLE') = (team_id IS NULL)),
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
  ADD CONSTRAINT ck_ddi_hours CHECK (hours > 0 AND hours <= 24),
  ADD CONSTRAINT ck_ddi_weight CHECK (weight_snapshot > 0),
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

-- Un pozo vigente por restaurante, día y equipo (team_id NULL = pozo único del restaurante).
CREATE UNIQUE INDEX ux_daily_distributions_active
  ON daily_distributions (restaurant_id, date, COALESCE(team_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status <> 'VOIDED';

-- Una liquidación vigente por restaurante y semana.
CREATE UNIQUE INDEX ux_weekly_settlements_active
  ON weekly_settlements (restaurant_id, week_start)
  WHERE status <> 'VOIDED';

-- -----------------------------------------------------------------------------
-- 3. Triggers: un día no puede mezclar pozo único y pozos por equipo
--    (validación best-effort; la app además valida dentro de su transacción)
-- -----------------------------------------------------------------------------

CREATE FUNCTION fn_daily_distributions_no_mixed_modes() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'VOIDED' AND EXISTS (
       SELECT 1
       FROM daily_distributions d
       WHERE d.restaurant_id = NEW.restaurant_id
         AND d.date = NEW.date
         AND d.status <> 'VOIDED'
         AND d.pool_mode <> NEW.pool_mode
         AND d.id <> NEW.id
     )
  THEN
    RAISE EXCEPTION 'RULE: a day cannot mix SINGLE and PER_TEAM pools (restaurant %, date %)',
      NEW.restaurant_id, NEW.date;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_distributions_no_mixed_modes
  BEFORE INSERT OR UPDATE OF status, pool_mode, date, restaurant_id ON daily_distributions
  FOR EACH ROW EXECUTE FUNCTION fn_daily_distributions_no_mixed_modes();

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
