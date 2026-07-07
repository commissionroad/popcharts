import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReadContract } from "wagmi";

import type { PopChartsContractConfig } from "../config";
import { useTrustedCreatorStatus } from "./use-trusted-creator-status";

const configState = vi.hoisted(() => ({
  config: null as unknown,
  mode: "devchain" as string,
  signer: "wallet" as string,
}));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  getPopChartsContractConfig: () => configState.config,
  get marketCreationMode() {
    return configState.mode;
  },
  get marketCreationSigner() {
    return configState.signer;
  },
}));

vi.mock("wagmi", () => ({
  useReadContract: vi.fn(() => ({ data: true })),
}));

const WALLET = "0x1111111111111111111111111111111111111111";

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

afterEach(() => {
  vi.clearAllMocks();
  configState.config = contractConfig;
  configState.mode = "devchain";
  configState.signer = "wallet";
});

describe("useTrustedCreatorStatus", () => {
  it("reads the trusted flag for the connected wallet", () => {
    configState.config = contractConfig;

    const { result } = renderHook(() =>
      useTrustedCreatorStatus({ walletAddress: WALLET })
    );

    expect(result.current.data).toBe(true);
    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({
        address: contractConfig.pregradManagerAddress,
        args: [WALLET],
        chainId: 31337,
        functionName: "isTrustedCreator",
        query: { enabled: true },
      })
    );
  });

  it.each([
    ["no wallet is connected", () => renderTrusted(null)],
    [
      "the contract config is missing",
      () => {
        configState.config = null;

        return renderTrusted(WALLET);
      },
    ],
    [
      "market creation is mocked",
      () => {
        configState.mode = "mock";

        return renderTrusted(WALLET);
      },
    ],
    [
      "the server relay signs creations",
      () => {
        configState.signer = "server";

        return renderTrusted(WALLET);
      },
    ],
  ])("disables the read when %s", (_label, render) => {
    configState.config = contractConfig;
    render();

    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({ query: { enabled: false } })
    );
  });

  it("omits the args until a wallet address exists", () => {
    configState.config = contractConfig;
    renderTrusted(null);

    expect(vi.mocked(useReadContract)).toHaveBeenCalledWith(
      expect.objectContaining({ args: undefined })
    );
  });
});

function renderTrusted(walletAddress: string | null) {
  return renderHook(() => useTrustedCreatorStatus({ walletAddress }));
}
