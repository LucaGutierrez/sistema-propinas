/**
 * Reglas de negocio que TODAVÍA NO están decididas. La demo usa un comportamiento provisional
 * para cada una; no son reglas definitivas. Se muestran en la pantalla "Reglas de cálculo" y
 * están documentadas en PROGRESS.md (§10). Cuando se decida una, se actualiza acá y allá.
 */
export interface PendingDecision {
  id: string;
  topic: string;
  /** Qué hace hoy la demo (provisional). */
  today: string;
  /** Qué falta decidir con el negocio / la planilla. */
  question: string;
}

export const PENDING_DECISIONS: readonly PendingDecision[] = [
  {
    id: 'P1',
    topic: 'Pozo diario y horas semanales',
    today:
      'Se anota el pozo de cada día y al cerrar la semana se reparte la suma con las horas totales de la semana.',
    question:
      '¿Cada día se reparte por separado (con horas semanales o acumuladas hasta ese día) y se guarda un reparto por día? ¿Cuándo se congelan las horas semanales?',
  },
  {
    id: 'P2',
    topic: 'Porcentajes por grupo',
    today: 'No hay grupos con porcentaje: todo el pozo se reparte junto por puntos.',
    question:
      '¿Qué porcentaje del pozo le toca a cada grupo (salón, barra, cocina…)? ¿Qué pasa con el porcentaje de un grupo si ese día no trabajó nadie de él?',
  },
  {
    id: 'P3',
    topic: 'Puntos y factores',
    today:
      'Puntos = horas × factor del puesto (hasta 4 decimales). Los factores cargados (0,014 / 0,022 / 0,007) son los que se ven redondeados en la planilla.',
    question:
      '¿El factor es por puesto o por persona? En la planilla, dentro de Bacha hay factores distintos. ¿Cuál es el valor exacto (p. ej. 0,65 ÷ 45)?',
  },
  {
    id: 'P4',
    topic: 'Redondeo',
    today: 'Se reparte al centavo por mayor resto (la suma coincide siempre con el pozo).',
    question:
      '¿Se reparte en pesos enteros? Con mayor resto en pesos se reproduce exactamente la planilla de noviembre.',
  },
  {
    id: 'P5',
    topic: 'Recepción y Cocina',
    today: 'No se usan: la planilla los muestra en 0.',
    question: '¿Son otras fuentes que se suman al mismo pozo o pozos aparte con su propio reparto?',
  },
  {
    id: 'P6',
    topic: 'Aplicación de adelantos en el tiempo',
    today:
      'Los adelantos cargados en la semana se descuentan del sobre de esa semana; lo que no alcanza pasa como saldo a la siguiente.',
    question:
      '¿Un adelanto se descuenta de toda la semana o solo de lo generado desde su fecha? ¿Se registran uno por uno con fecha?',
  },
  {
    id: 'P7',
    topic: 'Casos de prueba del Excel',
    today: 'Los 3 tests del Excel siguen pendientes en el motor de cálculo.',
    question: 'Se completan cuando estén decididos P1 a P4 (y el Excel original, no solo la foto).',
  },
  {
    id: 'P8',
    topic: 'Quién prepara y entrega sobres',
    today: 'Solo el Encargado. Revertir una entrega también (esto último sí está decidido).',
    question: '¿El Editor también puede preparar y entregar sobres?',
  },
];
