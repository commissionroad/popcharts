/**
 * The live-updates channel vocabulary (repo ADR 0021): the exact channel
 * strings the API's SSE relay routes rows to and the browser subscribes with.
 *
 * This is a package rather than a constant in either codebase because the two
 * sides share no other code path — the server is a bun project outside the
 * pnpm workspace, and `GET /events` is a stream, so it is absent from the
 * generated OpenAPI client the app otherwise imports. Left mirrored, a
 * divergence here **fails silently**: the client subscribes to a channel the
 * server never publishes to, no error is raised at either end, and the only
 * symptom is a surface that quietly stops updating. Importing one definition
 * makes that mismatch a type error instead.
 *
 * Keep this module free of routing logic and dependencies. Which tables emit,
 * and which channels a given row fans out to, are server concerns and live in
 * `server/src/change-feed/sources.ts`.
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
