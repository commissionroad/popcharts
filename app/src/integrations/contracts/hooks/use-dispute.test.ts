import { act, renderHook, waitFor } from "@testing-library/react";
import type { PublicClient, WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { disputeResolution } from "../dispute-service";
import { useDispute } from "./use-dispute";

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(),
  useWalletClient: vi.fn(),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

vi.mock("../dispute-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../dispute-service")>()),
  disputeResolution: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const WAD = 10n ** 18n;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewBondVaultAddress: null,
  rpcUrl: "http://127.0.0.1:8545",
};

const publicClient = {} as unknown as PublicClient;
const walletClient = {} as unknown as WalletClient;
const disputeResult = {
  bond: 100n * WAD,
  disputer: ACCOUNT as `0x${string}`,
  transactionHash: `0x${"cd".repeat(32)}` as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(usePublicClient).mockReturnValue(
    publicClient as ReturnType<typeof usePublicClient>
  );
  vi.mocked(useWalletClient).mockReturnValue({
    data: walletClient,
  } as ReturnType<typeof useWalletClient>);
  vi.mocked(useWalletAccount).mockReturnValue({
    activeChainId: 31337,
    address: ACCOUNT,
  } as ReturnType<typeof useWalletAccount>);
  vi.mocked(disputeResolution).mockResolvedValue(disputeResult);
});

describe("useDispute", () => {
  it("fails when no contract config is available", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { result } = renderHook(() => useDispute());

    act(() => result.current.dispute(MARKET));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Disputes are not available on this network.");
    expect(disputeResolution).not.toHaveBeenCalled();
  });

  it("fails when no wallet is connected", async () => {
    vi.mocked(useWalletAccount).mockReturnValue({
      activeChainId: 31337,
      address: null,
    } as ReturnType<typeof useWalletAccount>);

    await expectDisconnectedError();
  });

  it("fails when the wallet client has not loaded", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useWalletClient>);

    await expectDisconnectedError();
  });

  it("passes the wallet context to the service and reports the confirmed bond", async () => {
    const onDisputed = vi.fn();
    const { result } = renderHook(() => useDispute({ onDisputed }));

    act(() => result.current.dispute(MARKET));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result).toEqual(disputeResult);
    expect(result.current.error).toBeNull();
    expect(result.current.step).toBeNull();
    expect(onDisputed).toHaveBeenCalledTimes(1);
    expect(disputeResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        config: contractConfig,
        marketAddress: MARKET,
        wallet: {
          accountAddress: ACCOUNT,
          activeChainId: 31337,
          publicClient,
          walletClient,
        },
      })
    );
  });

  it("exposes the in-flight step and clears it once the run settles", async () => {
    let finish = () => {};
    vi.mocked(disputeResolution).mockImplementation(async ({ onStep }) => {
      onStep?.("approving");

      await new Promise<void>((resolve) => {
        finish = resolve;
      });

      return disputeResult;
    });
    const { result } = renderHook(() => useDispute());

    act(() => result.current.dispute(MARKET));

    await waitFor(() => expect(result.current.step).toBe("approving"));

    await act(async () => {
      finish();
    });

    // The step clears when the run settles so the button stops naming a
    // transaction that already landed.
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.step).toBeNull();
  });

  it("surfaces a mapped revert message when the dispute fails", async () => {
    vi.mocked(disputeResolution).mockRejectedValue(
      new Error("reverted: DisputeWindowClosed(1700000000)")
    );
    const { result } = renderHook(() => useDispute());

    act(() => result.current.dispute(MARKET));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "The dispute window closed before this transaction landed, so the proposed outcome stands."
    );
    expect(result.current.result).toBeNull();
  });
});

async function expectDisconnectedError() {
  const { result } = renderHook(() => useDispute());

  act(() => result.current.dispute(MARKET));

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe(
    "Connect a wallet before disputing this resolution."
  );
  expect(disputeResolution).not.toHaveBeenCalled();
}
