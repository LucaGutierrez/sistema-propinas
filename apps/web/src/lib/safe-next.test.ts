import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next';

describe('safeNextPath', () => {
  it('acepta rutas internas', () => {
    expect(safeNextPath('/configuracion')).toBe('/configuracion');
    expect(safeNextPath('/cuenta?x=1')).toBe('/cuenta?x=1');
  });

  it.each([
    undefined,
    null,
    '',
    'configuracion',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('manda al inicio ante %s', (next) => {
    expect(safeNextPath(next)).toBe('/');
  });

  it('usa el destino por defecto indicado', () => {
    expect(safeNextPath(undefined, '/cuenta')).toBe('/cuenta');
    expect(safeNextPath('//evil.example', '/cuenta')).toBe('/cuenta');
    expect(safeNextPath('/configuracion', '/cuenta')).toBe('/configuracion');
  });
});
