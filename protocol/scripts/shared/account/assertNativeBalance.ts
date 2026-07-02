import type { Address, PublicClient } from "viem";

/**
 * Returns the deployer's native token balance, failing early if gas cannot be paid.
 */
export async function assertNativeBalance({
  chainName,
  currencySymbol,
  deployerAddress,
  publicClient,
}: {
  chainName: string;
  currencySymbol: string;
  deployerAddress: Address;
  publicClient: PublicClient;
}): Promise<bigint> {
  const balance = await publicClient.getBalance({ address: deployerAddress });
  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployerAddress} has 0 native ${currencySymbol} on ${chainName}. Fund it before deploying.`,
    );
  }

  return balance;
}
