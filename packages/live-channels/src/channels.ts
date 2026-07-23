/**
 * The channel vocabulary (repo ADR 0021): the exact strings the SSE relay
 * routes rows to and the browser subscribes with. A divergence here is the
 * quietest failure in the system — the client subscribes to a channel the
 * server never publishes to, nothing errors, and the surface simply stops
 * updating — which is why both sides import these rather than spell them.
 */

/** The single global discovery-board channel — every market-list transition. */
export const MARKET_LIST_CHANNEL = "markets";

/** One market's channel: its page, price, and graduation progress. */
export function marketChannel(chainId: number, marketId: string): string {
  return `market:${chainId}:${marketId}`;
}

/**
 * One holder's portfolio channel. Lower-cased so a subscription matches
 * regardless of the address checksum casing either side happened to hold — the
 * server routes from a stored column, the client from a connected wallet, and
 * the two disagree on casing often enough that this has to be normalised in
 * the shared builder rather than at each call site.
 */
export function portfolioChannel(owner: string): string {
  return `portfolio:${owner.toLowerCase()}`;
}
