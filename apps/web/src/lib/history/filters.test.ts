import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { historyHref, parseHistoryFilters } from './filters';

describe('filtros del historial', () => {
  it('lee estado, fechas, persona y página; lo inválido se ignora', () => {
    expect(
      parseHistoryFilters({
        estado: 'voided',
        desde: '2025-01-01',
        hasta: '2025-12-31',
        persona: '  Ana ',
        pagina: '3',
      }),
    ).toEqual({ status: 'VOIDED', from: '2025-01-01', to: '2025-12-31', employee: 'Ana', page: 3 });
    expect(
      parseHistoryFilters({ estado: 'OPEN', desde: '2025-13-01', hasta: 'x', pagina: '-2' }),
    ).toEqual({ status: 'CLOSED', from: null, to: null, employee: null, page: 1 });
    // Sin estado se ven los cerrados; los eliminados (anulados) se piden explícitamente.
    expect(parseHistoryFilters({}).status).toBe('CLOSED');
    expect(parseHistoryFilters({ estado: 'todos' }).status).toBeNull();
    expect(parseHistoryFilters({ persona: 'x'.repeat(200) }).employee).toHaveLength(80);
  });

  it('arma la URL sin perder los filtros', () => {
    const filters = parseHistoryFilters({ estado: 'CLOSED', persona: 'Leo' });
    expect(historyHref(filters, 2)).toBe('/historial?persona=Leo&pagina=2');
    expect(historyHref(parseHistoryFilters({}))).toBe('/historial');
    expect(historyHref(parseHistoryFilters({ estado: 'TODOS' }))).toBe('/historial?estado=TODOS');
    expect(historyHref(parseHistoryFilters({ estado: 'VOIDED' }))).toBe('/historial?estado=VOIDED');
  });
});

describe('el historial no recalcula', () => {
  it('no importa el motor, la vista previa, ni la política/puestos actuales', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../server/history/repository.ts', import.meta.url)),
      'utf8',
    );
    for (const forbidden of [
      'provisional-formula',
      'period-preview',
      'computeProvisionalDistribution',
      'buildPeriodPreview',
      'getPolicyVersion',
      'getCurrentPolicy',
      'currentPolicyVersion',
    ]) {
      expect({ forbidden, found: source.includes(forbidden) }).toEqual({ forbidden, found: false });
    }
  });
});
