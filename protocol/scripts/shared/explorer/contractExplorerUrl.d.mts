import type { Address } from "viem";

/**
 * Formats a contract address URL for explorers that use an address route.
 */
export declare function contractExplorerUrl(args: {
  address: Address;
  addressPath?: string;
  browserUrl: string;
}): string;
