import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GRADUATION_PRESETS,
  RESOLUTION_PRESETS,
} from "@/domain/market-creation/create-market";
import type { CreatedMarket } from "@/domain/market-creation/types";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { useTrustedCreatorStatus } from "@/integrations/contracts/hooks/use-trusted-creator-status";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { createMarket, submitMarketForReview } from "./create-market-service";
import { focusFirstReviewError } from "./review-errors";
import { useCreateMarketFormState } from "./use-create-market-form-state";

const configState = vi.hoisted(() => ({
  config: null as unknown,
  mode: "mock" as string,
  signer: "wallet" as string,
}));

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: () => configState.config,
  get marketCreationMode() {
    return configState.mode;
  },
  get marketCreationSigner() {
    return configState.signer;
  },
}));

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(() => ({ kind: "public-client" })),
  useWalletClient: vi.fn(() => ({ data: { kind: "wallet-client" } })),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/integrations/contracts/hooks/use-trusted-creator-status", () => ({
  useTrustedCreatorStatus: vi.fn(() => ({ data: undefined })),
}));

vi.mock("./create-market-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./create-market-service")>()),
  createMarket: vi.fn(),
  submitMarketForReview: vi.fn(),
}));

vi.mock("./review-errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./review-errors")>()),
  focusFirstReviewError: vi.fn(),
}));

const INITIAL_NOW = "2030-07-01T12:00:00.000Z";

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

beforeEach(() => {
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(useTrustedCreatorStatus).mockReturnValue({ data: undefined } as never);
  vi.mocked(createMarket).mockResolvedValue(createdMarket());
  vi.mocked(submitMarketForReview).mockResolvedValue({
    aiReview: { source: "local", status: "eligible" },
    reviewId: "review-1",
    reviewStatus: "queued",
    submittedAt: INITIAL_NOW,
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
  configState.config = null;
  configState.mode = "mock";
  configState.signer = "wallet";
});

describe("useCreateMarketFormState editing", () => {
  it("starts in edit stage with a seeded draft and hidden field errors", () => {
    const { result } = renderForm();

    expect(result.current.stage).toBe("edit");
    expect(result.current.draft.question).toBe("");
    // The empty question is invalid, but errors stay hidden until review.
    expect(result.current.hasErrors).toBe(true);
    expect(result.current.visibleErrors).toEqual({});
    expect(result.current.reviewErrorCount).toBe(0);
    expect(result.current.creationFeeLabel).toBeNull();
    expect(result.current.createAction).toBeNull();
  });

  it("updates draft fields and clears stale submission state", () => {
    const { result } = renderForm();

    act(() => result.current.updateDraft("question", "Will it work?"));

    expect(result.current.draft.question).toBe("Will it work?");
  });

  it("drops back to edit when a preset changes a reviewed draft", () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    act(() => result.current.handleReview());
    expect(result.current.stage).toBe("review");

    act(() => result.current.applyGraduationPreset(GRADUATION_PRESETS[0]));

    expect(result.current.stage).toBe("edit");
  });

  it("reports incomplete devchain configuration through the create action", () => {
    configState.config = null;
    configState.mode = "devchain";
    configState.signer = "wallet";
    const { result } = renderForm();

    expect(result.current.createAction?.kind).toBe("waiting");
    expect(result.current.createAction?.label).toBe("Configure devchain");
  });

  it("applies graduation and resolution presets with their labels", () => {
    const { result } = renderForm();
    const before = result.current.draft.graduationTime;

    act(() => result.current.applyGraduationPreset(GRADUATION_PRESETS[2]));
    act(() => result.current.applyResolutionPreset(RESOLUTION_PRESETS[0]));

    expect(result.current.draft.graduationPreset).toBe("24h");
    expect(result.current.draft.graduationTime).not.toBe(before);
    expect(result.current.draft.resolutionPreset).toBe("1d");
  });

  it("toggles the advanced section", () => {
    const { result } = renderForm();

    act(() => result.current.toggleAdvanced());
    expect(result.current.advanced).toBe(true);

    act(() => result.current.toggleAdvanced());
    expect(result.current.advanced).toBe(false);
  });

  it("resets the form to a fresh draft", () => {
    const { result } = renderForm();

    act(() => result.current.updateDraft("question", "Will it work?"));
    act(() => result.current.toggleAdvanced());
    act(() => result.current.resetForm());

    expect(result.current.draft.question).toBe("");
    expect(result.current.advanced).toBe(false);
    expect(result.current.stage).toBe("edit");
  });
});

describe("useCreateMarketFormState review", () => {
  it("blocks review while the draft is invalid and focuses the first error", () => {
    const { result } = renderForm();

    act(() => result.current.handleReview());

    expect(result.current.stage).toBe("edit");
    expect(focusFirstReviewError).toHaveBeenCalledWith(
      expect.objectContaining({ question: expect.any(String) })
    );
    expect(result.current.visibleErrors.question).toBeDefined();
    expect(result.current.reviewErrorCount).toBeGreaterThan(0);
  });

  it("advances to the review stage once the draft validates", () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    act(() => result.current.handleReview());

    expect(result.current.stage).toBe("review");
    expect(focusFirstReviewError).not.toHaveBeenCalled();
  });

  it("drops back to edit when a reviewed draft is changed", () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    act(() => result.current.handleReview());
    act(() => result.current.updateDraft("question", "Changed?"));

    expect(result.current.stage).toBe("edit");
  });

  it("returns to edit on request", () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    act(() => result.current.handleReview());
    act(() => result.current.returnToEdit());

    expect(result.current.stage).toBe("edit");
  });
});

describe("useCreateMarketFormState review submission", () => {
  it("submits a valid draft and lands on the submitted stage", async () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleSubmitForReview();
    });

    expect(result.current.stage).toBe("submitted");
    expect(result.current.submittedReview?.reviewId).toBe("review-1");
    expect(result.current.submitError).toBeNull();
  });

  it("refuses to submit an invalid draft", async () => {
    const { result } = renderForm();

    await act(async () => {
      await result.current.handleSubmitForReview();
    });

    expect(submitMarketForReview).not.toHaveBeenCalled();
    expect(result.current.stage).toBe("edit");
  });

  it("surfaces submission failures", async () => {
    vi.mocked(submitMarketForReview).mockRejectedValue(
      new Error("Reviewer queue is unavailable.")
    );
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleSubmitForReview();
    });

    expect(result.current.submitError).toBe(
      "The review service could not submit this market."
    );
    expect(result.current.stage).toBe("edit");
    expect(result.current.isSubmittingForReview).toBe(false);
  });

  it("falls back to generic copy for non-Error failures", async () => {
    vi.mocked(submitMarketForReview).mockRejectedValue("offline");
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleSubmitForReview();
    });

    expect(result.current.submitError).toBe(
      "The review service could not submit this market."
    );
  });
});

describe("useCreateMarketFormState creation", () => {
  it("creates the market and lands on the success stage", async () => {
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleCreate();
    });

    expect(result.current.stage).toBe("success");
    expect(result.current.createdMarket?.marketId).toBe("9");
    expect(createMarket).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Will the form hook pass?" }),
      {}
    );
  });

  it("refuses to create from an invalid draft", async () => {
    const { result } = renderForm();

    await act(async () => {
      await result.current.handleCreate();
    });

    expect(createMarket).not.toHaveBeenCalled();
    expect(result.current.stage).toBe("edit");
  });

  it("returns generic copy (not the raw error) for creation failures", async () => {
    vi.mocked(createMarket).mockRejectedValue(new Error("Relay unavailable."));
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleCreate();
    });

    expect(result.current.submitError).toBe(
      "The creation service could not create this market."
    );

    vi.mocked(createMarket).mockRejectedValue("offline");
    await act(async () => {
      await result.current.handleCreate();
    });

    expect(result.current.submitError).toBe(
      "The creation service could not create this market."
    );
    expect(result.current.isCreating).toBe(false);
  });

  it("runs the blocking wallet step instead of creating when not ready", async () => {
    const login = vi.fn();
    devchainWalletSigner();
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ authenticated: false, login })
    );
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleCreate();
    });

    expect(login).toHaveBeenCalled();
    expect(createMarket).not.toHaveBeenCalled();
    expect(result.current.createAction?.kind).toBe("connect");
  });

  it("passes the wallet context once the wallet step is ready", async () => {
    devchainWalletSigner();
    const { result } = renderForm();

    act(() => fillValidDraft(result.current.updateDraft));
    await act(async () => {
      await result.current.handleCreate();
    });

    await waitFor(() => expect(result.current.stage).toBe("success"));
    expect(createMarket).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        wallet: expect.objectContaining({
          accountAddress: "0x1111111111111111111111111111111111111111",
          activeChainId: 31337,
        }),
      })
    );
  });
});

describe("useCreateMarketFormState trusted creators", () => {
  it("labels the creation fee for untrusted devchain creators", () => {
    devchainWalletSigner();
    const { result } = renderForm();

    expect(result.current.creationFeeLabel).toBe("1 native USDC");
    expect(result.current.trustedCreatorCanBypassAiResolution).toBe(false);
  });

  it("waives the fee for trusted creators", () => {
    devchainWalletSigner();
    vi.mocked(useTrustedCreatorStatus).mockReturnValue({ data: true } as never);
    const { result } = renderForm();

    expect(result.current.creationFeeLabel).toBe("Waived");
    expect(result.current.trustedCreatorCanBypassAiResolution).toBe(true);
  });

  it("strips the AI-resolution bypass from untrusted drafts", () => {
    devchainWalletSigner();
    const { result } = renderForm();

    act(() => result.current.updateDraft("bypassAiResolution", true));

    expect(result.current.preview.protocolParams.bypassAiResolution).toBe(false);

    vi.mocked(useTrustedCreatorStatus).mockReturnValue({ data: true } as never);
    act(() => result.current.updateDraft("bypassAiResolution", true));

    expect(result.current.preview.protocolParams.bypassAiResolution).toBe(true);
  });
});

function renderForm() {
  return renderHook(() => useCreateMarketFormState(INITIAL_NOW));
}

function devchainWalletSigner() {
  configState.config = contractConfig;
  configState.mode = "devchain";
  configState.signer = "wallet";
}

function fillValidDraft(
  updateDraft: ReturnType<typeof useCreateMarketFormState>["updateDraft"]
) {
  updateDraft("question", "Will the form hook pass?");
  updateDraft("resolutionCriteria", "Resolves YES when the suite is green.");
}

function createdMarket(): CreatedMarket {
  return {
    marketId: "9",
  } as CreatedMarket;
}

function walletState(overrides: Partial<WalletAccountValue> = {}): WalletAccountValue {
  return {
    activeChainId: 31337,
    activeChainName: "Hardhat Local",
    address: "0x1111111111111111111111111111111111111111",
    authenticated: true,
    clearError: () => undefined,
    connectOrCreateWallet: vi.fn(),
    copyAddress: async () => undefined,
    defaultChain: { id: 31337, name: "Hardhat Local" },
    displayAddress: "0x111...111",
    enabled: true,
    errorMessage: null,
    isSupportedChain: true,
    linkWallet: () => undefined,
    login: vi.fn(),
    loginLabel: "Sign in",
    logout: async () => undefined,
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
