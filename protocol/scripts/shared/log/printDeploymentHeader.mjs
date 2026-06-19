import { formatUnits, getAddress } from "viem";

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
}) {
  console.log(`Deploying ${contractName} to ${chainName} (${chainId})`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${getAddress(deployerAddress)}`);
  console.log(`Native ${currencySymbol} balance: ${formatUnits(balance, currencyDecimals)}`);
}
