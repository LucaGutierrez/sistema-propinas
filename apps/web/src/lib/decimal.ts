/**
 * Decimales de escala fija sobre bigint para la interfaz (sin floats).
 * `parseDecimal("0,014", 4)` → 140n. Acepta coma o punto como separador decimal.
 */
export function parseDecimal(input: string, scale: number): bigint | null {
  const text = input.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const integerPart = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > scale && /[^0]/.test(fraction.slice(scale))) return null;
  return BigInt(integerPart + fraction.slice(0, scale).padEnd(scale, '0'));
}

/**
 * Importe en pesos escrito como en Argentina → centavos.
 * "347.990" → 34799000n · "347990" → 34799000n · "1.234,5" → 123450n · "$ 10.000" → 1000000n.
 */
export function parseMoney(input: string): bigint | null {
  const text = input.trim().replace(/^\$/, '').replace(/\s/g, '');
  if (text === '') return null;
  let normalized: string;
  if (text.includes(',')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, '');
  } else {
    normalized = text;
  }
  return parseDecimal(normalized, 2);
}

/** División entera con redondeo half-up (valores no negativos). */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Formatea un entero escalado con separadores es-AR: (4583050n, 4, 3) → "458,305".
 * Redondea half-up a `decimals` decimales.
 */
export function formatScaled(value: bigint, scale: number, decimals: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const rounded =
    decimals >= scale
      ? absolute * 10n ** BigInt(decimals - scale)
      : divRoundHalfUp(absolute, 10n ** BigInt(scale - decimals));
  const digits = rounded.toString().padStart(decimals + 1, '0');
  const integerPart = groupThousands(digits.slice(0, digits.length - decimals));
  const fraction = decimals > 0 ? `,${digits.slice(digits.length - decimals)}` : '';
  return `${negative ? '-' : ''}${integerPart}${fraction}`;
}

/**
 * Centavos → "$ 41.435,81". Entre "$" y el número va un espacio irrompible (U+00A0): en pantallas
 * chicas un monto nunca se parte en dos renglones.
 */
export function formatMoney(cents: bigint): string {
  const text = formatScaled(cents, 2, 2);
  return text.startsWith('-') ? `-$\u00a0${text.slice(1)}` : `$\u00a0${text}`;
}

/** Centavos → "$ 41.436" (sin decimales, para tarjetas de resumen). */
export function formatMoneyShort(cents: bigint): string {
  const text = formatScaled(cents, 2, 0);
  return text.startsWith('-') ? `-$\u00a0${text.slice(1)}` : `$\u00a0${text}`;
}
