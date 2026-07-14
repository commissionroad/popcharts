"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { getPopChartsContractConfig } from "../config";
import {
  getRefundClaimErrorMessage,
  type RefundClaimWallet,
  submitRefundClaim,
} from "../refund-claim-service";

/**
 * The refund-claim button's lifecycle: `idle` before a click, `pending` while
 * the transaction is signed and confirmed, `success` once the on-chain claim
 * is confirmed (the button stays out of action until the indexer projects the
 * `refunded` row), and `error` when the write fails.
 */
export type RefundClaimStatus = "error" | "idle" | "pending" | "success";

export type RefundClaimState = {
  claim: (receiptId: string) => void;
  error: string | null;
  status: RefundClaimStatus;
};

/**
 * Wires the connected wallet to the `claimRefundedReceipt` write so a bettor
 * can pull their own full refund from the market page. Keeps every contract
 * concern — ABI, viem clients, chain config — inside the integrations layer so
 * the consuming row only sees a `claim(receiptId)` action plus status/error.
 * `onClaimed` fires once the claim confirms so the caller can refresh the
 * indexed portfolio and let the row flip to `refunded`.
 */
export function useRefundClaim({
  onClaimed,
}: { onClaimed?: () => void } = {}): RefundClaimState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<RefundClaimStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(
    (receiptId: string) => {
      setError(null);

      // The button only renders once the receipt is refund-claimable, so these
      // guards are defensive; surface them directly rather than through the
      // revert formatter, which collapses to the generic fallback.
      if (!config) {
        setError("Refund claims are not available on this network.");
        setStatus("error");
        return;
      }

      if (!wallet.address || !publicClient || !walletClient) {
        setError("Connect a wallet before claiming your refund.");
        setStatus("error");
        return;
      }

      const walletContext = {
        accountAddress: wallet.address as `0x${string}`,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      } satisfies RefundClaimWallet;

      setStatus("pending");

      void (async () => {
        try {
          await submitRefundClaim({
            config,
            receiptId: BigInt(receiptId),
            wallet: walletContext,
          });

          setStatus("success");
          onClaimed?.();
        } catch (claimError) {
          setError(getRefundClaimErrorMessage(claimError));
          setStatus("error");
        }
      })();
    },
    [
      config,
      onClaimed,
      publicClient,
      wallet.activeChainId,
      wallet.address,
      walletClient,
    ]
  );

  return { claim, error, status };
}
