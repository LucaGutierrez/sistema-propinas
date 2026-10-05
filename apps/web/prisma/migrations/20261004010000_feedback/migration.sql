-- =============================================================================
-- Migración: comentarios de testers (feedback).
--
-- ADITIVA: crea la tabla `feedback` y sus enums; no toca datos existentes.
--
-- Orden: DDL de Prisma (`prisma migrate diff` desde el esquema anterior) →
-- copia literal de sql/0006_feedback.sql.
-- =============================================================================

-- CreateEnum
CREATE TYPE "feedback_category" AS ENUM ('BUG', 'SUGGESTION', 'COMMENT');

-- CreateEnum
CREATE TYPE "feedback_status" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED');

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "category" "feedback_category" NOT NULL,
    "title" TEXT,
    "description" TEXT NOT NULL,
    "page" TEXT,
    "status" "feedback_status" NOT NULL DEFAULT 'NEW',
    "user_id" UUID,
    "status_changed_at" TIMESTAMPTZ(6),
    "status_changed_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_created_at_idx" ON "feedback"("created_at" DESC);

-- CreateIndex
CREATE INDEX "feedback_category_created_at_idx" ON "feedback"("category", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- 0006_feedback.sql — comentarios de testers
--
-- Se aplica DESPUÉS del DDL de Prisma de esa migración. Deja la base igual que
-- constraints.sql (conjunto vigente).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 12. Comentarios de testers (feedback)
-- -----------------------------------------------------------------------------

-- 12.1 Descripción de 10 a 4000 caracteres; título opcional de 1 a 120; la pantalla, si está, es
--      una ruta de la app ("/reparto") de hasta 200 caracteres. Quién cambió el estado siempre
--      tiene su fecha.
ALTER TABLE feedback
  ADD CONSTRAINT ck_feedback_description
    CHECK (length(btrim(description)) BETWEEN 10 AND 4000),
  ADD CONSTRAINT ck_feedback_title
    CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120),
  ADD CONSTRAINT ck_feedback_page
    CHECK (page IS NULL OR (page LIKE '/%' AND length(page) <= 200)),
  ADD CONSTRAINT ck_feedback_status_changed
    CHECK (status_changed_by IS NULL OR status_changed_at IS NOT NULL);
