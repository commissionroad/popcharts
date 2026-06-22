import type { Address } from "viem";

/**
 * Prints the shared pre-deployment summary shown before broadcasting.
 */
export declare function printDeploymentHeader(args: {
  balance: bigint;
  chainId: number;
  chainName: string;
  contractName: string;
  currencyDecimals: number;
  currencySymbol: string;
  deployerAddress: Address;
  rpcUrl: string;
}): void;
