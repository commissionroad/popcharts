/**
 * Assertion helpers shared by lifecycle scenarios. Failures throw with the
 * failing label so the scenario report points at the broken transition, not
 * a bare comparison.
 */

export function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

export function assertTruthy<T>(
  label: string,
  value: T | null | undefined | false,
): T {
  if (!value) {
    throw new Error(`${label}: expected a value, got ${value}`);
  }
  return value;
}

/** Asserts that a simulated call reverts — the guard held. */
export async function assertReverts(
  label: string,
  simulate: () => Promise<unknown>,
): Promise<void> {
  try {
    await simulate();
  } catch {
    return;
  }
  throw new Error(`${label}: expected the call to revert, but it succeeded`);
}

/**
 * On-chain PregradManager MarketStatus codes (MarketTypes.MarketStatus enum
 * order). One copy for the whole harness; scenarios must not restate these.
 */
export const CHAIN_STATUS = {
  active: 0,
  frozen: 1,
  graduating: 2,
  graduated: 3,
  refunded: 4,
  resolved: 5,
  cancelled: 6,
  underReview: 7,
  rejected: 8,
} as const;
