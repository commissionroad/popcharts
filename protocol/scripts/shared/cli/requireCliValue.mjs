import { getAddress, isAddress } from "viem";

/**
 * Reads the required value that follows a CLI flag.
 */
export function readRequiredArg(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Expected a value after ${flag}.`);
  }
  return value;
}

/**
 * Normalizes an EVM address from CLI, environment, or manifest input.
 */
export function requireAddress(value, label) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Expected ${label} to be an Ethereum address.`);
  }
  return getAddress(value);
}

/**
 * Parses a positive safe integer from CLI, environment, or manifest input.
 */
export function requirePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return parsed;
}

/**
 * Parses a non-negative safe integer from CLI, environment, or manifest input.
 */
export function requireNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Expected ${label} to be a non-negative integer.`);
  }
  return parsed;
}

/**
 * Requires a non-empty string from CLI, environment, or manifest input.
 */
export function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected ${label} to be set.`);
  }
  return value;
}
