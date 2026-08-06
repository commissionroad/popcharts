import { act, renderHook, waitFor } from "@testing-library/react";
import type { PublicClient, WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { finalizeMarketResolution } from "../finalize-service";
import { useFinalize } from "./use-finalize";

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

vi.mock("../finalize-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../finalize-service")>()),
  finalizeMarketResolution: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const MARKET = "0x2222222222222222222222222222222222222222" as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewCreditVaultAddress: null,
  rpcUrl: "http://127.0.0.1:8545",
};

const publicClient = {} as unknown as PublicClient;
const walletClient = {} as unknown as WalletClient;
const finalizeResult = {
  transactionHash: `0x${"ef".repeat(32)}` as const,
  winningSide: "yes" as const,
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
  vi.mocked(finalizeMarketResolution).mockResolvedValue(finalizeResult);
});

describe("useFinalize", () => {
  it("fails when no contract config is available", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { result } = renderHook(() => useFinalize());

    act(() => result.current.finalize(MARKET));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Settlement is not available on this network.");
    expect(finalizeMarketResolution).not.toHaveBeenCalled();
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

  it("passes the wallet context to the service and reports the settled side", async () => {
    const onFinalized = vi.fn();
    const { result } = renderHook(() => useFinalize({ onFinalized }));

    act(() => result.current.finalize(MARKET));

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.result).toEqual(finalizeResult);
    expect(result.current.error).toBeNull();
    expect(result.current.step).toBeNull();
    expect(onFinalized).toHaveBeenCalledTimes(1);
    expect(finalizeMarketResolution).toHaveBeenCalledWith(
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
    vi.mocked(finalizeMarketResolution).mockImplementation(async ({ onStep }) => {
      onStep?.("finalizing");

      await new Promise<void>((resolve) => {
        finish = resolve;
      });

      return finalizeResult;
    });
    const { result } = renderHook(() => useFinalize());

    act(() => result.current.finalize(MARKET));

    await waitFor(() => expect(result.current.step).toBe("finalizing"));

    await act(async () => {
      finish();
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.step).toBeNull();
  });

  it("surfaces a mapped revert message when another finalizer wins the race", async () => {
    vi.mocked(finalizeMarketResolution).mockRejectedValue(
      new Error("reverted: InvalidStatus(4, 3)")
    );
    const { result } = renderHook(() => useFinalize());

    act(() => result.current.finalize(MARKET));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "This market was settled before your transaction landed. Refresh to see the outcome."
    );
    expect(result.current.result).toBeNull();
  });
});

async function expectDisconnectedError() {
  const { result } = renderHook(() => useFinalize());

  act(() => result.current.finalize(MARKET));

  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.error).toBe("Connect a wallet before settling this market.");
  expect(finalizeMarketResolution).not.toHaveBeenCalled();
}
