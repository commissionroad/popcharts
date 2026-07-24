import type { PublicClient, WalletClient } from "viem";

import { formatTokenAmount } from "@/lib/format";

import { erc20Abi } from "./erc20";

/**
 * Connected wallet context every ERC20 spend preamble needs: the signing
 * account, its active chain, and viem clients bound to the configured chain.
 * Feature-level wallet types (venue swaps, dispute bonds) are structurally
 * assignable to this, so each flow keeps its own domain-named type.
 */
export type TokenSpendWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * Requires the wallet to hold at least `amountIn` of the token a transaction
 * is about to spend, so the failure reads as a balance problem instead of a
 * contract revert.
 */
export async function ensureSpendBalance({
  amountIn,
  spendLabel,
  spendToken,
  wallet,
}: {
  amountIn: bigint;
  spendLabel: string;
  spendToken: `0x${string}`;
  wallet: TokenSpendWallet;
}) {
  const balance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: spendToken,
    functionName: "balanceOf",
    args: [wallet.accountAddress],
  });

  if (balance < amountIn) {
    throw new Error(
      `Insufficient balance. You have ${formatTokenAmount(
        balance
      )} ${spendLabel}, but this order spends ${formatTokenAmount(amountIn)}.`
    );
  }
}

/**
 * Tops up `spender`'s ERC20 allowance on the spend token when it is short,
 * reporting the approval step so tickets can show progress. Used for the swap
 * router, the order manager's token puller, and the dispute bond.
 */
export async function ensureTokenAllowance({
  amountIn,
  onStep,
  spender,
  spendToken,
  wallet,
}: {
  amountIn: bigint;
  onStep: ((step: "approving") => void) | undefined;
  spender: `0x${string}`;
  spendToken: `0x${string}`;
  wallet: TokenSpendWallet;
}) {
  const allowance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: spendToken,
    functionName: "allowance",
    args: [wallet.accountAddress, spender],
  });

  if (allowance >= amountIn) {
    return;
  }

  onStep?.("approving");
  const approvalHash = await wallet.walletClient.writeContract({
    abi: erc20Abi,
    account: wallet.accountAddress,
    address: spendToken,
    chain: wallet.walletClient.chain,
    functionName: "approve",
    args: [spender, amountIn],
  });

  await wallet.publicClient.waitForTransactionReceipt({ hash: approvalHash });
}
