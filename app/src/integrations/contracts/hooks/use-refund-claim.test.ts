import { act, renderHook, waitFor } from "@testing-library/react";
import type { PublicClient, WalletClient } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { submitRefundClaim } from "../refund-claim-service";
import { useRefundClaim } from "./use-refund-claim";

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

vi.mock("../refund-claim-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../refund-claim-service")>()),
  submitRefundClaim: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111";
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
  vi.mocked(submitRefundClaim).mockResolvedValue({
    refund: 24n * WAD,
    transactionHash: `0x${"cc".repeat(32)}`,
  });
});

describe("useRefundClaim", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useRefundClaim());

    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("submits the claim and reports success, then refreshes the caller", async () => {
    const onClaimed = vi.fn();
    const { result } = renderHook(() => useRefundClaim({ onClaimed }));

    act(() => result.current.claim("32"));

    expect(result.current.status).toBe("pending");
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(submitRefundClaim).toHaveBeenCalledWith({
      config: contractConfig,
      receiptId: 32n,
      wallet: {
        accountAddress: ACCOUNT,
        activeChainId: 31337,
        publicClient,
        walletClient,
      },
    });
    expect(onClaimed).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it("surfaces a formatted error when the write fails", async () => {
    const onClaimed = vi.fn();
    vi.mocked(submitRefundClaim).mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useRefundClaim({ onClaimed }));

    act(() => result.current.claim("32"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Could not claim your refund.");
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it("fails when no contract config is available", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { result } = renderHook(() => useRefundClaim());

    act(() => result.current.claim("32"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "Refund claims are not available on this network."
    );
    expect(submitRefundClaim).not.toHaveBeenCalled();
  });

  it("fails when the wallet or clients are not ready", async () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useWalletClient>);
    const { result } = renderHook(() => useRefundClaim());

    act(() => result.current.claim("32"));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("Connect a wallet before claiming your refund.");
    expect(submitRefundClaim).not.toHaveBeenCalled();
  });
});
