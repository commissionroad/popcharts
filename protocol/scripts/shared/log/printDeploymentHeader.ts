import { formatUnits, getAddress } from "viem";
import type { Address } from "viem";

/**
 * Prints the shared pre-deployment summary shown before broadcasting.
 */
export function printDeploymentHeader({
  balance,
  chainId,
  chainName,
  contractName,
  currencyDecimals,
  currencySymbol,
  deployerAddress,
  rpcUrl,
}: {
  balance: bigint;
  chainId: number;
  chainName: string;
  contractName: string;
  currencyDecimals: number;
  currencySymbol: string;
  deployerAddress: Address;
  rpcUrl: string;
}): void {
  console.log(`Deploying ${contractName} to ${chainName} (${chainId})`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${getAddress(deployerAddress)}`);
  console.log(
    `Native ${currencySymbol} balance: ${formatUnits(balance, currencyDecimals)} (${balance.toString()} wei)`,
  );
}
