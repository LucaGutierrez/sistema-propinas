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
