import { EngineError, withCode } from './errors';
import { RATE_SCALE, parseFixed, pow10 } from './fixed';
import { divRoundHalfUp } from './money';

/** Parses a pesos-per-dollar rate ("1180.50") into an integer scaled by 10^6. Must be > 0. */
export function parseRate(rate: string): bigint {
  const rateE6 = withCode('INVALID_RATE', () => parseFixed(rate, RATE_SCALE));
  if (rateE6 <= 0n) {
    throw new EngineError('INVALID_RATE', 'Exchange rate must be greater than zero');
  }
  return rateE6;
}

/**
 * Converts USD cents to ARS cents: round_half_up(usdCents x rate). Rounds once, exactly.
 * Example: 5000n (USD 50.00) at "1180.00" -> 5900000n (ARS 59.000,00).
 */
export function convertUsdToArs(usdCents: bigint, rate: string): bigint {
  if (typeof usdCents !== 'bigint' || usdCents < 0n) {
    throw new EngineError('INVALID_AMOUNT', 'USD amount must be a non-negative bigint');
  }
  return divRoundHalfUp(usdCents * parseRate(rate), pow10(RATE_SCALE));
}
