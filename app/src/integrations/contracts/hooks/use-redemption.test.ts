import { act, renderHook, waitFor } from "@testing-library/react";
import type { PublicClient, WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { submitDrawRedemption, submitRedemption } from "../redemption-service";
import { useRedemption } from "./use-redemption";

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

vi.mock("../redemption-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../redemption-service")>()),
  submitDrawRedemption: vi.fn(),
  submitRedemption: vi.fn(),
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
  rpcUrl: "http://127.0.0.1:8545",
};

const publicClient = {} as unknown as PublicClient;
const walletClient = {} as unknown as WalletClient;
const redemptionResult = {
  collateralAmount: 24n * WAD,
  outcomeAmount: 24n * WAD,
  transactionHash: `0x${"cc".repeat(32)}` as const,
  valueWad: 24n * WAD,
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
  vi.mocked(submitDrawRedemption).mockResolvedValue(redemptionResult);
  vi.mocked(submitRedemption).mockResolvedValue(redemptionResult);
});

describe("useRedemption", () => {
  it("fails when no contract config is available", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { result } = renderHook(() => useRedemption());

    act(() => result.current.redeem(request()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Claims are not available on this network.");
    expect(submitRedemption).not.toHaveBeenCalled();
  });

  it("guards draw redemptions when no contract config is available", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { result } = renderHook(() => useRedemption());

    act(() => result.current.redeemDraw(drawRequest()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Claims are not available on this network.");
    expect(submitDrawRedemption).not.toHaveBeenCalled();
  });

  it("fails when the wallet or clients are not ready", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useWalletClient>);
    const { result } = renderHook(() => useRedemption());

    act(() => result.current.redeem(request()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "Connect a wallet before claiming your winnings."
    );
    expect(submitRedemption).not.toHaveBeenCalled();
  });

  it("guards draw redemptions when the wallet or clients are not ready", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useWalletClient>);
    const { result } = renderHook(() => useRedemption());

    act(() => result.current.redeemDraw(drawRequest()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "Connect a wallet before claiming your winnings."
    );
    expect(submitDrawRedemption).not.toHaveBeenCalled();
  });

  it("submits the redemption and reports success, then refreshes the caller", async () => {
    const onRedeemed = vi.fn();
    const { result } = renderHook(() => useRedemption({ onRedeemed }));

    act(() => result.current.redeem(request()));

    expect(result.current.status).toBe("pending");
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(submitRedemption).toHaveBeenCalledWith({
      ...request(),
      config: contractConfig,
      wallet: {
        accountAddress: ACCOUNT,
        activeChainId: 31337,
        publicClient,
        walletClient,
      },
    });
    expect(result.current.result).toEqual(redemptionResult);
    expect(onRedeemed).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it("submits a draw redemption with the request and wallet context", async () => {
    const onRedeemed = vi.fn();
    const { result } = renderHook(() => useRedemption({ onRedeemed }));

    act(() => result.current.redeemDraw(drawRequest()));

    expect(result.current.status).toBe("pending");
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(submitDrawRedemption).toHaveBeenCalledWith({
      ...drawRequest(),
      config: contractConfig,
      wallet: {
        accountAddress: ACCOUNT,
        activeChainId: 31337,
        publicClient,
        walletClient,
      },
    });
    expect(result.current.result).toEqual(redemptionResult);
    expect(onRedeemed).toHaveBeenCalledOnce();
  });

  it("surfaces a formatted error when the write fails", async () => {
    const onRedeemed = vi.fn();
    vi.mocked(submitRedemption).mockRejectedValue(
      new Error("reverted: LosingSideCannotRedeem()")
    );
    const { result } = renderHook(() => useRedemption({ onRedeemed }));

    act(() => result.current.redeem(request()));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "These tokens are on the losing side, so they cannot be redeemed."
    );
    expect(onRedeemed).not.toHaveBeenCalled();
  });
});

function request() {
  return { amount: 24n * WAD, marketAddress: MARKET, side: "yes" as const };
}

function drawRequest() {
  return { marketAddress: MARKET, noAmount: 12n * WAD, yesAmount: 24n * WAD };
}
