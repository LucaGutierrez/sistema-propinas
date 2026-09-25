import { EngineError } from './errors';
import { CENTS_SCALE, formatFixed, parseFixed } from './fixed';

/** Integer division of non-negative `n` by positive `d`, rounding halves up. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (typeof n !== 'bigint' || typeof d !== 'bigint') {
    throw new EngineError('INVALID_AMOUNT', 'Division operands must be bigint');
  }
  if (d <= 0n) {
    throw new EngineError('INVALID_AMOUNT', 'Divisor must be positive');
  }
  if (n < 0n) {
    throw new EngineError('INVALID_AMOUNT', 'Dividend must not be negative');
  }
  return (2n * n + d) / (2n * d);
}

/** "1234.56" -> 123456n */
export function parseCents(input: string): bigint {
  return parseFixed(input, CENTS_SCALE);
}

/** 123456n -> "1234.56" */
export function formatCents(cents: bigint): string {
  return formatFixed(cents, CENTS_SCALE);
}

/** 123456n -> "1.234,56" (es-AR presentation, no Intl involved). */
export function formatCentsEsAr(cents: bigint): string {
  if (typeof cents !== 'bigint') {
    throw new EngineError('INVALID_AMOUNT', 'Amounts must be bigint');
  }
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(CENTS_SCALE + 1, '0');
  const integerPart = digits.slice(0, digits.length - CENTS_SCALE);
  const fraction = digits.slice(digits.length - CENTS_SCALE);
  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped},${fraction}`;
}
