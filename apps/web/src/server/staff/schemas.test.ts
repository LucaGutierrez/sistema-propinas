import { describe, expect, it } from 'vitest';
import {
  MAX_STAFF_NAME,
  addStaffInput,
  firstIssue,
  setStaffActiveInput,
  setStaffPointsInput,
  setStaffPositionInput,
} from './schemas';

const POSITION = '3b30ede5-5eb5-4065-b377-13eb6f556c5b';
const EMPLOYEE = 'b64cb7ba-2008-42b8-9f96-b3de838abdf9';

function error(result: { success: boolean; error?: unknown }): string {
  if (result.success) throw new Error('se esperaba un error');
  return firstIssue(result.error as Parameters<typeof firstIssue>[0]);
}

describe('validación de "Personal"', () => {
  it('agregar: nombre sin espacios de más y puesto uuid', () => {
    expect(addStaffInput.parse({ name: '  Sofía  ', positionId: POSITION })).toEqual({
      name: 'Sofía',
      positionId: POSITION,
    });
    expect(error(addStaffInput.safeParse({ name: '   ', positionId: POSITION }))).toBe(
      'Poné el nombre de la persona.',
    );
    expect(
      error(
        addStaffInput.safeParse({ name: 'x'.repeat(MAX_STAFF_NAME + 1), positionId: POSITION }),
      ),
    ).toMatch(/hasta 80/);
    expect(error(addStaffInput.safeParse({ name: 'Sofía', positionId: 'salon' }))).toBe(
      'Elegí un puesto.',
    );
  });

  it('solo acepta los campos del cambio: el restaurante o el rol del navegador se descartan', () => {
    const parsed = addStaffInput.parse({
      name: 'Sofía',
      positionId: POSITION,
      restaurantId: 'otro',
      role: 'OWNER',
    });
    expect(parsed).toEqual({ name: 'Sofía', positionId: POSITION });
  });

  it('cambiar puesto y activar: ids uuid y booleano', () => {
    expect(setStaffPositionInput.parse({ employeeId: EMPLOYEE, positionId: POSITION })).toEqual({
      employeeId: EMPLOYEE,
      positionId: POSITION,
    });
    expect(error(setStaffPositionInput.safeParse({ employeeId: '1', positionId: POSITION }))).toBe(
      'Ese dato no es válido.',
    );
    expect(setStaffActiveInput.parse({ employeeId: EMPLOYEE, active: false }).active).toBe(false);
    expect(setStaffActiveInput.safeParse({ employeeId: EMPLOYEE, active: 'no' }).success).toBe(
      false,
    );
  });
});

describe('puntos individuales', () => {
  const employeeId = '00000000-0000-4000-8000-000000000001';
  const parse = (points: string) => setStaffPointsInput.safeParse({ employeeId, points });

  it('acepta números mayores que cero con hasta 2 decimales y los normaliza para la base', () => {
    expect(parse('1,20')).toMatchObject({ success: true, data: { points: '1.20' } });
    expect(parse(' 0.8 ')).toMatchObject({ success: true, data: { points: '0.80' } });
    expect(parse('2')).toMatchObject({ success: true, data: { points: '2.00' } });
  });

  it('rechaza cero, negativos, texto, más de 2 decimales y lo que no entra en la base', () => {
    for (const points of ['0', '0,00', '-1', 'abc', '', '1,234', '10000']) {
      expect(parse(points).success).toBe(false);
    }
    expect(parse('0').error?.issues[0]?.message).toBe(
      'Los puntos tienen que ser un número mayor que cero (hasta 2 decimales).',
    );
  });
});
