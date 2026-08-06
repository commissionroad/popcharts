import type { PublicClient, WalletClient } from "viem";
import { encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "./config";
import {
  finalizeMarketResolution,
  type FinalizeStep,
  getFinalizeErrorMessage,
} from "./finalize-service";
import { completeSetBinaryMarketAbi, POSTGRAD_MARKET_STATUS } from "./postgrad-venue";

const WAD = 10n ** 18n;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const DEADLINE = 1_700_000_000n;
const FINALIZE_HASH = `0x${"ef".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewCreditVaultAddress: null,
  rpcUrl: "http://127.0.0.1:8545",
};

describe("finalizeMarketResolution", () => {
  it("requires the wallet to be on the configured chain", async () => {
    const { clients, wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(finalize(wallet)).rejects.toThrow(
      "Switch your wallet to chain 31337."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("settles the market and reports the side from the emitted event", async () => {
    const { clients, wallet } = mockWallet();
    const steps: FinalizeStep[] = [];

    const result = await finalize(wallet, (step) => steps.push(step));

    expect(result.transactionHash).toBe(FINALIZE_HASH);
    expect(result.winningSide).toBe("yes");
    expect(clients.writeContract).toHaveBeenCalledWith({
      abi: completeSetBinaryMarketAbi,
      account: ACCOUNT,
      address: MARKET,
      chain: undefined,
      functionName: "finalizeResolution",
    });
    // No approval leg: finalizing moves no collateral from the caller.
    expect(clients.writeContract).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["finalizing", "confirming"]);
  });

  it("reads the winning side rather than assuming the proposal", async () => {
    const { clients, wallet } = mockWallet({ proposedSide: 1 });
    clients.logs = [resolvedLog({ side: 1 })];

    await expect(finalize(wallet)).resolves.toMatchObject({ winningSide: "no" });
  });

  it("refuses to settle a disputed market, which only an operator can settle", async () => {
    const { clients, wallet } = mockWallet({
      status: POSTGRAD_MARKET_STATUS.disputed,
    });

    await expect(finalize(wallet)).rejects.toThrow(
      "This resolution is disputed, so it cannot be settled here. An operator settles a disputed market."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it.each([
    ["already resolved", POSTGRAD_MARKET_STATUS.resolved],
    ["still trading", POSTGRAD_MARKET_STATUS.trading],
  ])("refuses to settle a market that is %s", async (_label, status) => {
    const { clients, wallet } = mockWallet({ status });

    await expect(finalize(wallet)).rejects.toThrow(
      "This market has already been settled. Refresh to see the updated status."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("fails when the transaction confirms without a settlement event", async () => {
    const { clients, wallet } = mockWallet();
    clients.logs = [];

    await expect(finalize(wallet)).rejects.toThrow(
      "Transaction succeeded but MarketResolved was not emitted."
    );
  });
});

describe("getFinalizeErrorMessage", () => {
  it("explains a deadline that had not actually passed", () => {
    expect(
      getFinalizeErrorMessage(new Error("reverted: DisputeWindowStillOpen(1700000000)"))
    ).toBe("The dispute window has not closed yet, so this market cannot be settled.");
  });

  it.each(["InvalidStatus(4, 3)", "InvalidStatusForAction(1)"])(
    "explains losing the race to another finalizer (%s)",
    (revert) => {
      expect(getFinalizeErrorMessage(new Error(`reverted: ${revert}`))).toBe(
        "This market was settled before your transaction landed. Refresh to see the outcome."
      );
    }
  );

  // Thrown through the real service so the assertion pins what the panel
  // actually renders rather than a hand-built error of the right class.
  it("shows a wrong-chain wallet the chain to switch to", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(finalize(wallet).catch(getFinalizeErrorMessage)).resolves.toBe(
      "Switch your wallet to chain 31337."
    );
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(getFinalizeErrorMessage(new Error("network down"))).toBe(
      "Could not settle this market."
    );
  });
});

function finalize(
  wallet: Parameters<typeof finalizeMarketResolution>[0]["wallet"],
  onStep?: (step: FinalizeStep) => void
) {
  return finalizeMarketResolution({
    config: contractConfig,
    marketAddress: MARKET,
    ...(onStep ? { onStep } : {}),
    wallet,
  });
}

type MockClients = {
  logs: ReturnType<typeof resolvedLog>[];
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet({
  proposedSide = 0,
  status = POSTGRAD_MARKET_STATUS.resolutionPending,
}: {
  proposedSide?: number;
  status?: number;
} = {}) {
  const marketReads: Record<string, unknown> = {
    collateralDecimals: 18,
    disputeBond: 100n * WAD,
    disputeBondHeld: 0n,
    disputeDeadline: DEADLINE,
    disputer: "0x0000000000000000000000000000000000000000",
    proposedSide,
    resolver: RESOLVER,
    status,
  };
  const clients: MockClients = {
    logs: [resolvedLog()],
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      const value = marketReads[functionName];

      if (value === undefined) {
        throw new Error(`Unexpected read ${functionName}`);
      }

      return value;
    }),
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  clients.writeContract.mockResolvedValue(FINALIZE_HASH);
  clients.waitForTransactionReceipt.mockImplementation(async () => ({
    logs: clients.logs,
  }));

  const wallet = {
    accountAddress: ACCOUNT,
    activeChainId: 31337,
    publicClient: {
      readContract: clients.readContract,
      waitForTransactionReceipt: clients.waitForTransactionReceipt,
    } as unknown as PublicClient,
    walletClient: {
      chain: undefined,
      writeContract: clients.writeContract,
    } as unknown as WalletClient,
  };

  return { clients, wallet };
}

// A genuinely ABI-encoded MarketResolved log so the service exercises the real
// viem parseEventLogs decoding path instead of a mocked decoder. `side` is the
// event's only parameter and is indexed, so the data payload is empty.
function resolvedLog({ side = 0 }: { side?: number } = {}) {
  return {
    address: MARKET,
    data: "0x" as const,
    topics: encodeEventTopics({
      abi: completeSetBinaryMarketAbi,
      eventName: "MarketResolved",
      args: { side },
    }),
  };
}
