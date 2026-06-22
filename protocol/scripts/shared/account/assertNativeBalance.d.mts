import type { Address, PublicClient } from "viem";

/**
 * Returns the deployer's native token balance, failing early if gas cannot be paid.
 */
export declare function assertNativeBalance(args: {
  chainName: string;
  currencySymbol: string;
  deployerAddress: Address;
  publicClient: PublicClient;
}): Promise<bigint>;
