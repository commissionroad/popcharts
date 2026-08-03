"use client";

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useReadContract, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

import { getPopChartsContractConfig } from "../config";
import { reviewBondVaultAbi } from "../review-bond-vault";

/** Lifecycle of a bond deposit or withdrawal write. */
export type ReviewBondActionStatus = "error" | "idle" | "pending" | "success";

export type ReviewBondState = {
  /** Unconsumed bond available on-chain, null until read (or no vault). */
  availableWad: bigint | null;
  deposit: (amountWad: bigint) => void;
  /** Lifetime deposits net of withdrawals, null until read. */
  depositedWad: bigint | null;
  /** Whether a vault is configured and a wallet is connected. */
  enabled: boolean;
  error: string | null;
  refresh: () => void;
  status: ReviewBondActionStatus;
  withdraw: (amountWad: bigint) => void;
};

/**
 * The creator's review bond (ADR 0022 P3): on-chain balances plus the
 * deposit/withdraw writes, kept inside the integrations layer so the create
 * flow only sees amounts and actions. Balances re-read after every confirmed
 * write; the server's meter reads the same chain state when it prices a
 * submission, so a confirmed deposit is immediately spendable.
 */
export function useReviewBond(): ReviewBondState {
  const wallet = useWalletAccount();
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const vault = config?.reviewBondVaultAddress ?? null;
  const address = (wallet.address ?? undefined) as `0x${string}` | undefined;
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const { data: walletClient } = useWalletClient({ chainId: config?.chainId });
  const [status, setStatus] = useState<ReviewBondActionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const enabled = Boolean(vault && address);

  const availableRead = useReadContract({
    abi: reviewBondVaultAbi,
    address: vault ?? undefined,
    args: address ? [address] : undefined,
    functionName: "availableBond",
    query: { enabled },
  });
  const depositedRead = useReadContract({
    abi: reviewBondVaultAbi,
    address: vault ?? undefined,
    args: address ? [address] : undefined,
    functionName: "depositedOf",
    query: { enabled },
  });

  const refresh = useCallback(() => {
    void availableRead.refetch();
    void depositedRead.refetch();
  }, [availableRead, depositedRead]);

  const runWrite = useCallback(
    (write: () => Promise<`0x${string}`>) => {
      setError(null);

      if (!vault || !address || !publicClient || !walletClient) {
        setError("Connect a wallet to manage your review bond.");
        setStatus("error");
        return;
      }

      setStatus("pending");

      void (async () => {
        try {
          const hash = await write();

          await publicClient.waitForTransactionReceipt({ hash });
          setStatus("success");
          refresh();
        } catch (caught) {
          setError(
            presentError(caught, {
              context: { operation: "review-bond-write" },
              fallback: "The bond transaction did not go through — try again.",
            })
          );
          setStatus("error");
        }
      })();
    },
    [address, publicClient, refresh, vault, walletClient]
  );

  const deposit = useCallback(
    (amountWad: bigint) => {
      runWrite(() =>
        walletClient!.writeContract({
          abi: reviewBondVaultAbi,
          account: address!,
          address: vault!,
          chain: walletClient!.chain,
          functionName: "depositBond",
          value: amountWad,
        })
      );
    },
    [address, runWrite, vault, walletClient]
  );

  const withdraw = useCallback(
    (amountWad: bigint) => {
      runWrite(() =>
        walletClient!.writeContract({
          abi: reviewBondVaultAbi,
          account: address!,
          address: vault!,
          args: [amountWad],
          chain: walletClient!.chain,
          functionName: "withdrawBond",
        })
      );
    },
    [address, runWrite, vault, walletClient]
  );

  return {
    availableWad: enabled ? (availableRead.data ?? null) : null,
    deposit,
    depositedWad: enabled ? (depositedRead.data ?? null) : null,
    enabled,
    error,
    refresh,
    status,
    withdraw,
  };
}
