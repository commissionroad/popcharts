import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useReadContract, useWalletClient } from "wagmi";

import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import type { PopChartsContractConfig } from "../config";
import { getPopChartsContractConfig } from "../config";
import { reviewBondVaultAbi } from "../review-bond-vault";
import { useReviewBond } from "./use-review-bond";

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(),
  useReadContract: vi.fn(),
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

let availableRead: ContractReadStub;
let depositedRead: ContractReadStub;
let receipts: { waitForTransactionReceipt: ReturnType<typeof vi.fn> };
let walletWrites: {
  chain: { id: number };
  writeContract: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  availableRead = { data: 3n * WAD, refetch: vi.fn(async () => ({})) };
  depositedRead = { data: 5n * WAD, refetch: vi.fn(async () => ({})) };
  receipts = { waitForTransactionReceipt: vi.fn(async () => ({})) };
  walletWrites = { chain: { id: 31337 }, writeContract: vi.fn(async () => HASH) };
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(useReadContract).mockImplementation(((parameters?: {
    functionName?: string;
  }) =>
    parameters?.functionName === "availableBond"
      ? availableRead
      : depositedRead) as never);
  vi.mocked(usePublicClient).mockReturnValue(
    receipts as unknown as ReturnType<typeof usePublicClient>
  );
  vi.mocked(useWalletClient).mockReturnValue({
    data: walletWrites,
  } as unknown as ReturnType<typeof useWalletClient>);
  vi.mocked(useWalletAccount).mockReturnValue({
    activeChainId: 31337,
    address: ACCOUNT,
  } as ReturnType<typeof useWalletAccount>);
});

describe("useReviewBond reads", () => {
  it("passes the vault balances through when enabled", () => {
    const { result } = renderHook(() => useReviewBond());

    expect(result.current.enabled).toBe(true);
    expect(result.current.availableWad).toBe(3n * WAD);
    expect(result.current.depositedWad).toBe(5n * WAD);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBeNull();
    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({
        abi: reviewBondVaultAbi,
        address: VAULT,
        args: [ACCOUNT],
        functionName: "availableBond",
        query: { enabled: true },
      })
    );
    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({
        abi: reviewBondVaultAbi,
        address: VAULT,
        args: [ACCOUNT],
        functionName: "depositedOf",
        query: { enabled: true },
      })
    );
  });

  it("reports null balances until the reads land", () => {
    availableRead.data = undefined;
    depositedRead.data = undefined;

    const { result } = renderHook(() => useReviewBond());

    expect(result.current.enabled).toBe(true);
    expect(result.current.availableWad).toBeNull();
    expect(result.current.depositedWad).toBeNull();
  });

  it.each([
    [
      "no contract config",
      () => vi.mocked(getPopChartsContractConfig).mockReturnValue(null),
    ],
    [
      "no vault deployed",
      () =>
        vi.mocked(getPopChartsContractConfig).mockReturnValue({
          ...contractConfig,
          reviewBondVaultAddress: null,
        }),
    ],
    [
      "no connected wallet",
      () =>
        vi.mocked(useWalletAccount).mockReturnValue({
          activeChainId: null,
          address: null,
        } as unknown as ReturnType<typeof useWalletAccount>),
    ],
  ])("stays disabled with null balances when %s", (_label, arrange) => {
    arrange();

    const { result } = renderHook(() => useReviewBond());

    expect(result.current.enabled).toBe(false);
    expect(result.current.availableWad).toBeNull();
    expect(result.current.depositedWad).toBeNull();
    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({ query: { enabled: false } })
    );
  });

  it("omits the read args until a wallet address exists", () => {
    vi.mocked(useWalletAccount).mockReturnValue({
      activeChainId: null,
      address: null,
    } as unknown as ReturnType<typeof useWalletAccount>);

    renderHook(() => useReviewBond());

    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({ args: undefined })
    );
  });

  it("refetches both balances on refresh", () => {
    const { result } = renderHook(() => useReviewBond());

    act(() => {
      result.current.refresh();
    });

    expect(availableRead.refetch).toHaveBeenCalledTimes(1);
    expect(depositedRead.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("useReviewBond writes", () => {
  it("deposits with native value, waits for the receipt, and refreshes", async () => {
    const { result } = renderHook(() => useReviewBond());

    act(() => {
      result.current.deposit(2n * WAD);
    });

    expect(result.current.status).toBe("pending");

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(walletWrites.writeContract).toHaveBeenCalledWith({
      abi: reviewBondVaultAbi,
      account: ACCOUNT,
      address: VAULT,
      chain: walletWrites.chain,
      functionName: "depositBond",
      value: 2n * WAD,
    });
    expect(receipts.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: HASH,
    });
    expect(availableRead.refetch).toHaveBeenCalledTimes(1);
    expect(depositedRead.refetch).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it("withdraws the requested amount", async () => {
    const { result } = renderHook(() => useReviewBond());

    act(() => {
      result.current.withdraw(WAD);
    });

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(walletWrites.writeContract).toHaveBeenCalledWith({
      abi: reviewBondVaultAbi,
      account: ACCOUNT,
      address: VAULT,
      args: [WAD],
      chain: walletWrites.chain,
      functionName: "withdrawBond",
    });
  });

  it("refuses to write without a connected wallet client", () => {
    vi.mocked(useWalletClient).mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useWalletClient>);
    const { result } = renderHook(() => useReviewBond());

    act(() => {
      result.current.deposit(WAD);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Connect a wallet to manage your review bond.");
    expect(walletWrites.writeContract).not.toHaveBeenCalled();
  });

  it("surfaces a failed write through the fallback copy", async () => {
    walletWrites.writeContract.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useReviewBond());

    act(() => {
      result.current.deposit(WAD);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe(
      "The bond transaction did not go through — try again."
    );
    expect(availableRead.refetch).not.toHaveBeenCalled();
    expect(depositedRead.refetch).not.toHaveBeenCalled();
  });
});

type ContractReadStub = {
  data: bigint | undefined;
  refetch: ReturnType<typeof vi.fn>;
};
