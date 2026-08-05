"use client";

import type { MarketDraft } from "@popcharts/api-client/models";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createDraftsApiClient,
  type DraftsApiClient,
} from "@/integrations/indexer/drafts-api";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

/** The studio's shelf tabs; `all` folds every non-template state together. */
export const STUDIO_SHELVES = [
  "all",
  "in_review",
  "needs_fixes",
  "approved",
  "published",
  "templates",
] as const;

/** One of {@link STUDIO_SHELVES}. */
export type StudioShelf = (typeof STUDIO_SHELVES)[number];

/** True when the draft belongs on the given shelf. */
export function draftBelongsOnShelf(draft: MarketDraft, shelf: StudioShelf): boolean {
  if (shelf === "templates") {
    return draft.isTemplate;
  }

  if (draft.isTemplate) {
    return shelf === "all";
  }

  switch (shelf) {
    case "all":
      return true;
    case "in_review":
      return draft.status === "in_review";
    case "needs_fixes":
      return draft.status === "changes_requested" || draft.status === "rejected";
    case "approved":
      return draft.status === "approved";
    default:
      return draft.status === "published";
  }
}

/**
 * The creator studio's data + actions: the owner's drafts, shelf filtering,
 * and the clone / template / delete operations, all scoped to the connected
 * wallet identity. Everything refreshes through one `refresh` so the list
 * never drifts from the server after a mutation.
 */
export function useStudio() {
  const wallet = useWalletAccount();
  // Drafts are scoped to the wallet identity's user id (Privy DID in
  // production, wallet address on the local stack).
  const owner = wallet.ownerUserId;
  const getDraftAuthHeaders = wallet.getDraftAuthHeaders;
  const client = useMemo<DraftsApiClient | null>(
    () =>
      owner ? createDraftsApiClient({ getAuthHeaders: getDraftAuthHeaders }) : null,
    [getDraftAuthHeaders, owner]
  );
  const [drafts, setDrafts] = useState<MarketDraft[]>([]);
  const [shelf, setShelf] = useState<StudioShelf>("all");
  const [error, setError] = useState<string | null>(null);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Loading is derived from the request key, never set synchronously: the
  // list is "loading" until the fetch for the current (owner, tick) lands.
  const requestKey = client ? `${owner}:${refreshTick}` : null;
  const isLoading = requestKey !== null && loadedKey !== requestKey;

  useEffect(() => {
    if (!client || !requestKey || loadedKey === requestKey) {
      return;
    }

    let cancelled = false;

    void client
      .list()
      .then((list) => {
        if (!cancelled) {
          setDrafts(list);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(describeError(caught, "list-drafts"));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadedKey(requestKey);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [client, loadedKey, requestKey]);

  const refresh = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const visibleDrafts = useMemo(
    () => drafts.filter((draft) => draftBelongsOnShelf(draft, shelf)),
    [drafts, shelf]
  );

  async function mutate(
    draftId: string,
    operation: string,
    action: (api: DraftsApiClient) => Promise<unknown>
  ) {
    if (!client) {
      return;
    }

    setBusyDraftId(draftId);
    setError(null);

    try {
      await action(client);
      setDrafts(await client.list());
    } catch (caught) {
      setError(describeError(caught, operation));
    } finally {
      setBusyDraftId(null);
    }
  }

  return {
    busyDraftId,
    canPersist: Boolean(client),
    cloneDraft: (draftId: string, asTemplate = false) =>
      mutate(draftId, "clone-draft", (api) =>
        api.clone({ asTemplate, fromDraftId: draftId })
      ),
    cloneFromMarket: async (chainId: number, marketId: string) => {
      if (!client) {
        return false;
      }

      setError(null);

      try {
        await client.clone({ fromMarket: { chainId, marketId } });
        setDrafts(await client.list());
        return true;
      } catch (caught) {
        setError(describeError(caught, "clone-market"));
        return false;
      }
    },
    drafts,
    error,
    isLoading,
    refresh,
    removeDraft: (draftId: string) =>
      mutate(draftId, "delete-draft", (api) => api.remove(draftId)),
    setShelf,
    shelf,
    toggleTemplate: (draft: MarketDraft) =>
      mutate(draft.id, "toggle-template", (api) =>
        api.update(draft.id, { isTemplate: !draft.isTemplate })
      ),
    visibleDrafts,
    walletReady: wallet.ready,
  };
}

function describeError(error: unknown, operation: string): string {
  // DraftsApiError is a DisplayableError, so the draft API's own copy passes
  // through; anything else logs and falls back to curated copy.
  return presentError(error, {
    context: { operation: `studio/${operation}` },
    fallback: "The draft service hit a snag — try again.",
  });
}
