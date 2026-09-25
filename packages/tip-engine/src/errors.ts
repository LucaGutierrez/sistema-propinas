export type EngineErrorCode =
  | 'INVALID_DECIMAL'
  | 'INVALID_AMOUNT'
  | 'INVALID_HOURS'
  | 'INVALID_WEIGHT'
  | 'INVALID_RATE'
  | 'INVALID_DATE'
  | 'INVALID_TIP'
  | 'INVALID_EMPLOYEE'
  | 'INVALID_ADVANCE'
  | 'INVALID_SETTLEMENT'
  | 'NO_TIPS'
  | 'NO_EMPLOYEES'
  | 'NO_HOURS'
  | 'DUPLICATE_EMPLOYEE'
  | 'DUPLICATE_ID'
  | 'INTERNAL_INVARIANT';

export class EngineError extends Error {
  readonly code: EngineErrorCode;

  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

/** Runs `fn`; if it throws an EngineError, rethrows it under a more specific code. */
export function withCode<T>(code: EngineErrorCode, fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof EngineError) {
      throw new EngineError(code, error.message);
    }
    throw error;
  }
}
