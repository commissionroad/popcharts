import type { PublicClient, WalletClient } from "viem";
import { parseEventLogs } from "viem";

import { DisplayableError, presentError } from "@/lib/error-handling";

import type { PopChartsContractConfig } from "./config";
import { readMarketDisputeState } from "./market-dispute-state";
import { completeSetBinaryMarketAbi } from "./postgrad-venue";
import { ensureSpendBalance, ensureTokenAllowance } from "./token-spend";

/**
 * Connected wallet context required to dispute a proposed resolution: the
 * signing account, its active chain, and viem clients bound to the configured
 * chain.
 */
export type DisputeWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * The stages a dispute moves through, reported via `onStep` so the panel can
 * show progress. `approving` only occurs on the bonded path — the resolver's
 * free self-dispute skips it entirely.
 */
export type DisputeStep = "approving" | "confirming" | "disputing";

/**
 * A confirmed dispute, read back from the `ResolutionDisputed` event rather
 * than assumed: `bond` is the collateral the market actually escrowed (raw
 * collateral units, zero for the resolver's self-dispute).
 */
export type DisputeResult = {
  bond: bigint;
  disputer: `0x${string}`;
  transactionHash: `0x${string}`;
};

/**
 * Disputes a postgrad market's proposed resolution with the connected wallet,
 * freezing finalization for human adjudication (ADR 0024 / protocol ADR 0013).
 * The market pulls the bond itself inside `dispute()`, so the ERC20 approval
 * target is the market address, not a router. The resolver disputes bond-free
 * — the operator-override path — and for that account the approval is skipped
 * entirely rather than sent for zero, which would be a pointless signature
 * prompt on a contract that will never pull.
 *
 * Waits for the transaction, then confirms the matching `ResolutionDisputed`
 * event before resolving, so a caller never reports a reverted or unrelated
 * transaction as a posted dispute.
 */
export async function disputeResolution({
  config,
  marketAddress,
  onStep,
  wallet,
}: {
  config: PopChartsContractConfig;
  marketAddress: `0x${string}`;
  onStep?: (step: DisputeStep) => void;
  wallet: DisputeWallet;
}): Promise<DisputeResult> {
  if (wallet.activeChainId !== config.chainId) {
    // DisplayableError: the panel gates on chain, so reaching here means the
    // wallet switched networks mid-flight. A plain Error would collapse to
    // "Could not dispute this resolution.", which names nothing to fix.
    throw new DisplayableError(`Switch your wallet to chain ${config.chainId}.`);
  }

  const [state, collateralToken] = await Promise.all([
    readMarketDisputeState({ marketAddress, publicClient: wallet.publicClient }),
    // The market's own collateral, not the app-configured token: a market
    // deployed against a different collateral must still approve the right one.
    wallet.publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: marketAddress,
      functionName: "collateralToken",
    }),
  ]);

  if (state.phase !== "pending") {
    // DisplayableError: written for the user and shown verbatim by presentError.
    throw new DisplayableError(
      "This resolution is no longer open to dispute. Refresh to see the updated status."
    );
  }

  const requiredBond =
    state.resolver.toLowerCase() === wallet.accountAddress.toLowerCase()
      ? 0n
      : state.bond;

  if (requiredBond > 0n) {
    await ensureSpendBalance({
      amountIn: requiredBond,
      // The market's own collateral precision, not the house 18: on 6-decimal
      // collateral every figure in the shortfall message is otherwise "0.00".
      spendDecimals: state.collateralDecimals,
      spendLabel: "collateral",
      spendToken: collateralToken,
      wallet,
    });
    await ensureTokenAllowance({
      amountIn: requiredBond,
      onStep,
      spender: marketAddress,
      spendToken: collateralToken,
      wallet,
    });
  }

  onStep?.("disputing");
  const hash = await wallet.walletClient.writeContract({
    abi: completeSetBinaryMarketAbi,
    account: wallet.accountAddress,
    address: marketAddress,
    chain: wallet.walletClient.chain,
    functionName: "dispute",
  });

  onStep?.("confirming");
  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const disputedLogs = parseEventLogs({
    abi: completeSetBinaryMarketAbi,
    eventName: "ResolutionDisputed",
    logs: transactionReceipt.logs,
  });
  const disputed = disputedLogs.find(
    (log) => log.args.disputer.toLowerCase() === wallet.accountAddress.toLowerCase()
  );

  if (!disputed) {
    throw new Error("Transaction succeeded but ResolutionDisputed was not emitted.");
  }

  return {
    bond: disputed.args.bond,
    disputer: disputed.args.disputer,
    transactionHash: hash,
  };
}

/**
 * Translates a dispute failure into user-facing copy, mapping the reverts a
 * disputer can realistically hit — a window that closed while the page was
 * open, or a market whose status moved on — to plain explanations instead of
 * raw selectors.
 */
export function getDisputeErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "resolution-dispute" },
    fallback: "Could not dispute this resolution.",
    matcher: (disputeError) => {
      if (disputeError.message.includes("DisputeWindowClosed")) {
        return "The dispute window closed before this transaction landed, so the proposed outcome stands.";
      }

      // Covers both InvalidStatus (the dispute() guard) and
      // InvalidStatusForAction (the proposal reads): either way the market is
      // no longer in the pending state the panel was rendered from.
      if (disputeError.message.includes("InvalidStatus")) {
        return "This resolution is no longer open to dispute. Refresh to see the updated status.";
      }

      return undefined;
    },
  });
}
