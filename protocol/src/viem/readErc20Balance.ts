import { erc20Abi, type Address, type PublicClient } from "viem";

/**
 * Reads an ERC20 balance. Smoke flows, the venue scripts, and the local bot
 * all compare balances around swaps, mints, and redemptions, so the read lives
 * in one place rather than being re-typed at each call site.
 */
export async function readErc20Balance({
  owner,
  publicClient,
  token,
}: {
  readonly owner: Address;
  readonly publicClient: PublicClient;
  readonly token: Address;
}): Promise<bigint> {
  return publicClient.readContract({
    abi: erc20Abi,
    address: token,
    args: [owner],
    functionName: "balanceOf",
  });
}
