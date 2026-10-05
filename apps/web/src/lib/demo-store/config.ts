/**
 * Catálogo de parámetros de la política de distribución (CONFIG-MODEL.md).
 *
 * GUTIP no tiene "la regla": cada restaurante tiene una política versionada (ver policy.ts) que
 * arranca con la configuración estándar y se puede personalizar. Acá están los parámetros, sus
 * opciones (con las que GUTIP ya implementa marcadas) y los valores estándar.
 */

export interface DistributionConfig {
  period: 'SEMANAL' | 'QUINCENAL' | 'MENSUAL';
  splitTiming: 'POR_PERIODO' | 'POR_DIA';
  hoursBasis: 'TOTAL_PERIODO' | 'DEL_DIA' | 'ACUMULADAS';
  hoursEntry: 'TOTAL_AL_CERRAR' | 'POR_DIA';
  sources: 'UNA_FUENTE' | 'VARIAS_SUMADAS' | 'POZOS_SEPARADOS';
  groups: 'SIN_GRUPOS' | 'PORCENTAJE_POR_GRUPO';
  weights: 'POR_PUESTO' | 'POR_PUNTOS' | 'PUESTO_POR_PUNTOS' | 'PUESTO_CON_EXCEPCIONES';
  rounding: 'CENTAVO' | 'PESO' | 'DIEZ' | 'CIEN';
  advances: 'TODO_EL_PERIODO' | 'DESDE_SU_FECHA' | 'A_ELECCION';
  envelopes: 'SOLO_ENCARGADO' | 'ENCARGADO_Y_EDITOR' | 'ROL_PAGADOR';
}

export type ParamKey = keyof DistributionConfig;

export interface ParamOption {
  value: string;
  label: string;
  description: string;
  /** GUTIP ya calcula así. Las demás opciones se muestran pero no se pueden elegir todavía. */
  supported: boolean;
  /**
   * Solo con la base de datos: la demo del navegador no tiene el dato que la opción necesita
   * (p. ej. los puntos individuales del personal), así que ahí no se puede elegir.
   */
  databaseOnly?: boolean;
}

export interface ParamDefinition {
  key: ParamKey;
  label: string;
  question: string;
  options: ParamOption[];
  /** Lo que sabemos del caso de referencia (Library). */
  library: string;
  /** Aviso de combinaciones que dependen de otro parámetro. */
  dependsOn?: string;
}

export const PARAMS: readonly ParamDefinition[] = [
  {
    key: 'period',
    label: 'Período de liquidación',
    question: '¿Cada cuánto se liquida y se pagan los sobres?',
    options: [
      { value: 'SEMANAL', label: 'Semanal', description: 'Un sobre por semana.', supported: true },
      {
        value: 'QUINCENAL',
        label: 'Quincenal',
        description: 'Un sobre cada 15 días.',
        supported: false,
      },
      { value: 'MENSUAL', label: 'Mensual', description: 'Un sobre por mes.', supported: false },
    ],
    library: 'Semanal (confirmado).',
  },
  {
    key: 'splitTiming',
    label: 'Cuándo se reparte',
    question: '¿Se reparte una vez con el pozo acumulado del período, o cada día por separado?',
    options: [
      {
        value: 'POR_PERIODO',
        label: 'Una vez por período',
        description: 'Se suman los pozos de cada día y se reparte todo junto al cerrar.',
        supported: true,
      },
      {
        value: 'POR_DIA',
        label: 'Cada día',
        description: 'Cada día se reparte su pozo y se guarda el reparto del día.',
        supported: false,
      },
    ],
    library: 'Pozo semanal repartido una vez por semana (confirmado).',
  },
  {
    key: 'hoursBasis',
    label: 'Horas que se usan',
    question: '¿Con qué horas se calcula el ponderado?',
    options: [
      {
        value: 'TOTAL_PERIODO',
        label: 'Total del período',
        description: 'Las horas trabajadas en toda la semana.',
        supported: true,
      },
      {
        value: 'DEL_DIA',
        label: 'Horas del día',
        description: 'Solo las de ese día.',
        supported: false,
      },
      {
        value: 'ACUMULADAS',
        label: 'Acumuladas a la fecha',
        description: 'Las del período hasta ese día.',
        supported: false,
      },
    ],
    library: 'Horas totales de la semana (confirmado).',
    dependsOn: '"Horas del día" y "acumuladas" solo tienen sentido si se reparte cada día.',
  },
  {
    key: 'hoursEntry',
    label: 'Carga de horas',
    question: '¿Cómo se cargan las horas?',
    options: [
      {
        value: 'TOTAL_AL_CERRAR',
        label: 'Total al cerrar',
        description: 'Se carga el total de cada persona al terminar el período.',
        supported: true,
      },
      {
        value: 'POR_DIA',
        label: 'Por día',
        description: 'Se cargan las horas de cada día.',
        supported: false,
      },
    ],
    library: 'Total al cerrar la semana (confirmado).',
    dependsOn: '"Horas del día" exige cargar horas por día.',
  },
  {
    key: 'sources',
    label: 'Fuentes del pozo',
    question: '¿De dónde sale el pozo y cómo se combinan las fuentes?',
    options: [
      {
        value: 'UNA_FUENTE',
        label: 'Un solo monto por día',
        description: 'El pozo del día.',
        supported: true,
      },
      {
        value: 'VARIAS_SUMADAS',
        label: 'Varias fuentes sumadas',
        description: 'Efectivo, tarjeta, recepción… se suman en un mismo pozo.',
        supported: false,
      },
      {
        value: 'POZOS_SEPARADOS',
        label: 'Pozos separados',
        description: 'Cada fuente se reparte entre su propio grupo (p. ej. cocina).',
        supported: false,
      },
    ],
    library: 'Efectivo. "Recepción" y "Cocina" aparecen en 0 en la planilla: falta saber qué son.',
  },
  {
    key: 'groups',
    label: 'Grupos y porcentajes',
    question: '¿El pozo se divide primero entre grupos con un porcentaje?',
    options: [
      {
        value: 'SIN_GRUPOS',
        label: 'Sin grupos',
        description: 'Todos reparten el mismo pozo según su ponderado.',
        supported: true,
      },
      {
        value: 'PORCENTAJE_POR_GRUPO',
        label: 'Por sectores',
        description:
          'Los sectores se reparten en orden y cada uno se lleva un % del total o del saldo que queda (p. ej. Cocina 30 % del total, Salón 50 % del saldo). Un sector puede reunir varios puestos; dentro de cada sector se reparte según el ponderado. Se configura en "Reparto por sectores".',
        supported: true,
        databaseOnly: true,
      },
    ],
    library:
      'La planilla no muestra porcentajes: un solo pozo con un valor por punto (sin confirmar).',
  },
  {
    key: 'weights',
    label: 'Método de participación',
    question:
      '¿Cómo se calcula el ponderado de cada persona? Porción = factor del puesto · Puntos = puntos individuales de la persona (en Personal).',
    options: [
      {
        value: 'POR_PUESTO',
        label: 'Por puesto',
        description:
          'Ponderado = horas × porción del puesto. Los puntos individuales no intervienen.',
        supported: true,
      },
      {
        value: 'POR_PUNTOS',
        label: 'Por puntos individuales',
        description:
          'Ponderado = horas × puntos de la persona. La porción del puesto no interviene.',
        supported: true,
        databaseOnly: true,
      },
      {
        value: 'PUESTO_POR_PUNTOS',
        label: 'Puesto × puntos',
        description:
          'Ponderado = horas × porción del puesto × puntos de la persona. Mismo puesto y horas con más puntos: cobra más.',
        supported: true,
        databaseOnly: true,
      },
      {
        value: 'PUESTO_CON_EXCEPCIONES',
        label: 'Por puesto, con excepciones',
        description:
          'Porción del puesto, con una porción propia (reemplazo) para algunas personas.',
        supported: false,
      },
    ],
    library:
      'Porción por hora = valor del puesto en la planilla ("Pto.") ÷ 45 para la mayoría; en Bacha hay porciones distintas entre personas (sin confirmar).',
  },
  {
    key: 'rounding',
    label: 'Redondeo',
    question: '¿En qué unidad salen los sobres?',
    options: [
      {
        value: 'CENTAVO',
        label: 'Centavos',
        description: 'Reparto exacto al centavo (mayor resto).',
        supported: true,
      },
      {
        value: 'PESO',
        label: 'Pesos enteros',
        description:
          'Reparto exacto en pesos (mayor resto). El pozo tiene que ser un número entero de pesos.',
        supported: true,
      },
      {
        value: 'DIEZ',
        label: 'Múltiplos de $10',
        description: 'Falta definir el destino del sobrante.',
        supported: false,
      },
      {
        value: 'CIEN',
        label: 'Múltiplos de $100',
        description: 'Falta definir el destino del sobrante.',
        supported: false,
      },
    ],
    library:
      'Pesos enteros: con mayor resto en pesos se reproducen los 12 importes de la planilla (sin confirmar).',
  },
  {
    key: 'advances',
    label: 'Descuento de adelantos',
    question: '¿De qué propina se descuenta un adelanto?',
    options: [
      {
        value: 'TODO_EL_PERIODO',
        label: 'De todo el período',
        description: 'Del sobre del período en que se dio, sin mirar la fecha.',
        supported: true,
      },
      {
        value: 'DESDE_SU_FECHA',
        label: 'Desde su fecha',
        description: 'Solo de lo generado desde el día del adelanto.',
        supported: false,
      },
      {
        value: 'A_ELECCION',
        label: 'A elección / en cuotas',
        description: 'El encargado elige en qué período o en cuántas cuotas.',
        supported: false,
      },
    ],
    library: 'Se descuenta en la misma planilla semanal; no hay fechas para saber más (pendiente).',
    dependsOn: '"Desde su fecha" solo tiene sentido si se reparte cada día.',
  },
  {
    key: 'envelopes',
    label: 'Quién prepara y entrega sobres',
    question: '¿Quién puede marcar los sobres como preparados y entregados?',
    options: [
      { value: 'SOLO_ENCARGADO', label: 'Solo el Encargado', description: '', supported: true },
      {
        value: 'ENCARGADO_Y_EDITOR',
        label: 'Encargado y Editor',
        description:
          'El Editor también prepara y entrega. Revertir una entrega sigue siendo solo del Encargado.',
        supported: true,
      },
      {
        value: 'ROL_PAGADOR',
        label: 'Permiso "Pagador"',
        description: 'Un permiso solo para sobres.',
        supported: false,
      },
    ],
    library: 'Pendiente.',
  },
];

/**
 * Configuración estándar de GUTIP (v1): válida y completa, permite calcular y cerrar enseguida.
 * Los puestos estándar están en `@/lib/demo/data` (SEED_POSITIONS). Es la modalidad que GUTIP
 * implementa hoy, no una regla universal: cada restaurante la puede personalizar.
 */
export const STANDARD_VALUES: DistributionConfig = {
  period: 'SEMANAL',
  splitTiming: 'POR_PERIODO',
  hoursBasis: 'TOTAL_PERIODO',
  hoursEntry: 'TOTAL_AL_CERRAR',
  sources: 'UNA_FUENTE',
  groups: 'SIN_GRUPOS',
  weights: 'POR_PUESTO',
  rounding: 'CENTAVO',
  advances: 'TODO_EL_PERIODO',
  envelopes: 'SOLO_ENCARGADO',
};

export function paramDefinition(key: ParamKey): ParamDefinition {
  const definition = PARAMS.find((p) => p.key === key);
  if (!definition) throw new Error(`Parámetro desconocido: ${key}`);
  return definition;
}

export function optionLabel(key: ParamKey, value: string): string {
  return paramDefinition(key).options.find((o) => o.value === value)?.label ?? value;
}

/** La opción solo se puede elegir con la base de datos (la demo no tiene su dato). */
export function isDatabaseOnly(key: ParamKey, value: string): boolean {
  return paramDefinition(key).options.some((o) => o.value === value && o.databaseOnly === true);
}

export function isSupported(key: ParamKey, value: string): boolean {
  return paramDefinition(key).options.some((o) => o.value === value && o.supported);
}

/** Valores guardados → valores válidos (lo que falte o no esté implementado vuelve al estándar). */
export function normalizeValues(value: unknown): DistributionConfig {
  const values = { ...STANDARD_VALUES };
  if (typeof value !== 'object' || value === null) return values;
  const raw = value as Partial<Record<ParamKey, unknown>>;
  for (const param of PARAMS) {
    const v = raw[param.key];
    // La demo solo guarda opciones que puede calcular en el navegador.
    if (typeof v === 'string' && isSupported(param.key, v) && !isDatabaseOnly(param.key, v)) {
      (values as Record<ParamKey, string>)[param.key] = v;
    }
  }
  return values;
}
