import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import { describe, expect, it, vi } from "vitest";

import type { PopChartsContractConfig } from "./config";
import { completeSetBinaryMarketAbi } from "./postgrad-venue";
import {
  getRedemptionErrorMessage,
  readRedeemableAmount,
  submitRedemption,
} from "./redemption-service";

const WAD = 10n ** 18n;
const ACCOUNT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const MARKET = "0x2222222222222222222222222222222222222222" as const;
const REDEMPTION_HASH = `0x${"cc".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

describe("readRedeemableAmount", () => {
  it("rounds outcome-token dust down to collateral precision", async () => {
    const readContract = vi.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(18);

    await expect(
      readRedeemableAmount({
        amount: 24n * WAD + 123n,
        marketAddress: MARKET,
        publicClient: { readContract } as unknown as PublicClient,
      })
    ).resolves.toBe(24n * WAD);
  });

  it("passes the amount through when outcome and collateral decimals match", async () => {
    const readContract = vi.fn().mockResolvedValue(18);

    await expect(
      readRedeemableAmount({
        amount: 24n * WAD + 123n,
        marketAddress: MARKET,
        publicClient: { readContract } as unknown as PublicClient,
      })
    ).resolves.toBe(24n * WAD + 123n);
  });
});

describe("submitRedemption", () => {
  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(
      submitRedemption({
        amount: 24n * WAD,
        config: contractConfig,
        marketAddress: MARKET,
        side: "yes",
        wallet,
      })
    ).rejects.toThrow("Switch your wallet to chain 31337.");
    expect(wallet.walletClient.writeContract).not.toHaveBeenCalled();
  });

  it.each([
    ["yes", 0],
    ["no", 1],
  ] as const)(
    "redeems the %s side and returns the confirmed amounts and hash",
    async (side, contractSide) => {
      const { clients, wallet } = mockWallet();

      const result = await submitRedemption({
        amount: 24n * WAD + 123n,
        config: contractConfig,
        marketAddress: MARKET,
        side,
        wallet,
      });

      expect(result).toEqual({
        collateralAmount: 24n * WAD,
        outcomeAmount: 24n * WAD,
        transactionHash: REDEMPTION_HASH,
      });
      expect(clients.writeContract).toHaveBeenCalledWith({
        abi: completeSetBinaryMarketAbi,
        account: ACCOUNT,
        address: MARKET,
        chain: undefined,
        functionName: "redeem",
        args: [contractSide, 24n * WAD],
      });
      expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
        hash: REDEMPTION_HASH,
      });
    }
  );

  it("fails when rounding leaves nothing redeemable", async () => {
    const { clients, wallet } = mockWallet();

    await expect(
      submitRedemption({
        amount: 123n,
        config: contractConfig,
        marketAddress: MARKET,
        side: "yes",
        wallet,
      })
    ).rejects.toThrow("Nothing to redeem for this position.");
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("fails when the transaction confirms without the matching event", async () => {
    const { clients, wallet } = mockWallet();
    clients.logs = [
      redeemedLog({ account: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
    ];

    await expect(
      submitRedemption({
        amount: 24n * WAD,
        config: contractConfig,
        marketAddress: MARKET,
        side: "yes",
        wallet,
      })
    ).rejects.toThrow("Transaction succeeded but Redeemed was not emitted.");
  });
});

describe("getRedemptionErrorMessage", () => {
  it("explains a losing-side redemption", () => {
    expect(
      getRedemptionErrorMessage(new Error("reverted: LosingSideCannotRedeem()"))
    ).toBe("These tokens are on the losing side, so they cannot be redeemed.");
  });

  it("explains a market that is not redeemable yet", () => {
    expect(getRedemptionErrorMessage(new Error("reverted: InvalidStatus()"))).toBe(
      "This market is not redeemable on-chain yet. Refresh to see the updated status."
    );
  });

  it("falls back to a generic message for unknown failures", () => {
    expect(getRedemptionErrorMessage(new Error("network down"))).toBe(
      "Could not claim your winnings."
    );
  });
});

type MockClients = {
  logs: ReturnType<typeof redeemedLog>[];
  readContract: ReturnType<typeof vi.fn>;
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet() {
  const clients: MockClients = {
    logs: [redeemedLog()],
    readContract: vi.fn().mockResolvedValueOnce(6).mockResolvedValueOnce(18),
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  clients.writeContract.mockResolvedValue(REDEMPTION_HASH);
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === REDEMPTION_HASH ? clients.logs : [],
    })
  );

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

// A genuinely ABI-encoded Redeemed log so the service exercises the real
// viem parseEventLogs decoding path instead of a mocked decoder.
function redeemedLog({ account = ACCOUNT }: { account?: `0x${string}` } = {}) {
  return {
    address: MARKET,
    data: encodeAbiParameters(
      [
        { name: "outcomeAmount", type: "uint256" },
        { name: "collateralAmount", type: "uint256" },
      ],
      [24n * WAD, 24n * WAD]
    ),
    topics: encodeEventTopics({
      abi: completeSetBinaryMarketAbi,
      eventName: "Redeemed",
      args: { account, side: 0 },
    }),
  };
}
