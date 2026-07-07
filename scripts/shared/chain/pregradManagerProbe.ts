/**
 * Selector of `PregradManager.marketCount()`, used to probe whether the
 * address in the local env file is the current PregradManager deployment
 * before creating a market. Mirrored by a protocol-side test
 * (protocol/test/nodejs/create-local-market.test.ts) so a contract rename
 * fails there instead of silently breaking this probe.
 */
export const MARKET_COUNT_SELECTOR = "0xec979082";

/** Checks an eth_call result decodes as one uint256 word. */
export function isUint256Word(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function formatChainId(chainId: unknown): string {
  if (typeof chainId !== "string") {
    return String(chainId);
  }

  try {
    return `${BigInt(chainId)} (${chainId})`;
  } catch {
    return chainId;
  }
}
