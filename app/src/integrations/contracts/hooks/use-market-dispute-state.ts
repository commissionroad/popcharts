"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";

import { presentError } from "@/lib/error-handling";

import { getPopChartsContractConfig } from "../config";
import {
  type MarketDisputeSnapshot,
  readMarketDisputeState,
} from "../market-dispute-state";

/**
 * A postgrad market's on-chain dispute state for one render: the snapshot once
 * it arrives, `loading` while a read for the current inputs is in flight, and
 * `error` when the read fails. `snapshot` stays null until a market address,
 * contract config, and public client are all available — a market with no
 * postgrad contract simply has no dispute state to show.
 */
export type MarketDisputeState = {
  error: string | null;
  loading: boolean;
  snapshot: MarketDisputeSnapshot | null;
};

type DisputeReadResult = Omit<MarketDisputeState, "loading"> & {
  requestKey: string | null;
};

const IDLE = { error: null, snapshot: null } as const;

/**
 * Reads the dispute window state of a graduated market's postgrad contract,
 * re-reading whenever the market or `refreshKey` changes. Deliberately reads
 * the chain rather than the indexed market status: the dispute states are not
 * projected into the database yet, and the bond and deadline a user acts on
 * must come from the contract that enforces them.
 */
export function useMarketDisputeState({
  marketAddress,
  refreshKey = 0,
}: {
  marketAddress: `0x${string}` | null;
  refreshKey?: number;
}): MarketDisputeState {
  const config = useMemo(() => getPopChartsContractConfig(), []);
  const publicClient = usePublicClient({ chainId: config?.chainId });
  const [readResult, setReadResult] = useState<DisputeReadResult>({
    ...IDLE,
    requestKey: null,
  });
  const requestKey =
    config && marketAddress && publicClient
      ? [config.chainId, marketAddress, refreshKey].join(":")
      : null;

  useEffect(() => {
    let isActive = true;

    if (!requestKey || !marketAddress || !publicClient) {
      return;
    }

    readMarketDisputeState({ marketAddress, publicClient })
      .then((snapshot) => {
        if (isActive) {
          setReadResult({ error: null, requestKey, snapshot });
        }
      })
      .catch((error: unknown) => {
        if (isActive) {
          setReadResult({
            error: presentError(error, {
              context: { operation: "market-dispute-state" },
              fallback: "Could not read this market's resolution status.",
            }),
            requestKey,
            snapshot: null,
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, [marketAddress, publicClient, requestKey]);

  if (requestKey === null) {
    return { ...IDLE, loading: false };
  }

  return readResult.requestKey === requestKey
    ? { error: readResult.error, loading: false, snapshot: readResult.snapshot }
    : { ...IDLE, loading: true };
}
