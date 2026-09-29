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
