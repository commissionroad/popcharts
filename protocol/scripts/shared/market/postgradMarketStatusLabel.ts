import { POSTGRAD_MARKET_STATUS } from "../../../src/postgrad-market-status.js";

const STATUS_NAMES: Record<number, string> = {
  [POSTGRAD_MARKET_STATUS.cancelled]: "Cancelled",
  [POSTGRAD_MARKET_STATUS.disputed]: "Disputed",
  [POSTGRAD_MARKET_STATUS.resolutionPending]: "ResolutionPending",
  [POSTGRAD_MARKET_STATUS.resolved]: "Resolved",
  [POSTGRAD_MARKET_STATUS.trading]: "Trading",
};

/**
 * Renders a CompleteSetBinaryMarket.Status read for operator output as
 * `Name (code)`. Presentation only, so it lives with the scripts rather than
 * in the SDK next to POSTGRAD_MARKET_STATUS, which stays the single definition
 * of the codes themselves. An unrecognised code means the Solidity enum grew
 * again without that table being updated, so it is reported, not hidden.
 */
export function postgradMarketStatusLabel(status: number): string {
  return `${STATUS_NAMES[status] ?? "Unknown"} (${status})`;
}
