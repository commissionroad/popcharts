/**
 * Re-export of the generated `MarketTypes.MarketStatus` table so the
 * `@popcharts/protocol/market-status` subpath and every existing importer keep
 * working unchanged. The table itself is derived from the solc AST by
 * scripts/export-contract-metadata.ts — change the Solidity enum and rebuild,
 * never this file.
 */
export { MARKET_STATUS, MARKET_STATUS_MEMBERS } from "./generated/contract-enums.js";
export type { MarketStatusCode } from "./generated/contract-enums.js";
