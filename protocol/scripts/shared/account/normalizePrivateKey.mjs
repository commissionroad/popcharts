/**
 * Normalizes a 32-byte private key to the 0x-prefixed form viem expects.
 */
export function normalizePrivateKey(value, { label = "private key" } = {}) {
  if (!value) {
    throw new Error(`Expected ${label} to be set.`);
  }

  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Expected ${label} to be a 32-byte hex key.`);
  }

  return key;
}
