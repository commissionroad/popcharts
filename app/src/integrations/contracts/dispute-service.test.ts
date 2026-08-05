import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "./config";
import {
  disputeResolution,
  type DisputeStep,
  getDisputeErrorMessage,
} from "./dispute-service";
import { erc20Abi } from "./erc20";
import { completeSetBinaryMarketAbi, POSTGRAD_MARKET_STATUS } from "./postgrad-venue";

const WAD = 10n ** 18n;
const BOND = 100n * WAD;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const RESOLVER = "0x4444444444444444444444444444444444444444" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const COLLATERAL = "0x3333333333333333333333333333333333333333" as const;
const DEADLINE = 1_700_000_000n;
const APPROVAL_HASH = `0x${"ab".repeat(32)}` as const;
const DISPUTE_HASH = `0x${"cd".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  reviewCreditVaultAddress: null,
  rpcUrl: "http://127.0.0.1:8545",
};

describe("disputeResolution", () => {
  it("requires the wallet to be on the configured chain", async () => {
    const { clients, wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(dispute(wallet)).rejects.toThrow("Switch your wallet to chain 31337.");
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("approves the market for the bond, disputes, and confirms the event", async () => {
    const { clients, wallet } = mockWallet();
    const steps: DisputeStep[] = [];

    const result = await dispute(wallet, (step) => steps.push(step));

    expect(result.bond).toBe(BOND);
    expect(result.disputer.toLowerCase()).toBe(ACCOUNT);
    expect(result.transactionHash).toBe(DISPUTE_HASH);

    // The market pulls the bond itself, so the approval spender is the market.
    expect(clients.writeContract).toHaveBeenNthCalledWith(1, {
      abi: erc20Abi,
      account: ACCOUNT,
      address: COLLATERAL,
      chain: undefined,
      functionName: "approve",
      args: [MARKET, BOND],
    });
    expect(clients.writeContract).toHaveBeenNthCalledWith(2, {
      abi: completeSetBinaryMarketAbi,
      account: ACCOUNT,
      address: MARKET,
      chain: undefined,
      functionName: "dispute",
    });
    expect(steps).toEqual(["approving", "disputing", "confirming"]);
  });

  it("skips the approval when the allowance already covers the bond", async () => {
    const { clients, wallet } = mockWallet({ allowance: BOND });
    const steps: DisputeStep[] = [];

    await dispute(wallet, (step) => steps.push(step));

    expect(clients.writeContract).toHaveBeenCalledTimes(1);
    expect(steps).toEqual(["disputing", "confirming"]);
  });

  it("skips the approval entirely for the resolver's free self-dispute", async () => {
    const { clients, wallet } = mockWallet({ account: RESOLVER });
    clients.logs = [disputedLog({ bond: 0n, disputer: RESOLVER })];

    await expect(dispute(wallet)).resolves.toMatchObject({ bond: 0n });

    expect(clients.writeContract).toHaveBeenCalledTimes(1);
    expect(clients.readContract).not.toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "allowance" })
    );
  });

  it("skips the approval on a market configured with no bond", async () => {
    const { clients, wallet } = mockWallet({ bond: 0n });
    clients.logs = [disputedLog({ bond: 0n })];

    await dispute(wallet);

    expect(clients.writeContract).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["disputed", POSTGRAD_MARKET_STATUS.disputed],
    ["already resolved", POSTGRAD_MARKET_STATUS.resolved],
    ["still trading", POSTGRAD_MARKET_STATUS.trading],
  ])("refuses to dispute a market that is %s", async (_label, status) => {
    const { clients, wallet } = mockWallet({ status });

    await expect(dispute(wallet)).rejects.toThrow(
      "This resolution is no longer open to dispute. Refresh to see the updated status."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("reports a wallet that cannot cover the bond as a balance problem", async () => {
    const { clients, wallet } = mockWallet({ balance: 5n * WAD });

    await expect(dispute(wallet)).rejects.toThrow(
      "Insufficient balance. You have 5.00 collateral, but this transaction spends 100."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("reads the shortfall at the market's own collateral precision", async () => {
    // 5 vs 100 native USDC. Formatted at the house 18 decimals both amounts
    // render "0.00", so the message says nothing at all.
    const { clients, wallet } = mockWallet({
      balance: 5_000_000n,
      bond: 100_000_000n,
      collateralDecimals: 6,
    });

    await expect(dispute(wallet)).rejects.toThrow(
      "Insufficient balance. You have 5.00 collateral, but this transaction spends 100."
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("fails when the transaction confirms without the caller's dispute event", async () => {
    const { clients, wallet } = mockWallet();
    clients.logs = [disputedLog({ disputer: RESOLVER })];

    await expect(dispute(wallet)).rejects.toThrow(
      "Transaction succeeded but ResolutionDisputed was not emitted."
    );
  });
});

describe("getDisputeErrorMessage", () => {
  it("explains a window that closed before the transaction landed", () => {
    expect(
      getDisputeErrorMessage(new Error("reverted: DisputeWindowClosed(1700000000)"))
    ).toBe(
      "The dispute window closed before this transaction landed, so the proposed outcome stands."
    );
  });

  it.each(["InvalidStatus(4, 3)", "InvalidStatusForAction(1)"])(
    "explains a market whose status moved on (%s)",
    (revert) => {
      expect(getDisputeErrorMessage(new Error(`reverted: ${revert}`))).toBe(
        "This resolution is no longer open to dispute. Refresh to see the updated status."
      );
    }
  );

  // Both of these are thrown through the real service, so the assertion pins
  // what the panel actually renders rather than a hand-built error of the
  // right class. As plain Errors they collapsed to the generic fallback.
  it("shows a wrong-chain wallet the chain to switch to", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(dispute(wallet).catch(getDisputeErrorMessage)).resolves.toBe(
      "Switch your wallet to chain 31337."
    );
  });

  it("shows a wallet that cannot cover the bond the shortfall", async () => {
    const { wallet } = mockWallet({ balance: 0n });

    await expect(dispute(wallet).catch(getDisputeErrorMessage)).resolves.toBe(
      "Insufficient balance. You have 0 collateral, but this transaction spends 100."
    );
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(getDisputeErrorMessage(new Error("network down"))).toBe(
      "Could not dispute this resolution."
    );
  });
});

function dispute(
  wallet: Parameters<typeof disputeResolution>[0]["wallet"],
  onStep?: (step: DisputeStep) => void
) {
  return disputeResolution({
    config: contractConfig,
    marketAddress: MARKET,
    ...(onStep ? { onStep } : {}),
    wallet,
  });
}

type MockClients = {
  logs: ReturnType<typeof disputedLog>[];
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet({
  account = ACCOUNT,
  allowance = 0n,
  balance = 500n * WAD,
  bond = BOND,
  collateralDecimals = 18,
  disputer = ACCOUNT,
  proposedSide = 0,
  status = POSTGRAD_MARKET_STATUS.resolutionPending,
}: {
  account?: `0x${string}`;
  allowance?: bigint;
  balance?: bigint;
  bond?: bigint;
  collateralDecimals?: number;
  disputer?: `0x${string}`;
  proposedSide?: number;
  status?: number;
} = {}) {
  const marketReads: Record<string, unknown> = {
    collateralDecimals,
    collateralToken: COLLATERAL,
    disputeBond: bond,
    disputeBondHeld: 0n,
    disputeDeadline: DEADLINE,
    disputer,
    proposedSide,
    resolver: RESOLVER,
    status,
  };
  const collateralReads: Record<string, unknown> = { allowance, balanceOf: balance };
  const clients: MockClients = {
    logs: [disputedLog()],
    readContract: vi.fn(
      async ({ address, functionName }: { address: string; functionName: string }) => {
        const value =
          address === MARKET
            ? marketReads[functionName]
            : collateralReads[functionName];

        if (value === undefined) {
          throw new Error(`Unexpected read ${functionName} on ${address}`);
        }

        return value;
      }
    ),
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  clients.writeContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "dispute" ? DISPUTE_HASH : APPROVAL_HASH
  );
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === DISPUTE_HASH ? clients.logs : [],
    })
  );

  const wallet = {
    accountAddress: account,
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

// A genuinely ABI-encoded ResolutionDisputed log so the service exercises the
// real viem parseEventLogs decoding path instead of a mocked decoder.
function disputedLog({
  bond = BOND,
  disputer = ACCOUNT,
}: { bond?: bigint; disputer?: `0x${string}` } = {}) {
  return {
    address: MARKET,
    data: encodeAbiParameters([{ name: "bond", type: "uint256" }], [bond]),
    topics: encodeEventTopics({
      abi: completeSetBinaryMarketAbi,
      eventName: "ResolutionDisputed",
      args: { disputer },
    }),
  };
}
