import type { MarketDraft } from "@popcharts/api-client/models";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDraftsApiClient,
  type DraftsApiClient,
  DraftsApiError,
} from "@/integrations/indexer/drafts-api";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { marketDraftFactory } from "@/test/factories/drafts";

import { draftBelongsOnShelf, type StudioShelf, useStudio } from "./use-studio";

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/integrations/indexer/drafts-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/indexer/drafts-api")>()),
  createDraftsApiClient: vi.fn(),
}));

const ADDRESS = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  stubApi();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("draftBelongsOnShelf", () => {
  it.each<[StudioShelf, MarketDraft, boolean]>([
    ["templates", marketDraftFactory({ isTemplate: true }), true],
    ["templates", marketDraftFactory(), false],
    ["all", marketDraftFactory({ isTemplate: true }), true],
    ["in_review", marketDraftFactory({ isTemplate: true }), false],
    ["all", marketDraftFactory({ status: "editing" }), true],
    ["in_review", marketDraftFactory({ status: "in_review" }), true],
    ["in_review", marketDraftFactory({ status: "editing" }), false],
    ["needs_fixes", marketDraftFactory({ status: "changes_requested" }), true],
    ["needs_fixes", marketDraftFactory({ status: "rejected" }), true],
    ["needs_fixes", marketDraftFactory({ status: "editing" }), false],
    ["approved", marketDraftFactory({ status: "approved" }), true],
    ["approved", marketDraftFactory({ status: "editing" }), false],
    ["published", marketDraftFactory({ status: "published" }), true],
    ["published", marketDraftFactory({ status: "approved" }), false],
  ])("shelf %s / draft %# -> %s", (shelf, draft, expected) => {
    expect(draftBelongsOnShelf(draft, shelf)).toBe(expected);
  });
});

describe("useStudio loading", () => {
  it("loads the connected wallet's drafts", async () => {
    const api = stubApi({
      list: vi.fn(async () => [marketDraftFactory({ id: 1 })]),
    });

    const { result } = renderHook(() => useStudio());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.drafts.map((draft) => draft.id)).toEqual([1]);
    expect(result.current.error).toBeNull();
    expect(result.current.canPersist).toBe(true);
    expect(result.current.walletReady).toBe(true);
    expect(api.list).toHaveBeenCalledTimes(1);
    expect(createDraftsApiClient).toHaveBeenCalledWith({
      getAuthHeaders: expect.any(Function),
    });
  });

  it("stays idle without a connected wallet", () => {
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ address: null, authenticated: false, ready: false })
    );

    const { result } = renderHook(() => useStudio());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.drafts).toEqual([]);
    expect(result.current.canPersist).toBe(false);
    expect(result.current.walletReady).toBe(false);
    expect(createDraftsApiClient).not.toHaveBeenCalled();
  });

  it("surfaces the draft service's own error message", async () => {
    stubApi({
      list: vi.fn(async () => {
        throw new DraftsApiError("Sign in to manage drafts.", 401);
      }),
    });

    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.error).toBe("Sign in to manage drafts."));
    expect(result.current.isLoading).toBe(false);
  });

  it("falls back to generic copy for unrecognized failures", async () => {
    stubApi({
      list: vi.fn(async () => {
        throw new Error("socket hang up");
      }),
    });

    const { result } = renderHook(() => useStudio());

    await waitFor(() =>
      expect(result.current.error).toBe("The draft service hit a snag — try again.")
    );
  });

  it("ignores a list that lands after the studio unmounts", async () => {
    let releaseList: (drafts: MarketDraft[]) => void = () => {};
    const api = stubApi({
      list: vi.fn(
        () =>
          new Promise<MarketDraft[]>((resolve) => {
            releaseList = resolve;
          })
      ),
    });
    const { result, unmount } = renderHook(() => useStudio());

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    unmount();
    releaseList([marketDraftFactory()]);

    await flushMacrotask();

    expect(result.current.drafts).toEqual([]);
  });

  it("ignores a list failure that lands after the studio unmounts", async () => {
    let rejectList: (error: unknown) => void = () => {};
    const api = stubApi({
      list: vi.fn(
        () =>
          new Promise<MarketDraft[]>((_resolve, reject) => {
            rejectList = reject;
          })
      ),
    });
    const { result, unmount } = renderHook(() => useStudio());

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));

    unmount();
    rejectList(new DraftsApiError("Sign in to manage drafts.", 401));

    await flushMacrotask();

    expect(result.current.error).toBeNull();
  });

  it("refreshes the list on request", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.refresh());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.list).toHaveBeenCalledTimes(2);
  });
});

describe("useStudio shelves", () => {
  it("filters the visible drafts by the selected shelf", async () => {
    stubApi({
      list: vi.fn(async () => [
        marketDraftFactory({ id: 1, status: "approved" }),
        marketDraftFactory({ id: 2, status: "in_review" }),
        marketDraftFactory({ id: 3, isTemplate: true }),
      ]),
    });

    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.drafts).toHaveLength(3));
    expect(result.current.shelf).toBe("all");
    expect(result.current.visibleDrafts.map((draft) => draft.id)).toEqual([1, 2, 3]);

    act(() => result.current.setShelf("approved"));

    expect(result.current.shelf).toBe("approved");
    expect(result.current.visibleDrafts.map((draft) => draft.id)).toEqual([1]);

    act(() => result.current.setShelf("templates"));

    expect(result.current.visibleDrafts.map((draft) => draft.id)).toEqual([3]);
  });
});

describe("useStudio mutations", () => {
  it("clones a draft and refreshes the list", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.cloneDraft(12);
    });

    expect(api.clone).toHaveBeenCalledWith({ asTemplate: false, fromDraftId: 12 });
    expect(api.list).toHaveBeenCalledTimes(2);
    expect(result.current.busyDraftId).toBeNull();
  });

  it("clones a draft as a template", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.cloneDraft(12, true);
    });

    expect(api.clone).toHaveBeenCalledWith({ asTemplate: true, fromDraftId: 12 });
  });

  it("marks the draft busy while its mutation is in flight", async () => {
    let releaseClone = () => {};
    stubApi({
      clone: vi.fn(
        () =>
          new Promise<MarketDraft>((resolve) => {
            releaseClone = () => resolve(marketDraftFactory());
          })
      ),
    });
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      void result.current.cloneDraft(12);
    });

    await waitFor(() => expect(result.current.busyDraftId).toBe(12));

    act(() => releaseClone());

    await waitFor(() => expect(result.current.busyDraftId).toBeNull());
  });

  it("removes a draft", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeDraft(12);
    });

    expect(api.remove).toHaveBeenCalledWith(12);
  });

  it("toggles a draft's template flag", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.toggleTemplate(marketDraftFactory({ id: 7 }));
    });

    expect(api.update).toHaveBeenCalledWith(7, { isTemplate: true });
  });

  it("surfaces mutation failures and clears the busy marker", async () => {
    stubApi({
      remove: vi.fn(async () => {
        throw new DraftsApiError("Draft not found.", 404);
      }),
    });
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.removeDraft(12);
    });

    expect(result.current.error).toBe("Draft not found.");
    expect(result.current.busyDraftId).toBeNull();
  });

  it("ignores mutations without a connected wallet", async () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await act(async () => {
      await result.current.cloneDraft(12);
    });

    expect(api.clone).not.toHaveBeenCalled();
  });
});

describe("useStudio cloneFromMarket", () => {
  it("clones an indexed market into a draft and refreshes", async () => {
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let cloned = false;

    await act(async () => {
      cloned = await result.current.cloneFromMarket(31337, "9");
    });

    expect(cloned).toBe(true);
    expect(api.clone).toHaveBeenCalledWith({
      fromMarket: { chainId: 31337, marketId: "9" },
    });
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it("reports a failed market clone", async () => {
    stubApi({
      clone: vi.fn(async () => {
        throw new DraftsApiError("Market not found.", 404);
      }),
    });
    const { result } = renderHook(() => useStudio());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let cloned = true;

    await act(async () => {
      cloned = await result.current.cloneFromMarket(31337, "9");
    });

    expect(cloned).toBe(false);
    expect(result.current.error).toBe("Market not found.");
  });

  it("refuses to clone without a connected wallet", async () => {
    vi.mocked(useWalletAccount).mockReturnValue(walletState({ address: null }));
    const api = stubApi();
    const { result } = renderHook(() => useStudio());

    let cloned = true;

    await act(async () => {
      cloned = await result.current.cloneFromMarket(31337, "9");
    });

    expect(cloned).toBe(false);
    expect(api.clone).not.toHaveBeenCalled();
  });
});

type ApiStub = {
  clone: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  markPublished: ReturnType<typeof vi.fn>;
  publishParams: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  submit: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

async function flushMacrotask() {
  await new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function stubApi(overrides: Partial<ApiStub> = {}): ApiStub {
  const api: ApiStub = {
    clone: vi.fn(async () => marketDraftFactory()),
    create: vi.fn(async () => marketDraftFactory()),
    get: vi.fn(async () => marketDraftFactory()),
    list: vi.fn(async () => [marketDraftFactory()]),
    markPublished: vi.fn(),
    publishParams: vi.fn(),
    remove: vi.fn(async () => undefined),
    submit: vi.fn(),
    update: vi.fn(async () => marketDraftFactory()),
    ...overrides,
  };

  vi.mocked(createDraftsApiClient).mockReturnValue(api as unknown as DraftsApiClient);

  return api;
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
