import { describe, expect, it } from 'vitest';
import { CAN, ROLES, roleAllowed } from './roles';

describe('matriz de roles (ARCHITECTURE.md §9)', () => {
  it('quién puede qué', () => {
    const table = ROLES.map((role) => [
      role,
      roleAllowed(role, CAN.viewDistributionConfig),
      roleAllowed(role, CAN.editDistributionConfig),
      roleAllowed(role, CAN.viewEmployees),
    ]);
    expect(table).toEqual([
      ['OWNER', true, true, true],
      ['MANAGER', true, true, true],
      ['EDITOR', true, false, true],
      ['VIEWER', true, false, true],
      ['SELF', false, false, true], // solo su empleado: ver employeeScope
    ]);
  });

  it('una lista vacía no permite a nadie', () => {
    expect(ROLES.some((role) => roleAllowed(role, []))).toBe(false);
  });
});
