-- =============================================================================
-- Migración inicial.
--
-- Parte 1: DDL generado por Prisma desde schema.prisma
--          (prisma migrate diff --from-empty --to-schema-datamodel, sin editar).
-- Parte 2: copia literal de prisma/sql/0001_constraints.sql (CHECK, índices
--          parciales / por expresión, triggers de inmutabilidad).
--
-- Una migración aplicada no se edita nunca: los cambios van en migraciones nuevas.
-- =============================================================================

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('ARS', 'USD');

-- CreateEnum
CREATE TYPE "rate_source" AS ENUM ('MANUAL', 'API');

-- CreateEnum
CREATE TYPE "tip_pool_mode" AS ENUM ('SINGLE', 'PER_TEAM');

-- CreateEnum
CREATE TYPE "daily_distribution_status" AS ENUM ('DRAFT', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "settlement_status" AS ENUM ('OPEN', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PREPARED', 'DELIVERED', 'VOIDED');

-- CreateEnum
CREATE TYPE "payment_event_type" AS ENUM ('CREATED', 'PREPARED', 'PREPARATION_UNDONE', 'DELIVERED', 'DELIVERY_REVERTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "advance_status" AS ENUM ('PENDING', 'APPLIED', 'VOIDED');

-- CreateEnum
CREATE TYPE "auth_token_type" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "auth_token_type" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limits" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(6) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key","window_start")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "week_starts_on" SMALLINT NOT NULL DEFAULT 1,
    "pool_mode" "tip_pool_mode" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "weight" DECIMAL(6,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "document_id" TEXT,
    "default_position_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "currency_pair" TEXT NOT NULL DEFAULT 'USD_ARS',
    "rate" DECIMAL(18,6) NOT NULL,
    "source" "rate_source" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_distributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "pool_mode" "tip_pool_mode" NOT NULL,
    "team_id" UUID,
    "team_name_snapshot" TEXT,
    "status" "daily_distribution_status" NOT NULL DEFAULT 'DRAFT',
    "tips_ars_cents" BIGINT NOT NULL DEFAULT 0,
    "tips_usd_cents" BIGINT NOT NULL DEFAULT 0,
    "total_cents" BIGINT NOT NULL DEFAULT 0,
    "total_points" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "total_advances_cents" BIGINT NOT NULL DEFAULT 0,
    "total_final_cents" BIGINT NOT NULL DEFAULT 0,
    "settlement_id" UUID,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "daily_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_distribution_id" UUID NOT NULL,
    "currency" "currency" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "exchange_rate" DECIMAL(18,6),
    "exchange_rate_date" DATE,
    "exchange_rate_id" UUID,
    "amount_ars_cents" BIGINT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tip_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_distribution_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "daily_distribution_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "position_id" UUID NOT NULL,
    "employee_name_snapshot" TEXT NOT NULL,
    "position_name_snapshot" TEXT NOT NULL,
    "team_name_snapshot" TEXT NOT NULL,
    "weight_snapshot" DECIMAL(6,2) NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "points" DECIMAL(12,4) NOT NULL,
    "percentage" DECIMAL(9,6) NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "advances_cents" BIGINT NOT NULL DEFAULT 0,
    "final_cents" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_distribution_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "applied_cents" BIGINT NOT NULL DEFAULT 0,
    "status" "advance_status" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advance_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "advance_id" UUID NOT NULL,
    "daily_distribution_item_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "reverted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedes_settlement_id" UUID,
    "status" "settlement_status" NOT NULL DEFAULT 'OPEN',
    "total_cents" BIGINT,
    "total_advances_cents" BIGINT,
    "total_final_cents" BIGINT,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "voided_at" TIMESTAMPTZ(6),
    "voided_by" UUID,
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weekly_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "settlement_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "employee_name_snapshot" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "gross_cents" BIGINT NOT NULL,
    "advances_cents" BIGINT NOT NULL DEFAULT 0,
    "net_cents" BIGINT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "prepared_at" TIMESTAMPTZ(6),
    "prepared_by" UUID,
    "delivered_at" TIMESTAMPTZ(6),
    "delivered_by" UUID,
    "delivery_note" TEXT,
    "supersedes_payment_id" UUID,
    "previously_delivered_cents" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weekly_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_payment_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "event_type" "payment_event_type" NOT NULL,
    "from_status" "payment_status",
    "to_status" "payment_status" NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "performed_by" UUID NOT NULL,
    "authorized_by" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "auth_tokens_token_hash_idx" ON "auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "auth_tokens_user_id_type_idx" ON "auth_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_user_id_restaurant_id_key" ON "memberships"("user_id", "restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_restaurant_id_name_key" ON "teams"("restaurant_id", "name");

-- CreateIndex
CREATE INDEX "positions_restaurant_id_idx" ON "positions"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_team_id_name_key" ON "positions"("team_id", "name");

-- CreateIndex
CREATE INDEX "employees_restaurant_id_active_idx" ON "employees"("restaurant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_restaurant_id_date_currency_pair_key" ON "exchange_rates"("restaurant_id", "date", "currency_pair");

-- CreateIndex
CREATE INDEX "daily_distributions_restaurant_id_date_idx" ON "daily_distributions"("restaurant_id", "date");

-- CreateIndex
CREATE INDEX "daily_distributions_settlement_id_idx" ON "daily_distributions"("settlement_id");

-- CreateIndex
CREATE INDEX "tip_entries_daily_distribution_id_idx" ON "tip_entries"("daily_distribution_id");

-- CreateIndex
CREATE INDEX "daily_distribution_items_employee_id_idx" ON "daily_distribution_items"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_distribution_items_daily_distribution_id_employee_id_key" ON "daily_distribution_items"("daily_distribution_id", "employee_id");

-- CreateIndex
CREATE INDEX "advances_restaurant_id_employee_id_status_idx" ON "advances"("restaurant_id", "employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "advance_applications_advance_id_daily_distribution_item_id_key" ON "advance_applications"("advance_id", "daily_distribution_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_settlements_supersedes_settlement_id_key" ON "weekly_settlements"("supersedes_settlement_id");

-- CreateIndex
CREATE INDEX "weekly_settlements_restaurant_id_status_idx" ON "weekly_settlements"("restaurant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_settlements_restaurant_id_week_start_revision_key" ON "weekly_settlements"("restaurant_id", "week_start", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_payments_supersedes_payment_id_key" ON "weekly_payments"("supersedes_payment_id");

-- CreateIndex
CREATE INDEX "weekly_payments_restaurant_id_status_idx" ON "weekly_payments"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "weekly_payments_employee_id_period_start_idx" ON "weekly_payments"("employee_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_payments_settlement_id_employee_id_key" ON "weekly_payments"("settlement_id", "employee_id");

-- CreateIndex
CREATE INDEX "weekly_payment_events_payment_id_occurred_at_idx" ON "weekly_payment_events"("payment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_restaurant_id_created_at_idx" ON "audit_log"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_default_position_id_fkey" FOREIGN KEY ("default_position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "weekly_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distributions" ADD CONSTRAINT "daily_distributions_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_daily_distribution_id_fkey" FOREIGN KEY ("daily_distribution_id") REFERENCES "daily_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distribution_items" ADD CONSTRAINT "daily_distribution_items_daily_distribution_id_fkey" FOREIGN KEY ("daily_distribution_id") REFERENCES "daily_distributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distribution_items" ADD CONSTRAINT "daily_distribution_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_distribution_items" ADD CONSTRAINT "daily_distribution_items_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_advance_id_fkey" FOREIGN KEY ("advance_id") REFERENCES "advances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advance_applications" ADD CONSTRAINT "advance_applications_daily_distribution_item_id_fkey" FOREIGN KEY ("daily_distribution_item_id") REFERENCES "daily_distribution_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_supersedes_settlement_id_fkey" FOREIGN KEY ("supersedes_settlement_id") REFERENCES "weekly_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_settlements" ADD CONSTRAINT "weekly_settlements_voided_by_fkey" FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "weekly_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_prepared_by_fkey" FOREIGN KEY ("prepared_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_delivered_by_fkey" FOREIGN KEY ("delivered_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payments" ADD CONSTRAINT "weekly_payments_supersedes_payment_id_fkey" FOREIGN KEY ("supersedes_payment_id") REFERENCES "weekly_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payment_events" ADD CONSTRAINT "weekly_payment_events_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payment_events" ADD CONSTRAINT "weekly_payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "weekly_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payment_events" ADD CONSTRAINT "weekly_payment_events_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_payment_events" ADD CONSTRAINT "weekly_payment_events_authorized_by_fkey" FOREIGN KEY ("authorized_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Parte 2: prisma/sql/0001_constraints.sql
-- =============================================================================

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
