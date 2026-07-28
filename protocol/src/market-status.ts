/**
 * Re-export of the generated `MarketTypes.MarketStatus` table so the
 * `@popcharts/protocol/market-status` subpath and every existing importer keep
 * working unchanged. The table itself is derived from the solc AST by
 * scripts/export-contract-metadata.ts — change the Solidity enum and rebuild,
 * never this file.
 */
/*
 * The re-exports below use the `@popcharts/protocol/contract-enums` package
 * subpath rather than a relative `./generated/...js` specifier ON PURPOSE.
 * These modules are reachable from the Next.js app, and Turbopack cannot
 * resolve intra-package `.js` specifiers — it fails the production build
 * with module-not-found while `pnpm run check` (which never runs
 * `next build`) stays green. See the same constraint in PR #388.
 */
export { MARKET_STATUS, MARKET_STATUS_MEMBERS } from "@popcharts/protocol/contract-enums";
export type { MarketStatusCode } from "@popcharts/protocol/contract-enums";
