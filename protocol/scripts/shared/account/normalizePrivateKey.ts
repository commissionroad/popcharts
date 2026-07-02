import type { Hex } from "viem";

/**
 * Normalizes a 32-byte private key to the 0x-prefixed form viem expects.
 * The error names the offending env var via `label` but never echoes the value.
 */
export function normalizePrivateKey(
  value: string | undefined,
  { label = "private key" }: { label?: string } = {},
): Hex {
  if (!value) {
    throw new Error(`Expected ${label} to be set.`);
  }

  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Expected ${label} to be a 32-byte hex key.`);
  }

  return key as Hex;
}
