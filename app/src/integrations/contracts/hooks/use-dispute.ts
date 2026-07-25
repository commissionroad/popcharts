"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { getPopChartsContractConfig } from "../config";
import {
  type DisputeResult,
  type DisputeStep,
  disputeResolution,
  getDisputeErrorMessage,
} from "../dispute-service";

/**
 * The dispute button's lifecycle: `idle` before a click, `pending` while the
 * bond approval and dispute are signed and confirmed, `success` once the
 * on-chain dispute is confirmed, and `error` when any step fails.
 */
export type DisputeStatus = "error" | "idle" | "pending" | "success";

/** What a dispute surface consumes: the action plus its lifecycle. */
export type DisputeState = {
  dispute: (marketAddress: `0x${string}`) => void;
  error: string | null;
  /** Set once a dispute confirms, carrying the bond the market escrowed. */
  result: DisputeResult | null;
  status: DisputeStatus;
  /** Which transaction is in flight, so the button can name it. */
  step: DisputeStep | null;
};

/**
 * Wires the connected wallet to a postgrad market's `dispute()` write so a
 * holder can challenge a proposed resolution from the market page. Keeps every
 * contract concern — ABI, viem clients, chain config, the bond approval — in
 * the integrations layer so the panel only sees the action plus
 * status/step/result/error. `onDisputed` fires once the dispute confirms so the
 * caller can re-read the market's on-chain state.
 */
export function useDispute({
  onDisputed,
}: { onDisputed?: () => void } = {}): DisputeState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<DisputeStatus>("idle");
  const [step, setStep] = useState<DisputeStep | null>(null);
  const [result, setResult] = useState<DisputeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispute = useCallback(
    (marketAddress: `0x${string}`) => {
      setError(null);

      // The button only renders once an on-chain proposal is pending, so these
      // guards are defensive; surface them directly rather than through the
      // revert formatter, which collapses to the generic fallback.
      if (!config) {
        setError("Disputes are not available on this network.");
        setStatus("error");
        return;
      }

      if (!wallet.address || !publicClient || !walletClient) {
        setError("Connect a wallet before disputing this resolution.");
        setStatus("error");
        return;
      }

      setStatus("pending");

      void (async () => {
        try {
          const disputed = await disputeResolution({
            config,
            marketAddress,
            onStep: setStep,
            wallet: {
              accountAddress: wallet.address as `0x${string}`,
              activeChainId: wallet.activeChainId,
              publicClient,
              walletClient,
            },
          });

          setResult(disputed);
          setStatus("success");
          onDisputed?.();
        } catch (disputeError) {
          setError(getDisputeErrorMessage(disputeError));
          setStatus("error");
        } finally {
          setStep(null);
        }
      })();
    },
    [
      config,
      onDisputed,
      publicClient,
      wallet.activeChainId,
      wallet.address,
      walletClient,
    ]
  );

  return { dispute, error, result, status, step };
}
