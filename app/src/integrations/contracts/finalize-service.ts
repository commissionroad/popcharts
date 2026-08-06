import type { PublicClient, WalletClient } from "viem";
import { parseEventLogs } from "viem";

import type { MarketSide } from "@/domain/markets/types";
import { DisplayableError, presentError } from "@/lib/error-handling";

import type { PopChartsContractConfig } from "./config";
import { readMarketDisputeState } from "./market-dispute-state";
import { contractSideToMarketSide } from "./market-side";
import { completeSetBinaryMarketAbi } from "./postgrad-venue";

/**
 * Connected wallet context required to finalize a proposed resolution: the
 * signing account, its active chain, and viem clients bound to the configured
 * chain. Deliberately the same shape as {@link DisputeWallet} rather than a
 * narrower one — the two actions sit on the same panel and are wired from the
 * same hook plumbing.
 */
export type FinalizeWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * The stages a finalize moves through, reported via `onStep`. There is no
 * approval stage: `finalizeResolution()` moves no collateral from the caller,
 * so the wallet signs exactly one transaction.
 */
export type FinalizeStep = "confirming" | "finalizing";

/**
 * A confirmed settlement, read back from the `MarketResolved` event rather
 * than assumed from the side the panel happened to be showing.
 */
export type FinalizeResult = {
  transactionHash: `0x${string}`;
  winningSide: MarketSide;
};

/**
 * Settles a postgrad market whose dispute window has closed, with the
 * connected wallet (ADR 0024 / protocol ADR 0013).
 *
 * This is a manual backstop, not the normal path. Settlement is normally
 * driven by the keeper, which discovers pending markets from the indexed
 * market status — so a market the indexer never recorded as pending is never
 * settled automatically, and sits unresolved with no error anywhere. The
 * contract call is permissionless precisely so anyone can break that deadlock,
 * and this surface is the app's way to press it.
 *
 * No bond and no approval: the contract takes no payment for finalizing and
 * enforces both preconditions itself — the status must still be pending, and
 * the deadline must have passed. A premature or duplicate press therefore
 * costs the caller gas and changes nothing, which is why the button is offered
 * to anyone rather than gated to an operator.
 *
 * Waits for the transaction, then confirms the matching `MarketResolved` event
 * before resolving, so a caller never reports a reverted or unrelated
 * transaction as a settlement.
 */
export async function finalizeMarketResolution({
  config,
  marketAddress,
  onStep,
  wallet,
}: {
  config: PopChartsContractConfig;
  marketAddress: `0x${string}`;
  onStep?: (step: FinalizeStep) => void;
  wallet: FinalizeWallet;
}): Promise<FinalizeResult> {
  if (wallet.activeChainId !== config.chainId) {
    // DisplayableError: the panel gates on chain, so reaching here means the
    // wallet switched networks mid-flight. A plain Error would collapse to
    // "Could not settle this market.", which names nothing to fix.
    throw new DisplayableError(`Switch your wallet to chain ${config.chainId}.`);
  }

  const state = await readMarketDisputeState({
    marketAddress,
    publicClient: wallet.publicClient,
  });

  if (state.phase === "disputed") {
    // DisplayableError: written for the user and shown verbatim by presentError.
    throw new DisplayableError(
      "This resolution is disputed, so it cannot be settled here. An operator settles a disputed market."
    );
  }

  if (state.phase !== "pending") {
    throw new DisplayableError(
      "This market has already been settled. Refresh to see the updated status."
    );
  }

  onStep?.("finalizing");
  const hash = await wallet.walletClient.writeContract({
    abi: completeSetBinaryMarketAbi,
    account: wallet.accountAddress,
    address: marketAddress,
    chain: wallet.walletClient.chain,
    functionName: "finalizeResolution",
  });

  onStep?.("confirming");
  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const [resolved] = parseEventLogs({
    abi: completeSetBinaryMarketAbi,
    eventName: "MarketResolved",
    logs: transactionReceipt.logs,
  });

  if (!resolved) {
    throw new Error("Transaction succeeded but MarketResolved was not emitted.");
  }

  return {
    transactionHash: hash,
    winningSide: contractSideToMarketSide(resolved.args.side),
  };
}

/**
 * Translates a settlement failure into user-facing copy, mapping the reverts a
 * finalizer can realistically hit — a deadline that had not actually passed,
 * or a market settled by someone else while the page was open — to plain
 * explanations instead of raw selectors.
 *
 * Losing the race is the expected case, not an anomaly: the call is
 * permissionless, so the keeper or any other wallet may land first.
 */
export function getFinalizeErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "resolution-finalize" },
    fallback: "Could not settle this market.",
    matcher: (finalizeError) => {
      if (finalizeError.message.includes("DisputeWindowStillOpen")) {
        return "The dispute window has not closed yet, so this market cannot be settled.";
      }

      // Covers both InvalidStatus (the finalizeResolution() guard) and
      // InvalidStatusForAction (the proposal reads): either way the market
      // left the pending state the button was rendered from — most often
      // because another finalizer got there first.
      if (finalizeError.message.includes("InvalidStatus")) {
        return "This market was settled before your transaction landed. Refresh to see the outcome.";
      }

      return undefined;
    },
  });
}
