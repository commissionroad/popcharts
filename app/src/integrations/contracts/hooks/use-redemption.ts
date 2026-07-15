"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useWalletClient } from "wagmi";

import type { MarketSide } from "@/domain/markets/types";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { getPopChartsContractConfig, type PopChartsContractConfig } from "../config";
import {
  getRedemptionErrorMessage,
  type RedemptionResult,
  type RedemptionWallet,
  submitDrawRedemption,
  submitRedemption,
} from "../redemption-service";

/**
 * The claim-winnings button's lifecycle: `idle` before a click, `pending`
 * while the transaction is signed and confirmed, `success` once the on-chain
 * redemption is confirmed, and `error` when the write fails.
 */
export type RedemptionStatus = "error" | "idle" | "pending" | "success";

/** One winning-side claim on a resolved market. */
export type RedemptionRequest = {
  /** Outcome tokens (WAD) to redeem; rounded down to collateral precision. */
  amount: bigint;
  /** The resolved postgrad market that pays the redemption. */
  marketAddress: `0x${string}`;
  /** Side being redeemed — must be the market's winning side. */
  side: MarketSide;
};

/** One half-value claim on a cancelled (draw) market; either leg may be 0. */
export type DrawRedemptionRequest = {
  /** The cancelled postgrad market that pays the redemption. */
  marketAddress: `0x${string}`;
  /** NO tokens (WAD) to redeem; rounded down to collateral precision. */
  noAmount: bigint;
  /** YES tokens (WAD) to redeem; rounded down to collateral precision. */
  yesAmount: bigint;
};

/** What a claim surface consumes: two claim actions plus shared lifecycle. */
export type RedemptionState = {
  error: string | null;
  redeem: (request: RedemptionRequest) => void;
  redeemDraw: (request: DrawRedemptionRequest) => void;
  /** Set once a redemption confirms, so the caller can show the payout. */
  result: RedemptionResult | null;
  status: RedemptionStatus;
};

/**
 * Wires the connected wallet to the postgrad market's redemption writes so a
 * holder can claim outcome tokens for collateral from the market or portfolio
 * page: `redeem` exchanges winning-side tokens 1:1 on a resolved market and
 * `redeemDraw` exchanges either side at half value on a cancelled one. Keeps
 * every contract concern — ABI, viem clients, chain config — inside the
 * integrations layer so the consuming surface only sees the actions plus
 * status/result/error. `onRedeemed` fires once a claim confirms so the caller
 * can refresh the indexed portfolio and let the position drop to zero.
 */
export function useRedemption({
  onRedeemed,
}: { onRedeemed?: () => void } = {}): RedemptionState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<RedemptionStatus>("idle");
  const [result, setResult] = useState<RedemptionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    (
      submit: (
        submitConfig: PopChartsContractConfig,
        walletContext: RedemptionWallet
      ) => Promise<RedemptionResult>
    ) => {
      setError(null);

      // The buttons only render once a redeemable position exists, so these
      // guards are defensive; surface them directly rather than through the
      // revert formatter, which collapses to the generic fallback.
      if (!config) {
        setError("Claims are not available on this network.");
        setStatus("error");
        return;
      }

      if (!wallet.address || !publicClient || !walletClient) {
        setError("Connect a wallet before claiming your winnings.");
        setStatus("error");
        return;
      }

      const walletContext = {
        accountAddress: wallet.address as `0x${string}`,
        activeChainId: wallet.activeChainId,
        publicClient,
        walletClient,
      } satisfies RedemptionWallet;

      setStatus("pending");

      void (async () => {
        try {
          const redemption = await submit(config, walletContext);

          setResult(redemption);
          setStatus("success");
          onRedeemed?.();
        } catch (redemptionError) {
          setError(getRedemptionErrorMessage(redemptionError));
          setStatus("error");
        }
      })();
    },
    [
      config,
      onRedeemed,
      publicClient,
      wallet.activeChainId,
      wallet.address,
      walletClient,
    ]
  );

  const redeem = useCallback(
    (request: RedemptionRequest) =>
      run((submitConfig, walletContext) =>
        submitRedemption({
          amount: request.amount,
          config: submitConfig,
          marketAddress: request.marketAddress,
          side: request.side,
          wallet: walletContext,
        })
      ),
    [run]
  );

  const redeemDraw = useCallback(
    (request: DrawRedemptionRequest) =>
      run((submitConfig, walletContext) =>
        submitDrawRedemption({
          config: submitConfig,
          marketAddress: request.marketAddress,
          noAmount: request.noAmount,
          wallet: walletContext,
          yesAmount: request.yesAmount,
        })
      ),
    [run]
  );

  return { error, redeem, redeemDraw, result, status };
}
