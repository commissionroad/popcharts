import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "./config";
import { pregradManagerAbi } from "./pregrad-manager";
import { getRefundClaimErrorMessage, submitRefundClaim } from "./refund-claim-service";

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const CLAIM_HASH = `0x${"cc".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

describe("submitRefundClaim", () => {
  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(
      submitRefundClaim({ config: contractConfig, receiptId: 32n, wallet })
    ).rejects.toThrow("Switch your wallet to chain 31337.");
    expect(wallet.walletClient.writeContract).not.toHaveBeenCalled();
  });

  it("claims the receipt and returns the confirmed refund and hash", async () => {
    const { clients, wallet } = mockWallet();

    const result = await submitRefundClaim({
      config: contractConfig,
      receiptId: 32n,
      wallet,
    });

    expect(result).toEqual({ refund: 24n * WAD, transactionHash: CLAIM_HASH });
    const call = clients.writeContract.mock.calls[0]![0] as {
      args: unknown[];
      functionName: string;
    };
    expect(call.functionName).toBe("claimRefundedReceipt");
    expect(call.args).toEqual([32n]);
  });

  it("fails when the transaction confirms without the claimed event", async () => {
    const { clients, wallet } = mockWallet();
    clients.logs = [];

    await expect(
      submitRefundClaim({ config: contractConfig, receiptId: 32n, wallet })
    ).rejects.toThrow(
      "Transaction succeeded but RefundedReceiptClaimed was not emitted."
    );
  });

  it("ignores claimed events for other receipts", async () => {
    const { clients, wallet } = mockWallet();
    clients.logs = [refundClaimedLog({ receiptId: 999n })];

    await expect(
      submitRefundClaim({ config: contractConfig, receiptId: 32n, wallet })
    ).rejects.toThrow(
      "Transaction succeeded but RefundedReceiptClaimed was not emitted."
    );
  });
});

describe("getRefundClaimErrorMessage", () => {
  it("explains an already-claimed refund as a stale row", () => {
    expect(
      getRefundClaimErrorMessage(new Error("reverted: ReceiptAlreadyClaimed()"))
    ).toBe("This refund has already been claimed. Refresh to see the updated status.");
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(getRefundClaimErrorMessage(new Error("network down"))).toBe(
      "Could not claim your refund."
    );
  });
});

type MockClients = {
  logs: ReturnType<typeof refundClaimedLog>[];
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet() {
  const clients: MockClients = {
    logs: [refundClaimedLog()],
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  clients.writeContract.mockResolvedValue(CLAIM_HASH);
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === CLAIM_HASH ? clients.logs : [],
    })
  );

  const wallet = {
    accountAddress: ACCOUNT,
    activeChainId: 31337,
    publicClient: {
      waitForTransactionReceipt: clients.waitForTransactionReceipt,
    } as unknown as PublicClient,
    walletClient: {
      chain: undefined,
      writeContract: clients.writeContract,
    } as unknown as WalletClient,
  };

  return { clients, wallet };
}

// A genuinely ABI-encoded RefundedReceiptClaimed log so the service exercises
// the real viem parseEventLogs decoding path instead of a mocked decoder.
function refundClaimedLog(overrides: { receiptId?: bigint } = {}) {
  return {
    address: contractConfig.pregradManagerAddress,
    data: encodeAbiParameters([{ name: "refund", type: "uint256" }], [24n * WAD]),
    topics: encodeEventTopics({
      abi: pregradManagerAbi,
      eventName: "RefundedReceiptClaimed",
      args: {
        marketId: 7n,
        owner: ACCOUNT,
        receiptId: overrides.receiptId ?? 32n,
      },
    }),
  };
}
