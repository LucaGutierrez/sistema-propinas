/**
 * DATOS DEMO basados en la planilla real (Hoja1, 23/11/2024). Solo para ver y probar la
 * interfaz: se guardan en el navegador, no en la base de datos, y no son casos de test del motor.
 */

export interface SeedPosition {
  id: string;
  name: string;
  /** Factor provisional por hora, como decimal ("0,014"). */
  factor: string;
}

export interface SeedStaff {
  id: string;
  name: string;
  positionId: string;
  /** Horas totales de la semana de la planilla. */
  weekHours: string;
  /** Adelanto descontado en la semana de la planilla. */
  advance: string;
}

export const RESTAURANT_NAME = 'Restaurante demo';

export const SEED_POSITIONS: readonly SeedPosition[] = [
  { id: 'supervisor', name: 'Supervisor', factor: '0,014' },
  { id: 'barra', name: 'Barra', factor: '0,022' },
  { id: 'salon', name: 'Salón', factor: '0,022' },
  { id: 'bacha', name: 'Bacha', factor: '0,007' },
];

export const SEED_STAFF: readonly SeedStaff[] = [
  { id: 'ivan', name: 'Ivan', positionId: 'supervisor', weekHours: '45', advance: '' },
  { id: 'nardelli', name: 'Nardelli', positionId: 'supervisor', weekHours: '18', advance: '' },
  { id: 'roro', name: 'Roro', positionId: 'barra', weekHours: '45', advance: '' },
  { id: 'marcos', name: 'Marcos', positionId: 'barra', weekHours: '13', advance: '' },
  { id: 'leo', name: 'Leo', positionId: 'salon', weekHours: '54', advance: '10.000' },
  { id: 'isaias', name: 'Isaías', positionId: 'salon', weekHours: '36', advance: '' },
  { id: 'agus-fulleda', name: 'Agus Fulleda', positionId: 'salon', weekHours: '32', advance: '' },
  { id: 'cami-noche', name: 'Cami noche', positionId: 'salon', weekHours: '5', advance: '' },
  { id: 'agus-noche', name: 'Agus noche', positionId: 'salon', weekHours: '5', advance: '' },
  { id: 'nahuel', name: 'Nahuel', positionId: 'bacha', weekHours: '24', advance: '' },
  { id: 'jesus', name: 'Jesús', positionId: 'bacha', weekHours: '20', advance: '' },
  { id: 'jean', name: 'Jean', positionId: 'bacha', weekHours: '4', advance: '' },
];

/**
 * La semana de la planilla. No sabemos cuánto se hizo cada día: el encargado cargó el total de
 * la semana, así que se registra como un único pozo el día de la planilla.
 */
export const SEED_WEEK = {
  startDate: '2024-11-18',
  tipDate: '2024-11-23',
  total: '347.990',
  note: 'Semana de la planilla: el pozo se cargó como un único total (no hay detalle por día).',
} as const;
