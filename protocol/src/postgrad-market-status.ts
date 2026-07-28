/**
 * Re-export of the generated `CompleteSetBinaryMarket.Status` table so the
 * `@popcharts/protocol/postgrad-market-status` subpath and every existing
 * importer keep working unchanged. The table itself is derived from the solc
 * AST by scripts/export-contract-metadata.ts — change the Solidity enum and
 * rebuild, never this file.
 *
 * The enum is append-only, so the codes are NOT in lifecycle order:
 * `resolutionPending` and `disputed` arrived with the dispute window (protocol
 * ADR 0013) and were appended so the three original ordinals stayed stable. A
 * market runs trading → resolutionPending → (disputed) → resolved.
 *
 * Distinct from `MARKET_STATUS`, which encodes the pregrad
 * MarketTypes.MarketStatus set.
 */
/*
 * The re-exports below use the `@popcharts/protocol/contract-enums` package
 * subpath rather than a relative `./generated/...js` specifier ON PURPOSE.
 * These modules are reachable from the Next.js app, and Turbopack cannot
 * resolve intra-package `.js` specifiers — it fails the production build
 * with module-not-found while `pnpm run check` (which never runs
 * `next build`) stays green. See the same constraint in PR #388.
 */
export {
  POSTGRAD_MARKET_STATUS,
  POSTGRAD_MARKET_STATUS_MEMBERS,
} from "@popcharts/protocol/contract-enums";
export type { PostgradMarketStatusCode } from "@popcharts/protocol/contract-enums";
