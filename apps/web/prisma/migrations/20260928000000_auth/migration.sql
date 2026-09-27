-- =============================================================================
-- Migración: autenticación con Better Auth y roles de acceso (ARCHITECTURE.md §9).
--
-- NO destructiva: no borra filas ni columnas con datos. Los usuarios existentes se conservan
-- (Better Auth usa la misma tabla `users`); las membresías existentes conservan su rol.
--
-- Orden: guarda → DDL de Prisma (`prisma migrate diff` desde el esquema anterior) →
-- email_verified desde email_verified_at → copia literal de sql/0003_auth.sql.
-- =============================================================================

-- MIGRATION GUARD: el rol ADMIN desaparece (OWNER, MANAGER, EDITOR, VIEWER, SELF). Si alguna
-- membresía lo usa, se aborta sin tocar nada: hay que decidir a mano a qué rol pasa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM memberships WHERE role::text = 'ADMIN') THEN
    RAISE EXCEPTION 'MIGRATION GUARD: memberships with role ADMIN exist; reassign them before migrating';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE email <> lower(email)) THEN
    RAISE EXCEPTION 'MIGRATION GUARD: users with non-lowercase emails exist; normalize them before migrating';
  END IF;
END;
$$;

-- AlterEnum
BEGIN;
CREATE TYPE "membership_role_new" AS ENUM ('OWNER', 'MANAGER', 'EDITOR', 'VIEWER', 'SELF');
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "membership_role_new" USING ("role"::text::"membership_role_new");
ALTER TYPE "membership_role" RENAME TO "membership_role_old";
ALTER TYPE "membership_role_new" RENAME TO "membership_role";
DROP TYPE "membership_role_old";
COMMIT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "employee_id" UUID;

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "password" TEXT,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "refresh_token_expires_at" TIMESTAMPTZ(6),
    "scope" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Better Auth usa un booleano; se conserva lo que ya estuviera verificado.
UPDATE users SET email_verified = true WHERE email_verified_at IS NOT NULL;

-- =============================================================================
-- 0003_auth.sql — cambios de la migración de autenticación (Better Auth) y acceso
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente).
-- =============================================================================

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
