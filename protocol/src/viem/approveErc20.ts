import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";

import { requireSuccessfulReceipt } from "./requireSuccessfulReceipt.js";

type Erc20ApprovalWriter = {
  writeContract(parameters: {
    abi: typeof erc20Abi;
    address: Address;
    args: readonly [Address, bigint];
    functionName: "approve";
  }): Promise<Hex>;
};

/**
 * Approves an exact ERC20 allowance and waits for inclusion. Smoke flows
 * grant scoped allowances (market, router, token puller) instead of unlimited
 * ones, so each approval is sized to the amount the next call will pull.
 */
export async function approveErc20(args: {
  readonly amount: bigint;
  readonly publicClient: PublicClient;
  readonly spender: Address;
  readonly token: Address;
  readonly walletClient: Erc20ApprovalWriter;
}): Promise<void> {
  const hash = await args.walletClient.writeContract({
    abi: erc20Abi,
    address: args.token,
    args: [args.spender, args.amount],
    functionName: "approve",
  });
  await requireSuccessfulReceipt(
    args.publicClient,
    hash,
    `approve ${args.token} for ${args.spender}`,
  );
}
