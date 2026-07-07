import { useEffect, useState } from "react";
import type { PublicClient } from "viem";

import type { PopChartsContractConfig } from "../config";
import { erc20Abi } from "../erc20";
import { pregradManagerAbi } from "../pregrad-manager";

/**
 * On-chain status for trading one contract market: the wallet's collateral
 * balance and whether the market exists on the configured PregradManager.
 * `loading` is true while a read for the current inputs is in flight.
 */
export type ContractMarketStatus = {
  balance: bigint | null;
  error: string | null;
  loading: boolean;
  marketExists: boolean | null;
};

type ContractMarketReadResult = Omit<ContractMarketStatus, "loading"> & {
  requestKey: string | null;
};

/**
 * Reads the wallet's collateral balance and the market-existence flag for a
 * contract market in one atomic round trip, re-reading whenever an input (or
 * `refreshKey`) changes. Returns a disabled status (`loading: false`, all
 * values null) until a config, market id, wallet address, and public client
 * are all available. Read failures surface through `formatError`.
 */
export function useContractMarketStatus({
  config,
  formatError,
  marketId,
  publicClient,
  refreshKey,
  walletAddress,
}: {
  config: PopChartsContractConfig | null;
  formatError: (error: unknown) => string;
  marketId: bigint | null;
  publicClient: PublicClient | undefined;
  refreshKey: number;
  walletAddress: string | null;
}): ContractMarketStatus {
  const [readResult, setReadResult] = useState<ContractMarketReadResult>({
    balance: null,
    error: null,
    marketExists: null,
    requestKey: null,
  });
  const requestKey =
    config && marketId !== null && walletAddress && publicClient
      ? [
          config.chainId,
          config.collateralAddress,
          config.pregradManagerAddress,
          marketId.toString(),
          walletAddress,
          refreshKey,
        ].join(":")
      : null;

  useEffect(() => {
    let isActive = true;

    if (
      !requestKey ||
      !config ||
      marketId === null ||
      !walletAddress ||
      !publicClient
    ) {
      return;
    }

    Promise.all([
      publicClient.readContract({
        abi: erc20Abi,
        address: config.collateralAddress,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      }),
      publicClient.readContract({
        abi: pregradManagerAbi,
        address: config.pregradManagerAddress,
        functionName: "marketExists",
        args: [marketId],
      }),
    ])
      .then(([balance, marketExists]) => {
        if (!isActive) {
          return;
        }

        setReadResult({
          balance,
          error: null,
          marketExists,
          requestKey,
        });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setReadResult({
          balance: null,
          error: formatError(error),
          marketExists: null,
          requestKey,
        });
      });

    return () => {
      isActive = false;
    };
  }, [config, formatError, marketId, publicClient, requestKey, walletAddress]);

  if (requestKey === null) {
    return {
      balance: null,
      error: null,
      loading: false,
      marketExists: null,
    };
  }

  return readResult.requestKey === requestKey
    ? {
        balance: readResult.balance,
        error: readResult.error,
        loading: false,
        marketExists: readResult.marketExists,
      }
    : {
        balance: null,
        error: null,
        loading: true,
        marketExists: null,
      };
}
