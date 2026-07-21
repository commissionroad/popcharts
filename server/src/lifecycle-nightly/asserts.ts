import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
} from "viem";

/**
 * Assertion helpers shared by lifecycle scenarios. Failures throw with the
 * failing label so the scenario report points at the broken transition, not
 * a bare comparison.
 */

/** Asserts strict equality, labeling the failing transition on mismatch. */
export function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

/** Asserts a value is present (truthy) and narrows it for the caller. */
export function assertTruthy<T>(
  label: string,
  value: T | null | undefined | false,
): T {
  if (!value) {
    throw new Error(`${label}: expected a value, got ${value}`);
  }
  return value;
}

/**
 * Asserts that a simulated call fails with a genuine contract revert — the
 * guard under test held. Transport, encoding, and account errors are
 * rethrown rather than counted as reverts, so an RPC outage cannot make a
 * guard assertion pass vacuously.
 */
export async function assertReverts(
  label: string,
  simulate: () => Promise<unknown>,
): Promise<void> {
  try {
    await simulate();
  } catch (error) {
    const reverted =
      error instanceof BaseError &&
      error.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError ||
          cause instanceof ContractFunctionZeroDataError,
      ) !== null;
    if (reverted) {
      return;
    }
    throw new Error(
      `${label}: call failed without a contract revert — cannot confirm the guard held.`,
      { cause: error },
    );
  }
  throw new Error(`${label}: expected the call to revert, but it succeeded`);
}
