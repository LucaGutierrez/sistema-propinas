import { describe, it } from 'vitest';

// TODO: se activará cuando el archivo .xlsx real del restaurante se coloque en `reference/`.
// Plan: exportarlo a fixtures JSON anonimizados (los datos reales de sueldos no se versionan) y
// verificar que el motor reproduce al centavo cada distribución diaria y cada total semanal.
describe('Excel de referencia del restaurante', () => {
  it.todo('reproduce al centavo las distribuciones diarias del Excel real');
  it.todo('reproduce al centavo los totales semanales por empleado del Excel real');
  it.todo('reproduce los adelantos y saldos pendientes del Excel real');
});
