"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

import { getPopChartsContractConfig } from "../config";
import { reviewBondVaultAbi } from "../review-bond-vault";

/** Lifecycle of a credit deposit write. */
export type ReviewCreditDepositStatus = "error" | "idle" | "pending" | "success";

export type ReviewCreditDepositState = {
  /**
   * Sends `depositFor(beneficiary)` with the given native value and resolves
   * once the transaction confirms. Confirmation is not spendability: the
   * submission gate reads credit from the server's indexed rows, so callers
   * poll the credit endpoint after this succeeds rather than assuming the
   * balance moved.
   */
  deposit: (beneficiary: `0x${string}`, amountWad: bigint) => void;
  /** Whether a vault is configured and a wallet is connected. */
  enabled: boolean;
  error: string | null;
  status: ReviewCreditDepositStatus;
};

/**
 * The chain-write half of prepaid review credit (ADR 0022, prepaid-credit
 * amendment): a deposit crediting an explicit beneficiary. Write-only by
 * design — balances come from the server's indexed view via the drafts API,
 * never from a browser chain read. The beneficiary is always passed by the
 * caller (the draft's intended creator address), never defaulted to the
 * connected wallet: credit is non-refundable and nothing can move it later,
 * so paying from a second wallet must still credit the right account.
 */
export function useReviewCreditDeposit(): ReviewCreditDepositState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const vault = config?.reviewBondVaultAddress ?? null;
  const address = (wallet.address ?? undefined) as `0x${string}` | undefined;
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<ReviewCreditDepositStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const enabled = Boolean(vault && address);

  const deposit = useCallback(
    (beneficiary: `0x${string}`, amountWad: bigint) => {
      setError(null);

      if (!vault || !address || !publicClient || !walletClient) {
        setError("Connect a wallet to deposit review credit.");
        setStatus("error");
        return;
      }

      setStatus("pending");

      void (async () => {
        try {
          const hash = await walletClient.writeContract({
            abi: reviewBondVaultAbi,
            account: address,
            address: vault,
            args: [beneficiary],
            chain: walletClient.chain,
            functionName: "depositFor",
            value: amountWad,
          });

          await publicClient.waitForTransactionReceipt({ hash });
          setStatus("success");
        } catch (caught) {
          setError(
            presentError(caught, {
              context: { operation: "review-credit-deposit" },
              fallback: "The deposit did not go through — try again.",
            })
          );
          setStatus("error");
        }
      })();
    },
    [address, publicClient, vault, walletClient]
  );

  return { deposit, enabled, error, status };
}
