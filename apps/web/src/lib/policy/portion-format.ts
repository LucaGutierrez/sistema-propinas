/**
 * Cómo se MUESTRA y se ESCRIBE la porción de un puesto: decimal (0,022) o porcentaje (2,2 %).
 *
 * Es solo presentación. La porción se guarda SIEMPRE como fracción decimal normalizada (la misma
 * que usa el cálculo: "0,022"); el porcentaje es esa fracción × 100. Pasar de un formato al otro
 * mueve la coma dos lugares sobre enteros (sin floats), así que nunca cambia el número guardado ni
 * crea una versión de la política. Preferencia del restaurante: `restaurants.portion_display`.
 */
import { formatScaled, parseDecimal } from '@/lib/decimal';
import { FACTOR_SCALE } from '@/lib/distribution/provisional-formula';

export type PortionDisplay = 'DECIMAL' | 'PERCENT';

export const PORTION_DISPLAYS: readonly PortionDisplay[] = ['DECIMAL', 'PERCENT'];

/** Un porcentaje tiene dos decimales menos que la fracción: 0,0225 = 2,25 %. */
const PERCENT_SCALE = FACTOR_SCALE - 2;

export const PORTION_DISPLAY_LABEL: Record<PortionDisplay, string> = {
  DECIMAL: 'Decimal (ej. 0,022)',
  PERCENT: 'Porcentaje (ej. 2,2 %)',
};

function trimZeros(text: string): string {
  return text.includes(',') ? text.replace(/0+$/, '').replace(/,$/, '') : text;
}

/** Fracción escalada (E4) → texto en el formato pedido ("0,022" o "2,2 %"). */
export function formatPortionE4(factorE4: bigint, display: PortionDisplay): string {
  if (display === 'PERCENT') {
    return `${trimZeros(formatScaled(factorE4, PERCENT_SCALE, PERCENT_SCALE))} %`;
  }
  return trimZeros(formatScaled(factorE4, FACTOR_SCALE, FACTOR_SCALE));
}

/**
 * Porción guardada (fracción decimal, "0,022" o "0.0220000000") → cómo se muestra.
 * Si no es un número válido se devuelve tal cual (nunca se inventa un valor).
 */
export function formatPortion(factor: string, display: PortionDisplay): string {
  // Los ceros de más de la base ("0.0220000000") no son decimales significativos.
  const text = /[.,]/.test(factor) ? factor.replace(/0+$/, '') : factor;
  const factorE4 = parseDecimal(text, FACTOR_SCALE);
  return factorE4 === null ? factor : formatPortionE4(factorE4, display);
}

/**
 * Lo que escribió el usuario en el formato que tenía en pantalla → porción decimal normalizada
 * ("2,2" en porcentaje → "0,022"). null si no es un número mayor que cero con los decimales
 * admitidos (4 en decimal, 2 en porcentaje: la misma precisión guardada).
 */
export function parsePortionInput(text: string, display: PortionDisplay): string | null {
  const clean = text.trim().replace(/\s*%$/, '');
  // En porcentaje, "2,25" (E2 del porcentaje) ES la fracción en E4: 2,25 % = 0,0225.
  const factorE4 = parseDecimal(clean, display === 'PERCENT' ? PERCENT_SCALE : FACTOR_SCALE);
  if (factorE4 === null || factorE4 <= 0n) return null;
  return formatPortionE4(factorE4, 'DECIMAL');
}

export function portionInputError(display: PortionDisplay): string {
  return display === 'PERCENT'
    ? `La porción tiene que ser un porcentaje mayor que cero (hasta ${PERCENT_SCALE} decimales).`
    : `La porción tiene que ser un número mayor que cero (hasta ${FACTOR_SCALE} decimales).`;
}

export function portionPlaceholder(display: PortionDisplay): string {
  return display === 'PERCENT' ? '1,5' : '0,015';
}
