import { erc20Abi, type Address, type PublicClient } from "viem";

/**
 * Reads an ERC20 balance. Smoke flows compare balances around swaps, mints,
 * and redemptions, so the read lives in one place instead of four scripts.
 */
export async function readErc20Balance(
  publicClient: PublicClient,
  token: Address,
  owner: Address,
): Promise<bigint> {
  return publicClient.readContract({
    abi: erc20Abi,
    address: token,
    args: [owner],
    functionName: "balanceOf",
  });
}
