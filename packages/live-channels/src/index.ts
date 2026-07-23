/**
 * The live-updates contract shared by the API's SSE relay and the browser
 * client (repo ADR 0021): the channel vocabulary, and the frame bodies that
 * travel over those channels.
 *
 * This is a package rather than a constant in either codebase because the two
 * sides share no other code path — the server is a bun project outside the
 * pnpm workspace, and `GET /events` is a stream, so it is absent from the
 * generated OpenAPI client the app otherwise imports. Every mismatch this
 * package prevents is one that would otherwise **fail silently**, since JSON
 * validates nothing and an unmatched channel raises no error at either end.
 *
 * Routing logic is not here: which tables emit, and which channels a given row
 * fans out to, are server concerns in `server/src/change-feed/sources.ts`.
 */

export {
  MARKET_LIST_CHANNEL,
  marketChannel,
  portfolioChannel,
} from "./channels";

export {
  RESET_REASON_CURSOR_TOO_OLD,
  parseChangeSignal,
  parseResetReason,
  serializeChangeSignal,
  type ChangeSignalSource,
  type ChangeSignalWire,
  type ResetSignalWire,
} from "./wire";
