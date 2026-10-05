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
