import { getAddress, isAddress, type Address } from "viem";

/**
 * Normalizes an EVM address from CLI, environment, or manifest input.
 */
export function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Expected ${label} to be an Ethereum address.`);
  }
  return getAddress(value);
}

/**
 * Parses a positive safe integer from CLI, environment, or manifest input.
 */
export function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return parsed;
}

/**
 * Parses a non-negative safe integer from CLI, environment, or manifest input.
 */
export function requireNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return parsed;
}

/**
 * Requires a non-empty string from CLI, environment, or manifest input.
 */
export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be set.`);
  }
  return value;
}
