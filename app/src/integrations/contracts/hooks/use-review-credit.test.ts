import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { reviewBondVaultAbi } from "../review-bond-vault";
import { useReviewCreditDeposit } from "./use-review-credit";

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

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const BENEFICIARY = "0x2222222222222222222222222222222222222222";
const VAULT = "0x0000000000000000000000000000000000000042";
const HASH = `0x${"ab".repeat(32)}` as const;
const WAD = 10n ** 18n;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewBondVaultAddress: VAULT,
  rpcUrl: "http://127.0.0.1:8545",
};

let receipts: { waitForTransactionReceipt: ReturnType<typeof vi.fn> };
let walletWrites: {
  chain: { id: number };
  writeContract: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  receipts = { waitForTransactionReceipt: vi.fn(async () => ({})) };
  walletWrites = { chain: { id: 31337 }, writeContract: vi.fn(async () => HASH) };
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(usePublicClient).mockReturnValue(
    receipts as unknown as ReturnType<typeof usePublicClient>
  );
  vi.mocked(useWalletClient).mockReturnValue({
    data: walletWrites,
  } as unknown as ReturnType<typeof useWalletClient>);
  vi.mocked(useWalletAccount).mockReturnValue({
    activeChainId: 31337,
    address: ACCOUNT,
  } as unknown as ReturnType<typeof useWalletAccount>);
});

describe("useReviewCreditDeposit", () => {
  it("is enabled when a vault is configured and a wallet is connected", () => {
    const { result } = renderHook(() => useReviewCreditDeposit());

    expect(result.current.enabled).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
  });

  it("is disabled without a vault address", () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue({
      ...contractConfig,
      reviewBondVaultAddress: null,
    } as unknown as PopChartsContractConfig);

    const { result } = renderHook(() => useReviewCreditDeposit());

    expect(result.current.enabled).toBe(false);
  });

  it("sends depositFor with the beneficiary and confirms the receipt", async () => {
    const { result } = renderHook(() => useReviewCreditDeposit());

    act(() => {
      result.current.deposit(BENEFICIARY, 5n * WAD);
    });

    expect(result.current.status).toBe("pending");

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(walletWrites.writeContract).toHaveBeenCalledWith({
      abi: reviewBondVaultAbi,
      account: ACCOUNT,
      address: VAULT,
      args: [BENEFICIARY],
      chain: walletWrites.chain,
      functionName: "depositFor",
      value: 5n * WAD,
    });
    expect(receipts.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: HASH,
    });
  });

  it("errors without sending when no wallet is connected", () => {
    vi.mocked(useWalletAccount).mockReturnValue({
      activeChainId: 31337,
      address: null,
    } as unknown as ReturnType<typeof useWalletAccount>);

    const { result } = renderHook(() => useReviewCreditDeposit());

    act(() => {
      result.current.deposit(BENEFICIARY, WAD);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Connect a wallet to deposit review credit.");
    expect(walletWrites.writeContract).not.toHaveBeenCalled();
  });

  it("surfaces a failed write and clears the error on the next attempt", async () => {
    walletWrites.writeContract.mockRejectedValueOnce(new Error("nope"));

    const { result } = renderHook(() => useReviewCreditDeposit());

    act(() => {
      result.current.deposit(BENEFICIARY, WAD);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("The deposit did not go through — try again.");

    act(() => {
      result.current.deposit(BENEFICIARY, WAD);
    });

    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("surfaces a receipt that never confirms as an error", async () => {
    receipts.waitForTransactionReceipt.mockRejectedValueOnce(new Error("timed out"));

    const { result } = renderHook(() => useReviewCreditDeposit());

    act(() => {
      result.current.deposit(BENEFICIARY, WAD);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
