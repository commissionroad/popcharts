"use client";

import type { MarketDraftReviewCredit } from "@popcharts/api-client/models";
import { portfolioChannel } from "@popcharts/live-channels";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useLiveChannel } from "@/integrations/live-updates/use-live-channel";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { createDraftsApiClient } from "./drafts-api";

/**
 * The connected wallet's prepaid review-credit position (ADR 0022), read from
 * the same indexed view the submission gate decides on — so what a surface
 * renders is what the gate will do.
 *
 * Deposits announce themselves: the indexer signals `portfolio:{beneficiary}`
 * in the same transaction as the deposit row, so a live connection re-reads
 * the moment a top-up lands. Review *charges* are metered off-chain and
 * signal nothing, so a caller that spends a run (submitting a draft) must
 * call `refresh` itself — hence the exposed handle rather than a poll that
 * would be wrong most of the time and late the rest.
 *
 * `credit` stays null until the first successful read and on any failure: an
 * unread position must not render as an empty one.
 */
export function useReviewCreditPosition(): {
  credit: MarketDraftReviewCredit | null;
  refresh: () => void;
} {
  const wallet = useWalletAccount();
  const address = wallet.address?.toLowerCase() ?? null;
  const getDraftAuthHeaders = wallet.getDraftAuthHeaders;
  // The read is stamped with the wallet it belongs to, so switching or
  // disconnecting drops the previous account's position by derivation rather
  // than by clearing it from inside an effect.
  const [read, setRead] = useState<{
    address: string | null;
    credit: MarketDraftReviewCredit | null;
  }>({ address: null, credit: null });
  const [readTick, setReadTick] = useState(0);
  const refresh = useCallback(() => setReadTick((value) => value + 1), []);

  const client = useMemo(
    () => (address ? createDraftsApiClient({ getAuthHeaders: getDraftAuthHeaders }) : null),
    [address, getDraftAuthHeaders]
  );

  useLiveChannel(address ? portfolioChannel(address) : null, refresh);

  useEffect(() => {
    if (!client || !address) {
      return;
    }

    let isActive = true;

    void (async () => {
      let position: MarketDraftReviewCredit | null = null;

      try {
        position = await client.credit(address);
      } catch {
        // A failed read is "unknown", not "empty" — the surfaces render
        // nothing rather than a zero they cannot stand behind. The gate still
        // reports a shortfall on submit, so nothing is silently lost.
        position = null;
      }

      // One guard for both outcomes: a read that lands after the wallet
      // changed or the surface unmounted is stale either way.
      if (isActive) {
        setRead({ address, credit: position });
      }
    })();

    return () => {
      isActive = false;
    };
  }, [address, client, readTick]);

  return {
    credit: read.address === address ? read.credit : null,
    refresh,
  };
}
