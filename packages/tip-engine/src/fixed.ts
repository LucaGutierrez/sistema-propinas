import { EngineError } from './errors';

/** Decimal places of each scaled-integer quantity used by the engine. */
export const CENTS_SCALE = 2;
export const HOURS_SCALE = 2;
export const WEIGHT_SCALE = 2;
export const POINTS_SCALE = HOURS_SCALE + WEIGHT_SCALE;
export const PERCENT_SCALE = 6;
export const RATE_SCALE = 6;

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const MAX_INPUT_LENGTH = 40;

export function pow10(scale: number): bigint {
  if (scale < 0 || scale > 30 || scale % 1 !== 0) {
    throw new EngineError('INVALID_DECIMAL', `Invalid decimal scale: ${scale}`);
  }
  return 10n ** BigInt(scale);
}

/**
 * Parses a non-negative decimal string into an integer scaled by 10^scale
 * ("7.5", scale 2 -> 750n). The value is never converted to a JS number.
 * More decimals than `scale` are rejected unless the excess digits are all zeros.
 */
export function parseFixed(input: string, scale: number): bigint {
  if (typeof input !== 'string') {
    throw new EngineError('INVALID_DECIMAL', 'Decimal values must be provided as strings');
  }
  const match = input.length <= MAX_INPUT_LENGTH ? DECIMAL_PATTERN.exec(input) : null;
  if (!match) {
    throw new EngineError('INVALID_DECIMAL', `Invalid decimal value: "${input}"`);
  }
  const integerPart = match[1] ?? '';
  const fraction = match[2] ?? '';
  let kept = fraction;
  if (fraction.length > scale) {
    if (/[^0]/.test(fraction.slice(scale))) {
      throw new EngineError('INVALID_DECIMAL', `"${input}" has more than ${scale} decimal places`);
    }
    kept = fraction.slice(0, scale);
  }
  return BigInt(integerPart + kept.padEnd(scale, '0'));
}

/** Formats a scaled integer as a plain decimal string ("750n", scale 2 -> "7.50"). */
export function formatFixed(value: bigint, scale: number): string {
  if (typeof value !== 'bigint') {
    throw new EngineError('INVALID_DECIMAL', 'Scaled values must be bigint');
  }
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const integerPart = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  const body = scale === 0 ? integerPart : `${integerPart}.${fraction}`;
  return negative ? `-${body}` : body;
}
