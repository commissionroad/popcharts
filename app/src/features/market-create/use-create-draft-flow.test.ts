import type {
  MarketDraft,
  MarketDraftPublishParams,
  MarketDraftWrite,
} from "@popcharts/api-client/models";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import {
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import { dispatchGeneratedMarketFill } from "@/features/dev-settings/generated-market-events";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import {
  createDraftsApiClient,
  type DraftsApiClient,
  DraftsApiError,
} from "@/integrations/indexer/drafts-api";
import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import {
  draftFeedbackItemFactory,
  draftReviewFactory,
  marketDraftFactory,
} from "@/test/factories/drafts";

import { persistPublishedMetadata, publishDraftMarket } from "./draft-publish-service";
import { focusFirstReviewError } from "./review-errors";
import { useCreateDraftFlow } from "./use-create-draft-flow";
import type { WalletCreateAction } from "./wallet-create-action";
import { getWalletCreateAction } from "./wallet-create-action";

const configState = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: () => configState.config,
}));

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(),
  useWalletClient: vi.fn(),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/integrations/indexer/drafts-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/indexer/drafts-api")>()),
  createDraftsApiClient: vi.fn(),
}));

vi.mock("./draft-publish-service", () => ({
  persistPublishedMetadata: vi.fn(),
  publishDraftMarket: vi.fn(),
}));

vi.mock("./review-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./review-errors")>()),
  focusFirstReviewError: vi.fn(),
}));

vi.mock("./wallet-create-action", () => ({
  getWalletCreateAction: vi.fn(),
}));

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PUBLISH_HASH = `0x${"cc".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewBondVaultAddress: "0x0000000000000000000000000000000000000042",
  rpcUrl: "http://127.0.0.1:8545",
};

const publicClientStub = { kind: "public-client" };
const walletClientStub = { kind: "wallet-client" };

let timers: ReturnType<typeof interceptWindowTimers>;

beforeEach(() => {
  timers = interceptWindowTimers();
  configState.config = contractConfig;
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(usePublicClient).mockReturnValue(publicClientStub as never);
  vi.mocked(useWalletClient).mockReturnValue({ data: walletClientStub } as never);
  vi.mocked(getWalletCreateAction).mockReturnValue(readyWalletAction());
  vi.mocked(publishDraftMarket).mockResolvedValue({
    chainId: 31337,
    creator: ADDRESS as `0x${string}`,
    marketId: "9",
    transactionHash: PUBLISH_HASH,
  });
  vi.mocked(persistPublishedMetadata).mockResolvedValue(undefined);
  stubApi();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  configState.config = null;
});

describe("useCreateDraftFlow without a wallet", () => {
  it("edits locally and refuses persistence actions", async () => {
    // No wallet and no devchain config: the flow still edits locally.
    configState.config = null;
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));
    const api = stubApi();

    const { result } = renderFlow();

    expect(result.current.canPersist).toBe(false);
    expect(result.current.stage).toBe("editing");
    expect(result.current.isLoadingDraft).toBe(false);
    expect(result.current.savedAt).toBeNull();
    expect(result.current.visibleErrors).toEqual({});
    expect(result.current.errorCount).toBe(0);

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.flowError).toBe(
      "Connect a wallet to submit drafts for review."
    );

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.flowError).toBe("Connect a wallet to publish.");

    await act(async () => {
      await result.current.saveAsTemplate();
    });

    expect(api.clone).not.toHaveBeenCalled();
    expect(result.current.templateSaved).toBe(false);
  });
});

describe("useCreateDraftFlow autosave", () => {
  it("never creates a server draft for an untouched form", async () => {
    const api = stubApi();
    renderFlow();

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
    expect(api.create).not.toHaveBeenCalled();
  });

  it("creates the server draft on the first meaningful debounced save", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));

    await act(async () => {
      timers.flushAutosaves();
    });

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        intendedCreatorAddress: ADDRESS,
        question: "Will it autosave?",
      })
    );
    expect(result.current.savedAt).toBe(result.current.serverDraft?.updatedAt);
    expect(result.current.isSaving).toBe(false);

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
  });

  it("updates the existing draft when a field changes, without drifted windows", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });
    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    act(() => result.current.updateDraft("question", "Will it autosave twice?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });

    await waitFor(() =>
      expect(result.current.serverDraft?.question).toBe("Will it autosave twice?")
    );
    expect(api.update).toHaveBeenCalledTimes(1);
    const [draftId, write] = api.update.mock.calls[0] as [number, MarketDraftWrite];
    expect(draftId).toBe(21);
    expect(write.question).toBe("Will it autosave twice?");
    expect(write).not.toHaveProperty("graduationWindowSeconds");
    expect(write).not.toHaveProperty("resolutionWindowSeconds");
  });

  it("drops a stale autosave response that lands after a newer one", async () => {
    let releaseStale: () => void = () => undefined;
    const api = stubApi();

    vi.mocked(api.update)
      .mockImplementationOnce(
        (draftId: number, body: MarketDraftWrite) =>
          new Promise<MarketDraft>((resolve) => {
            releaseStale = () => resolve(savedDraft(draftId, body));
          })
      )
      .mockImplementationOnce(async (draftId: number, body: MarketDraftWrite) =>
        savedDraft(draftId, body)
      );

    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "First"));
    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });
    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    // The second save hangs (slow network); a third, newer save lands first.
    act(() => result.current.updateDraft("question", "Second"));
    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });

    act(() => result.current.updateDraft("question", "Third"));
    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });
    await waitFor(() => expect(result.current.serverDraft?.question).toBe("Third"));

    // The slow save finally resolves with the older content — dropped.
    await act(async () => {
      releaseStale();
    });

    expect(result.current.serverDraft?.question).toBe("Third");
    expect(result.current.isSaving).toBe(false);
  });

  it("skips the save when nothing changed", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });
    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
    expect(api.update).not.toHaveBeenCalled();
  });

  it("surfaces the draft service's save error", async () => {
    stubApi({
      create: vi.fn(async () => {
        throw new DraftsApiError("Draft limit reached.", 429);
      }),
    });
    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });

    await waitFor(() => expect(result.current.flowError).toBe("Draft limit reached."));
    expect(result.current.isSaving).toBe(false);
    expect(result.current.serverDraft).toBeNull();
  });

  it("falls back to generic copy for unrecognized save failures", async () => {
    stubApi({
      create: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });
    const { result } = renderFlow();

    act(() => result.current.updateDraft("question", "Will it autosave?"));

    await waitFor(() => expect(timers.pendingAutosaves()).toBe(1));
    await act(async () => {
      timers.flushAutosaves();
    });

    await waitFor(() =>
      expect(result.current.flowError).toBe("The draft service hit a snag — try again.")
    );
  });
});

describe("useCreateDraftFlow loading", () => {
  it("exposes a credit fetcher bound to the draft's intended creator", async () => {
    const credit = vi.fn(async () => ({
      availableWad: "0",
      metered: true,
      rateWad: "100000000000000000",
      runsRemaining: 0,
      runsUsed: 0,
    }));
    stubApi({ credit });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.isLoadingDraft).toBe(false));

    expect(result.current.fetchCredit).not.toBeNull();
    await result.current.fetchCredit!();
    expect(credit).toHaveBeenCalledWith("0x90f79bf6eb2c4f870365e785982e1f101e93b906");
  });

  it("loads an existing draft into the form", async () => {
    const api = stubApi({
      get: vi.fn(async () =>
        marketDraftFactory({ id: 12, question: "Loaded question?" })
      ),
    });
    const { result } = renderFlow(12);

    expect(result.current.isLoadingDraft).toBe(true);

    await waitFor(() => expect(result.current.isLoadingDraft).toBe(false));
    expect(api.get).toHaveBeenCalledWith(12);
    expect(result.current.serverDraft?.id).toBe(12);
    expect(result.current.formDraft.question).toBe("Loaded question?");
    expect(result.current.formDraft.graduationPreset).toBe("6h");
    expect(result.current.savedAt).toBe("2026-07-30T12:00:00.000Z");

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
  });

  it("starts fresh when the draft cannot be found", async () => {
    stubApi({ get: vi.fn(async () => null) });
    const { result } = renderFlow(99);

    await waitFor(() => expect(result.current.isLoadingDraft).toBe(false));
    expect(result.current.flowError).toBe(
      "That draft could not be found — starting fresh."
    );
    expect(result.current.serverDraft).toBeNull();
  });

  it("surfaces a failed draft load", async () => {
    stubApi({
      get: vi.fn(async () => {
        throw new DraftsApiError("Sign in to manage drafts.", 401);
      }),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.isLoadingDraft).toBe(false));
    expect(result.current.flowError).toBe("Sign in to manage drafts.");
  });

  it("ignores a load that lands after the flow unmounts", async () => {
    let releaseGet: (draft: MarketDraft) => void = () => {};
    const api = stubApi({
      get: vi.fn(
        () =>
          new Promise<MarketDraft>((resolve) => {
            releaseGet = resolve;
          })
      ),
    });
    const { result, unmount } = renderFlow(12);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(12));

    unmount();
    releaseGet(marketDraftFactory({ id: 12 }));

    await flushMacrotask();

    expect(result.current.serverDraft).toBeNull();
  });

  it("ignores a load failure that lands after the flow unmounts", async () => {
    let rejectGet: (error: unknown) => void = () => {};
    const api = stubApi({
      get: vi.fn(
        () =>
          new Promise<MarketDraft>((_resolve, reject) => {
            rejectGet = reject;
          })
      ),
    });
    const { result, unmount } = renderFlow(12);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(12));

    unmount();
    rejectGet(new DraftsApiError("Sign in to manage drafts.", 401));

    await flushMacrotask();

    expect(result.current.flowError).toBeNull();
  });
});

describe("useCreateDraftFlow review submission", () => {
  it("blocks submission while the draft is invalid and focuses the first error", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(focusFirstReviewError).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Add a market question." })
    );
    expect(api.create).not.toHaveBeenCalled();
    expect(api.submit).not.toHaveBeenCalled();
    expect(result.current.visibleErrors.question).toBe("Add a market question.");
    expect(result.current.errorCount).toBeGreaterThan(0);
    expect(result.current.stage).toBe("editing");
  });

  it("flushes the form and locks the draft into review", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        intendedCreatorAddress: ADDRESS,
        question: "Will the flow submit?",
      })
    );
    expect(api.submit).toHaveBeenCalledWith(21);
    expect(result.current.stage).toBe("in_review");
    expect(result.current.formLocked).toBe(true);
    expect(result.current.isSubmitting).toBe(false);

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);

    // The locked draft never autosaves further edits.
    act(() => result.current.updateDraft("question", "Changed while locked?"));

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
  });

  it("updates the existing server draft before submitting", async () => {
    const api = stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12 })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.isLoadingDraft).toBe(false));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        question: "Will bitcoin close above $100k on 2027-01-01?",
      })
    );
    expect(api.submit).toHaveBeenCalledWith(12);
  });

  it("surfaces submission failures", async () => {
    stubApi({
      submit: vi.fn(async () => {
        throw new DraftsApiError("Draft was edited during submission.", 409);
      }),
    });
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.flowError).toBe("Draft was edited during submission.");
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.stage).toBe("editing");
  });

  it("polls the review until the verdict lands", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.stage).toBe("in_review");

    // A transient poll failure retries on the next tick.
    api.get.mockRejectedValueOnce(new Error("poll down"));
    await act(async () => {
      timers.tickPoll();
    });
    expect(result.current.stage).toBe("in_review");

    // A missing draft leaves the current state untouched.
    api.get.mockResolvedValueOnce(null);
    await act(async () => {
      timers.tickPoll();
    });
    expect(result.current.stage).toBe("in_review");

    api.get.mockResolvedValueOnce(marketDraftFactory({ id: 21, status: "approved" }));
    await act(async () => {
      timers.tickPoll();
    });

    await waitFor(() => expect(result.current.stage).toBe("approved"));
    expect(result.current.formLocked).toBe(false);
  });
});

describe("useCreateDraftFlow bond shortfall", () => {
  it("prompts to fund the bond instead of raising a flow error", async () => {
    const api = stubApi();

    api.submit.mockRejectedValueOnce(meterRefusal());
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.bondShortfall).toEqual(meterRefusal().bondShortfall);
    expect(result.current.flowError).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.stage).toBe("editing");
  });

  it("clears the shortfall prompt on dismiss", async () => {
    const api = stubApi();

    api.submit.mockRejectedValueOnce(meterRefusal());
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    act(() => result.current.clearBondShortfall());

    expect(result.current.bondShortfall).toBeNull();
    expect(result.current.flowError).toBeNull();
  });

  it("clears the shortfall once a resubmission goes through", async () => {
    const api = stubApi();

    api.submit.mockRejectedValueOnce(meterRefusal());
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.bondShortfall).not.toBeNull();

    await act(async () => {
      await result.current.submitForReview();
    });

    expect(result.current.bondShortfall).toBeNull();
    expect(result.current.stage).toBe("in_review");
  });

  it("clears the shortfall when starting fresh", async () => {
    const api = stubApi();

    api.submit.mockRejectedValueOnce(meterRefusal());
    const { result } = renderFlow();

    act(() => fillValidDraft(result));

    await act(async () => {
      await result.current.submitForReview();
    });

    act(() => result.current.startFresh());

    expect(result.current.bondShortfall).toBeNull();
  });
});

describe("useCreateDraftFlow publish", () => {
  it("publishes an approved draft with the server-minted params", async () => {
    const api = stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "approved" })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("approved"));

    await act(async () => {
      await result.current.publish();
    });

    expect(api.publishParams).toHaveBeenCalledWith(12);
    expect(publishDraftMarket).toHaveBeenCalledWith({
      params: publishParamsFixture(),
      wallet: {
        accountAddress: ADDRESS,
        activeChainId: 31337,
        publicClient: publicClientStub,
        walletClient: walletClientStub,
      },
    });
    expect(persistPublishedMetadata).toHaveBeenCalledWith({
      chainId: 31337,
      metadataHash: publishParamsFixture().metadataHash,
      metadataPayload: publishParamsFixture().metadata,
    });
    expect(api.markPublished).toHaveBeenCalledWith(12, {
      chainId: 31337,
      marketId: "9",
      transactionHash: PUBLISH_HASH,
    });
    expect(result.current.publishedMarket?.marketId).toBe("9");
    expect(result.current.stage).toBe("published");
    expect(result.current.isPublishing).toBe(false);
  });

  it("runs the blocking wallet step instead of publishing", async () => {
    const run = vi.fn();
    vi.mocked(getWalletCreateAction).mockReturnValue(connectWalletAction(run));
    const api = stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "approved" })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("approved"));

    await act(async () => {
      await result.current.publish();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(api.publishParams).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });

  it("requires connected clients before signing", async () => {
    vi.mocked(getWalletCreateAction).mockReturnValue(undefined as never);
    vi.mocked(usePublicClient).mockReturnValue(undefined as never);
    const api = stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "approved" })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("approved"));

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.flowError).toBe("Connect a wallet to publish.");
    expect(api.publishParams).not.toHaveBeenCalled();
  });

  it("refuses to publish before the draft exists", async () => {
    const api = stubApi();
    const { result } = renderFlow();

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.flowError).toBe("Connect a wallet to publish.");
    expect(api.publishParams).not.toHaveBeenCalled();
  });

  it("surfaces publish failures", async () => {
    stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "approved" })),
      publishParams: vi.fn(async () => {
        throw new DraftsApiError("Draft is no longer approved.", 409);
      }),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("approved"));

    await act(async () => {
      await result.current.publish();
    });

    expect(result.current.flowError).toBe("Draft is no longer approved.");
    expect(result.current.stage).toBe("approved");
    expect(result.current.isPublishing).toBe(false);
    expect(publishDraftMarket).not.toHaveBeenCalled();
  });
});

describe("useCreateDraftFlow stages and feedback", () => {
  it("keeps flagged feedback grouped under its fields", async () => {
    const items = [
      draftFeedbackItemFactory({ title: "First question issue" }),
      draftFeedbackItemFactory({ title: "Second question issue" }),
      draftFeedbackItemFactory({
        field: "resolutionCriteria",
        title: "Criteria issue",
      }),
      fieldlessFeedbackItem(),
    ];
    stubApi({
      get: vi.fn(async () =>
        marketDraftFactory({
          id: 12,
          latestReview: draftReviewFactory({
            feedback: { items, summary: "Fix these." },
          }),
          status: "changes_requested",
        })
      ),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("feedback"));
    expect(result.current.latestReview?.feedback.items).toHaveLength(4);
    expect(result.current.fieldFeedback.question?.map((item) => item.title)).toEqual([
      "First question issue",
      "Second question issue",
    ]);
    expect(
      result.current.fieldFeedback.resolutionCriteria?.map((item) => item.title)
    ).toEqual(["Criteria issue"]);
    expect(Object.keys(result.current.fieldFeedback)).toEqual([
      "question",
      "resolutionCriteria",
    ]);
  });

  it("treats a rejected draft as feedback", async () => {
    stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "rejected" })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("feedback"));
  });

  it("keeps feedback on screen while editing after a non-approve verdict", async () => {
    stubApi({
      get: vi.fn(async () =>
        marketDraftFactory({
          id: 12,
          latestReview: draftReviewFactory({ verdict: "manual_review" }),
          status: "editing",
        })
      ),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());
    expect(result.current.stage).toBe("feedback");
  });

  it("returns to plain editing once the review was an approval", async () => {
    stubApi({
      get: vi.fn(async () =>
        marketDraftFactory({
          id: 12,
          latestReview: draftReviewFactory({ verdict: "approve" }),
          status: "editing",
        })
      ),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());
    expect(result.current.stage).toBe("editing");
    expect(result.current.fieldFeedback).toEqual({});
  });

  it("recognizes an already published draft", async () => {
    stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12, status: "published" })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.stage).toBe("published"));
    expect(result.current.formLocked).toBe(true);
  });
});

describe("useCreateDraftFlow form actions", () => {
  it("applies deadline presets and toggles the advanced section", () => {
    const { result } = renderFlow();

    act(() => result.current.applyGraduationPreset(GRADUATION_PRESETS[1]));
    act(() => result.current.applyResolutionPreset(RESOLUTION_PRESETS[0]));
    act(() => result.current.toggleAdvanced());

    expect(result.current.formDraft.graduationPreset).toBe("6h");
    expect(result.current.formDraft.resolutionPreset).toBe("1d");
    expect(result.current.advanced).toBe(true);
    expect(result.current.preview.metadataHash).toMatch(/^0x/);
    expect(result.current.walletAction.kind).toBe("ready");
  });

  it("focuses the question field when returning to editing", () => {
    const input = document.createElement("input");
    input.id = "question";
    document.body.append(input);
    const { result } = renderFlow();

    act(() => result.current.returnToEditing());

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("starts fresh from a loaded draft", async () => {
    stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12 })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    act(() => result.current.startFresh());

    expect(result.current.serverDraft).toBeNull();
    expect(result.current.publishedMarket).toBeNull();
    expect(result.current.formDraft.question).toBe("");
    expect(result.current.savedAt).toBeNull();
    expect(result.current.flowError).toBeNull();
    expect(result.current.advanced).toBe(false);
    expect(result.current.templateSaved).toBe(false);
    expect(result.current.stage).toBe("editing");

    await settle();

    expect(timers.pendingAutosaves()).toBe(0);
  });

  it("saves the current draft as a template", async () => {
    const api = stubApi({
      get: vi.fn(async () => marketDraftFactory({ id: 12 })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    await act(async () => {
      await result.current.saveAsTemplate();
    });

    expect(api.clone).toHaveBeenCalledWith({ asTemplate: true, fromDraftId: 12 });
    expect(result.current.templateSaved).toBe(true);
  });

  it("surfaces a failed template save", async () => {
    stubApi({
      clone: vi.fn(async () => {
        throw new DraftsApiError("Templates are unavailable.", 503);
      }),
      get: vi.fn(async () => marketDraftFactory({ id: 12 })),
    });
    const { result } = renderFlow(12);

    await waitFor(() => expect(result.current.serverDraft).not.toBeNull());

    await act(async () => {
      await result.current.saveAsTemplate();
    });

    expect(result.current.flowError).toBe("Templates are unavailable.");
    expect(result.current.templateSaved).toBe(false);
  });
});

describe("useCreateDraftFlow local dev autofill", () => {
  it("fills the form from a market the dev menu announced and clears errors", async () => {
    const { result } = renderFlow();

    await act(async () => {
      await result.current.submitForReview();
    });
    expect(result.current.errorCount).toBeGreaterThan(0);

    act(() => dispatchGeneratedMarketFill(generatedLocalMarket()));

    expect(result.current.formDraft.question).toBe(
      "Will the max NYC METAR temperature be higher than 80°F?"
    );
    expect(result.current.formDraft.category).toBe("Weather");
    expect(result.current.formDraft.resolutionPreset).toBe("custom");
    expect(result.current.errorCount).toBe(0);
    expect(result.current.flowError).toBeNull();
  });

  it("stops listening once the flow unmounts", () => {
    const { result, unmount } = renderFlow();
    const before = result.current.formDraft.question;

    unmount();
    dispatchGeneratedMarketFill(generatedLocalMarket());

    expect(result.current.formDraft.question).toBe(before);
  });
});

function generatedLocalMarket(): GeneratedLocalMarket {
  return {
    graduationAt: "2030-07-01T13:00:00.000Z",
    metadata: {
      category: "Weather",
      createdAt: "2030-07-01T12:00:00.000Z",
      description: "Auto-generated local-dev market.",
      question: "Will the max NYC METAR temperature be higher than 80°F?",
      resolutionCriteria: "Resolve YES if the max observation is higher.",
      version: 1,
    },
    resolutionAt: "2030-07-01T14:00:00.000Z",
  };
}

function renderFlow(initialDraftId: number | null = null) {
  return renderHook(() =>
    useCreateDraftFlow({ initialDraftId, initialNow: INITIAL_NOW })
  );
}

/**
 * Lets React's deferred passive-effect flush run (a real macrotask) so
 * "no autosave was scheduled" assertions observe a settled tree.
 */
async function settle() {
  await act(async () => {
    await flushMacrotask();
  });
}

async function flushMacrotask() {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function fillValidDraft(result: { current: ReturnType<typeof useCreateDraftFlow> }) {
  result.current.updateDraft("question", "Will the flow submit?");
  result.current.updateDraft(
    "resolutionCriteria",
    "Resolves YES when the flow submits."
  );
}

/**
 * Captures only the flow's own debounced autosave timers and review-poll
 * interval; faking the whole timer system breaks React's async act flushing.
 */
function interceptWindowTimers() {
  const pendingAutosaves = new Map<number, () => void>();
  const pollTicks: Array<() => void> = [];
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  const originalSetInterval = window.setInterval.bind(window);
  let nextId = 10_000;

  vi.spyOn(window, "setTimeout").mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (delay === 800) {
      const id = ++nextId;

      pendingAutosaves.set(id, callback);

      return id;
    }

    return originalSetTimeout(callback, delay);
  }) as typeof window.setTimeout);

  vi.spyOn(window, "clearTimeout").mockImplementation(((id?: number) => {
    if (typeof id === "number" && pendingAutosaves.delete(id)) {
      return;
    }

    originalClearTimeout(id);
  }) as typeof window.clearTimeout);

  vi.spyOn(window, "setInterval").mockImplementation(((
    callback: () => void,
    delay?: number
  ) => {
    if (delay === 1_200) {
      pollTicks.push(callback);

      return ++nextId;
    }

    return originalSetInterval(callback, delay);
  }) as typeof window.setInterval);

  return {
    flushAutosaves: () => {
      const callbacks = [...pendingAutosaves.values()];

      pendingAutosaves.clear();
      callbacks.forEach((callback) => callback());
    },
    pendingAutosaves: () => pendingAutosaves.size,
    tickPoll: () => {
      pollTicks.at(-1)?.();
    },
  };
}

type ApiStub = {
  clone: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  credit: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  markPublished: ReturnType<typeof vi.fn>;
  publishParams: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function stubApi(overrides: Partial<ApiStub> = {}): ApiStub {
  const api: ApiStub = {
    clone: vi.fn(async () => marketDraftFactory({ id: 40, isTemplate: true })),
    credit: vi.fn(async () => ({
      availableWad: "0",
      metered: true,
      rateWad: "100000000000000000",
      runsRemaining: 0,
      runsUsed: 0,
    })),
    create: vi.fn(async (body: MarketDraftWrite) => savedDraft(21, body)),
    get: vi.fn(async () => marketDraftFactory()),
    list: vi.fn(async () => []),
    markPublished: vi.fn(async () => ({
      bridgeApproved: true,
      draft: marketDraftFactory({ id: 12, status: "published" }),
    })),
    publishParams: vi.fn(async () => publishParamsFixture()),
    remove: vi.fn(),
    submit: vi.fn(async (draftId: number) =>
      marketDraftFactory({ id: draftId, status: "in_review" })
    ),
    update: vi.fn(async (draftId: number, body: MarketDraftWrite) =>
      savedDraft(draftId, body)
    ),
    ...overrides,
  };

  vi.mocked(createDraftsApiClient).mockReturnValue(api as unknown as DraftsApiClient);

  return api;
}

// Echoes the written content back like the real service, so a saved draft
// matches the form and the autosave loop settles.
function savedDraft(id: number, body: MarketDraftWrite): MarketDraft {
  const { intendedCreatorAddress, ...content } = body;

  return {
    ...marketDraftFactory({ id }),
    ...content,
    ...(intendedCreatorAddress !== undefined ? { intendedCreatorAddress } : {}),
  };
}

function publishParamsFixture(): MarketDraftPublishParams {
  return {
    bypassAiResolution: false,
    graduationDeadline: "1900000000",
    graduationThreshold: "2500000000000000000000",
    liquidityParameter: "5000000000000000000000",
    metadata: '{"question":"Will it publish?"}',
    metadataHash: `0x${"ab".repeat(32)}`,
    openingProbabilityWad: "500000000000000000",
    resolutionTime: "1900600000",
    yesNotBefore: "1900600000",
  };
}

// The review-credit meter's 402 refusal (ADR 0022, prepaid-credit
// amendment): the shortfall rides on the error so the aside can offer the
// deposit presets.
function meterRefusal() {
  return new DraftsApiError("You're out of review credit.", 402, {
    bondShortfall: {
      availableWad: "0",
      message: "You're out of review credit.",
      requiredWad: "100000000000000000",
      runsUsed: 3,
    },
  });
}

function fieldlessFeedbackItem() {
  const item = draftFeedbackItemFactory({ title: "General issue" });

  delete item.field;

  return item;
}

function readyWalletAction(): WalletCreateAction {
  return {
    disabled: false,
    kind: "ready",
    label: "Create market",
    message: "Your connected wallet will sign this devchain transaction.",
    run: () => undefined,
  };
}

function connectWalletAction(run: () => void): WalletCreateAction {
  return {
    disabled: false,
    kind: "connect",
    label: "Connect wallet",
    message: "Connect a wallet to sign the market creation transaction.",
    run,
  };
}

function walletState(overrides: Partial<WalletAccountValue> = {}): WalletAccountValue {
  return {
    activeChainId: 31337,
    activeChainName: "Hardhat Local",
    address: ADDRESS,
    authenticated: true,
    clearError: () => undefined,
    connectOrCreateWallet: vi.fn(),
    copyAddress: async () => undefined,
    defaultChain: { id: 31337, name: "Hardhat Local" },
    displayAddress: "0x111...111",
    enabled: true,
    errorMessage: null,
    getDraftAuthHeaders: async () => ({}),
    isSupportedChain: true,
    linkWallet: () => undefined,
    login: vi.fn(),
    loginLabel: "Sign in",
    logout: async () => undefined,
    ownerUserId:
      (overrides.address === undefined ? ADDRESS : overrides.address)?.toLowerCase() ??
      null,
    pendingAction: null,
    ready: true,
    setActiveWallet: async () => undefined,
    supportedChains: [{ id: 31337, name: "Hardhat Local" }],
    switchChain: vi.fn(async () => undefined),
    userLabel: null,
    wallets: [],
    ...overrides,
  };
}
