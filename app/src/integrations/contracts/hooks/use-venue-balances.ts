import { useEffect, useState } from "react";
import type { PublicClient } from "viem";

import { erc20Abi } from "../erc20";

/**
 * The wallet's balances for trading one graduated market: collateral plus
 * both outcome tokens. `loading` is true while a read for the current inputs
 * is in flight.
 */
export type VenueBalances = {
  collateral: bigint | null;
  error: string | null;
  loading: boolean;
  no: bigint | null;
  yes: bigint | null;
};

type VenueBalancesReadResult = Omit<VenueBalances, "loading"> & {
  requestKey: string | null;
};

/**
 * Reads the wallet's collateral, YES-token, and NO-token balances in one
 * atomic round trip, re-reading whenever an input (or `refreshKey`) changes.
 * Returns a disabled state (`loading: false`, all values null) until the
 * addresses, wallet, and public client are all available. Read failures
 * surface through `formatError`.
 */
export function useVenueBalances({
  collateralAddress,
  formatError,
  noTokenAddress,
  publicClient,
  refreshKey,
  walletAddress,
  yesTokenAddress,
}: {
  collateralAddress: `0x${string}` | null;
  formatError: (error: unknown) => string;
  noTokenAddress: `0x${string}` | null;
  publicClient: PublicClient | undefined;
  refreshKey: number;
  walletAddress: string | null;
  yesTokenAddress: `0x${string}` | null;
}): VenueBalances {
  const [readResult, setReadResult] = useState<VenueBalancesReadResult>({
    collateral: null,
    error: null,
    no: null,
    requestKey: null,
    yes: null,
  });
  const requestKey =
    collateralAddress &&
    yesTokenAddress &&
    noTokenAddress &&
    walletAddress &&
    publicClient
      ? [
          collateralAddress,
          yesTokenAddress,
          noTokenAddress,
          walletAddress,
          refreshKey,
        ].join(":")
      : null;

  useEffect(() => {
    let isActive = true;

    if (
      !requestKey ||
      !collateralAddress ||
      !yesTokenAddress ||
      !noTokenAddress ||
      !walletAddress ||
      !publicClient
    ) {
      return;
    }

    const readBalance = (address: `0x${string}`) =>
      publicClient.readContract({
        abi: erc20Abi,
        address,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      });

    Promise.all([
      readBalance(collateralAddress),
      readBalance(yesTokenAddress),
      readBalance(noTokenAddress),
    ])
      .then(([collateral, yes, no]) => {
        if (!isActive) {
          return;
        }

        setReadResult({ collateral, error: null, no, requestKey, yes });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setReadResult({
          collateral: null,
          error: formatError(error),
          no: null,
          requestKey,
          yes: null,
        });
      });

    return () => {
      isActive = false;
    };
  }, [
    collateralAddress,
    formatError,
    noTokenAddress,
    publicClient,
    requestKey,
    walletAddress,
    yesTokenAddress,
  ]);

  if (requestKey === null) {
    return { collateral: null, error: null, loading: false, no: null, yes: null };
  }

  return readResult.requestKey === requestKey
    ? {
        collateral: readResult.collateral,
        error: readResult.error,
        loading: false,
        no: readResult.no,
        yes: readResult.yes,
      }
    : { collateral: null, error: null, loading: true, no: null, yes: null };
}
