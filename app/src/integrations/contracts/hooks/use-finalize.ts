"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { getPopChartsContractConfig } from "../config";
import {
  finalizeMarketResolution,
  type FinalizeResult,
  type FinalizeStep,
  getFinalizeErrorMessage,
} from "../finalize-service";

/**
 * The settle button's lifecycle: `idle` before a click, `pending` while the
 * transaction is signed and confirmed, `success` once the settlement is
 * confirmed on chain, and `error` when any step fails.
 */
export type FinalizeStatus = "error" | "idle" | "pending" | "success";

/** What a settlement surface consumes: the action plus its lifecycle. */
export type FinalizeState = {
  error: string | null;
  finalize: (marketAddress: `0x${string}`) => void;
  /** Set once a settlement confirms, carrying the side that won. */
  result: FinalizeResult | null;
  status: FinalizeStatus;
  /** Which transaction is in flight, so the button can name it. */
  step: FinalizeStep | null;
};

/**
 * Wires the connected wallet to a postgrad market's `finalizeResolution()`
 * write so anyone can settle a market whose dispute window has closed but
 * which the keeper has not picked up. Keeps every contract concern — ABI, viem
 * clients, chain config — in the integrations layer so the panel only sees the
 * action plus status/step/result/error. `onFinalized` fires once the
 * settlement confirms so the caller can re-read the market's on-chain state.
 */
export function useFinalize({
  onFinalized,
}: { onFinalized?: () => void } = {}): FinalizeState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<FinalizeStatus>("idle");
  const [step, setStep] = useState<FinalizeStep | null>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finalize = useCallback(
    (marketAddress: `0x${string}`) => {
      setError(null);

      // The button only renders once an on-chain proposal is pending and its
      // window has closed, so these guards are defensive; surface them
      // directly rather than through the revert formatter, which collapses to
      // the generic fallback.
      if (!config) {
        setError("Settlement is not available on this network.");
        setStatus("error");
        return;
      }

      if (!wallet.address || !publicClient || !walletClient) {
        setError("Connect a wallet before settling this market.");
        setStatus("error");
        return;
      }

      setStatus("pending");

      void (async () => {
        try {
          const finalized = await finalizeMarketResolution({
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

          setResult(finalized);
          setStatus("success");
          onFinalized?.();
        } catch (finalizeError) {
          setError(getFinalizeErrorMessage(finalizeError));
          setStatus("error");
        } finally {
          setStep(null);
        }
      })();
    },
    [
      config,
      onFinalized,
      publicClient,
      wallet.activeChainId,
      wallet.address,
      walletClient,
    ]
  );

  return { error, finalize, result, status, step };
}
