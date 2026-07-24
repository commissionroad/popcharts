/**
 * Shared on-chain fixed-point conventions. The protocol quotes collateral
 * amounts, probabilities, and LMSR parameters as WAD-scaled bigints (18
 * implied decimals), and the collateral token itself uses 18 decimals. The
 * WAD constant and its decode come from the protocol package (through the
 * integrations/contracts seam) so the app and indexer share one definition.
 */

export { WAD, wadToNumber } from "@/integrations/contracts/wad";

/** Decimals used by the collateral token and WAD fixed-point values. */
export const TOKEN_DECIMALS = 18;
