import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublicClient, useWalletClient } from "wagmi";

import {
  canMintLocalCollateral,
  mintLocalCollateral,
} from "@/features/receipt-ticket/place-receipt-service";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import type { WalletAccountValue } from "@/integrations/wallet/wallet-provider";
import { useWalletAccount } from "@/integrations/wallet/wallet-provider";

import { TEST_PUSD_MINTED_EVENT } from "./test-pusd-events";
import { useTestPusdMint } from "./use-test-pusd-mint";

vi.mock("wagmi", () => ({
  usePublicClient: vi.fn(),
  useWalletClient: vi.fn(),
}));

vi.mock("@/integrations/contracts/config", () => ({
  getPopChartsContractConfig: vi.fn(),
}));

vi.mock("@/integrations/wallet/wallet-provider", () => ({
  useWalletAccount: vi.fn(),
}));

vi.mock("@/features/receipt-ticket/place-receipt-service", () => ({
  canMintLocalCollateral: vi.fn(() => true),
  mintLocalCollateral: vi.fn(async () => undefined),
}));

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(canMintLocalCollateral).mockReturnValue(true);
  vi.mocked(mintLocalCollateral).mockResolvedValue(undefined);
  vi.mocked(useWalletAccount).mockReturnValue(walletState());
  vi.mocked(usePublicClient).mockReturnValue({
    kind: "public-client",
  } as unknown as ReturnType<typeof usePublicClient>);
  vi.mocked(useWalletClient).mockReturnValue({
    data: { kind: "wallet-client" },
  } as unknown as ReturnType<typeof useWalletClient>);
});

describe("useTestPusdMint", () => {
  it("mints local test pUSD and broadcasts a balance refresh event", async () => {
    const onMinted = vi.fn();
    window.addEventListener(TEST_PUSD_MINTED_EVENT, onMinted);
    const { result } = renderHook(() => useTestPusdMint());

    await act(async () => {
      await result.current.action.onClick?.();
    });

    expect(mintLocalCollateral).toHaveBeenCalledWith(
      expect.objectContaining({
        amountUsd: 10_000,
        config: contractConfig,
        wallet: expect.objectContaining({
          accountAddress: "0x1111111111111111111111111111111111111111",
          activeChainId: 31337,
        }),
      })
    );
    expect(onMinted).toHaveBeenCalledTimes(1);
    expect(result.current.result).toEqual({
      message: "Added 10,000 test pUSD to your wallet.",
      status: "success",
    });

    window.removeEventListener(TEST_PUSD_MINTED_EVENT, onMinted);
  });

  it("offers sign-in before minting", () => {
    const login = vi.fn();
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ authenticated: false, login })
    );
    const { result } = renderHook(() => useTestPusdMint());

    expect(result.current.action.label).toBe("Sign in to get pUSD");

    act(() => result.current.action.onClick?.());

    expect(login).toHaveBeenCalledTimes(1);
    expect(mintLocalCollateral).not.toHaveBeenCalled();
  });

  it("switches to the configured chain before minting", () => {
    const switchChain = vi.fn(async () => undefined);
    vi.mocked(useWalletAccount).mockReturnValue(
      walletState({ activeChainId: 1, isSupportedChain: false, switchChain })
    );
    const { result } = renderHook(() => useTestPusdMint());

    expect(result.current.action.label).toBe("Switch to Hardhat Local");

    act(() => result.current.action.onClick?.());

    expect(switchChain).toHaveBeenCalledWith(31337);
    expect(mintLocalCollateral).not.toHaveBeenCalled();
  });

  it("disables the action when local pUSD minting is unavailable", () => {
    vi.mocked(canMintLocalCollateral).mockReturnValue(false);
    const { result } = renderHook(() => useTestPusdMint());

    expect(result.current.action).toMatchObject({
      disabled: true,
      label: "Local pUSD unavailable",
    });
  });

  it("reports mint failures", async () => {
    vi.mocked(mintLocalCollateral).mockRejectedValue(new Error("faucet dry"));
    const { result } = renderHook(() => useTestPusdMint());

    await act(async () => {
      await result.current.action.onClick?.();
    });

    expect(result.current.result).toEqual({
      message: "Could not get pUSD.",
      status: "error",
    });
  });
});

function walletState(overrides: Partial<WalletAccountValue> = {}): WalletAccountValue {
  return {
    activeChainId: 31337,
    activeChainName: "Hardhat Local",
    address: "0x1111111111111111111111111111111111111111",
    authenticated: true,
    clearError: vi.fn(),
    connectOrCreateWallet: vi.fn(),
    copyAddress: vi.fn(async () => undefined),
    defaultChain: { id: 31337, name: "Hardhat Local" },
    displayAddress: "0x111...111",
    enabled: true,
    errorMessage: null,
    isSupportedChain: true,
    linkWallet: vi.fn(),
    login: vi.fn(),
    loginLabel: "Sign in",
    logout: vi.fn(async () => undefined),
    pendingAction: null,
    ready: true,
    setActiveWallet: vi.fn(async () => undefined),
    supportedChains: [{ id: 31337, name: "Hardhat Local" }],
    switchChain: vi.fn(async () => undefined),
    userLabel: "Account",
    wallets: [],
    ...overrides,
  };
}
