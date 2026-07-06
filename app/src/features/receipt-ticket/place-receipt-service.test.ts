import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics, parseUnits } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market } from "@/domain/markets/types";
import type { ReceiptQuotePreview } from "@/domain/pregrad-trading/receipt-quote";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";
import { marketFactory } from "@/test/factories/markets";

import {
  canMintLocalCollateral,
  mintLocalCollateral,
  placePregradReceipt,
  type ReceiptPlacementStep,
  resolveTradingEnvironment,
} from "./place-receipt-service";

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const APPROVE_HASH = `0x${"aa".repeat(32)}` as const;
const PLACE_HASH = `0x${"bb".repeat(32)}` as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x0000000000000000000000000000000000000002",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

beforeEach(() => {
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("resolveTradingEnvironment", () => {
  it("selects contract trading when market and config chains agree", () => {
    const environment = resolveTradingEnvironment(contractMarket());

    expect(environment).toEqual({
      config: contractConfig,
      kind: "contract",
      marketId: 7n,
    });
  });

  it("falls back to mock without a contract config", () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);

    expect(resolveTradingEnvironment(contractMarket())).toEqual({ kind: "mock" });
  });

  it("falls back to mock when the market id is not chain-scoped", () => {
    const market = contractMarket({ id: "eth-5000-august" });

    expect(resolveTradingEnvironment(market)).toEqual({ kind: "mock" });
  });

  it("falls back to mock when the market lives on another chain", () => {
    const market = contractMarket({ chainId: 1, id: "1:7" });

    expect(resolveTradingEnvironment(market)).toEqual({ kind: "mock" });
  });

  it("falls back to mock when the id chain disagrees with the config", () => {
    const market = contractMarket({ id: "1:7" });

    expect(resolveTradingEnvironment(market)).toEqual({ kind: "mock" });
  });
});

describe("placePregradReceipt in the mock environment", () => {
  it("simulates a placement and returns a waiting receipt", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    vi.useFakeTimers();

    const market = contractMarket();
    const placement = placePregradReceipt({
      market,
      quote: quotePreview(),
      side: "no",
    });

    await vi.advanceTimersByTimeAsync(200);
    const receipt = await placement;

    expect(receipt.id.startsWith(`${market.id}:mock-`)).toBe(true);
    expect(receipt.marketId).toBe(market.id);
    expect(receipt.marketQuestion).toBe(market.question);
    expect(receipt.collateralUsd).toBe(100);
    expect(receipt.shares).toBe(192);
    expect(receipt.side).toBe("no");
    expect(receipt.status).toBe("waiting");
    expect(receipt.transactionHash).toBeUndefined();
  });
});

describe("placePregradReceipt on the contract", () => {
  it("requires a connected wallet", async () => {
    await expect(
      placePregradReceipt({
        market: contractMarket(),
        quote: quotePreview(),
        side: "yes",
      })
    ).rejects.toThrow("Connect a wallet before placing a receipt.");
  });

  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Switch your wallet to chain 31337."
    );
  });

  it("rejects markets the current PregradManager does not know", async () => {
    const { clients, wallet } = mockWallet();
    clients.reads.marketExists = false;

    await expect(placeWith({ wallet })).rejects.toThrow(
      "This market is not available on the current PregradManager. Create a new local market and try again."
    );
  });

  it("rejects placement when the balance cannot cover the max cost", async () => {
    const { clients, wallet } = mockWallet();
    clients.reads.balanceOf = 5n * WAD;

    await expect(placeWith({ wallet })).rejects.toThrow(
      /Insufficient pUSD\. You have 5\.00 pUSD available/
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("skips the approval transaction when the allowance already covers cost", async () => {
    const steps: ReceiptPlacementStep[] = [];
    const { clients, wallet } = mockWallet();
    clients.reads.allowance = 1_000n * WAD;

    await placeWith({ onStep: (step) => steps.push(step), wallet });

    expect(steps).toEqual(["quoting", "placing", "confirming"]);
    expect(writeCalls(clients).map((call) => call.functionName)).toEqual([
      "placeReceipt",
    ]);
  });

  it("approves the exact max cost before placing when allowance is short", async () => {
    const steps: ReceiptPlacementStep[] = [];
    const { clients, wallet } = mockWallet();

    await placeWith({ onStep: (step) => steps.push(step), wallet });

    const calls = writeCalls(clients);

    expect(steps).toEqual(["quoting", "approving", "placing", "confirming"]);
    expect(calls.map((call) => call.functionName)).toEqual(["approve", "placeReceipt"]);
    // 100 pUSD quote with the default 150 bps slippage buffer = 101.5 pUSD.
    expect(calls[0]?.args).toEqual([
      contractConfig.pregradManagerAddress,
      (1_015n * WAD) / 10n,
    ]);
    expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: APPROVE_HASH,
    });
  });

  it("rounds the slippage buffer up to the next base unit", async () => {
    const { clients, wallet } = mockWallet();
    clients.reads.quoteReceipt = { cost: 1n, rHigh: 1n, rLow: 0n };
    clients.reads.allowance = 1_000n * WAD;

    await placeWith({ slippageBps: 1, wallet });

    const placeCall = writeCalls(clients).find(
      (call) => call.functionName === "placeReceipt"
    );
    const [request] = placeCall?.args as [{ maxCost: bigint }];

    // ceil(1 * 10001 / 10000) = 2
    expect(request.maxCost).toBe(2n);
  });

  it("fails when the transaction confirms without a ReceiptPlaced event", async () => {
    const { clients, wallet } = mockWallet();
    clients.placementLogs = [];

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Transaction succeeded but ReceiptPlaced was not emitted."
    );
  });

  it("ignores ReceiptPlaced events from other markets", async () => {
    const { clients, wallet } = mockWallet();
    clients.placementLogs = [receiptPlacedLog({ marketId: 999n })];

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Transaction succeeded but ReceiptPlaced was not emitted."
    );
  });

  it("maps the confirmed event into a placed receipt", async () => {
    const { wallet } = mockWallet();
    const market = contractMarket();

    const receipt = await placeWith({ market, wallet });

    expect(receipt.id).toBe("31337:12");
    expect(receipt.receiptId).toBe("12");
    expect(receipt.sequence).toBe("3");
    expect(receipt.marketId).toBe(market.id);
    expect(receipt.transactionHash).toBe(PLACE_HASH);
    expect(receipt.status).toBe("waiting");
    expect(receipt.collateralUsd).toBe(100);
    // The on-chain cost (100 pUSD) repriced over the quoted 192 shares.
    expect(receipt.averagePriceCents).toBeCloseTo((100 / 192) * 100, 10);
    expect(receipt.priceBand).toEqual(quotePreview().priceBand);
  });

  it("falls back to the quoted average price for zero-share quotes", async () => {
    const { wallet } = mockWallet();

    const receipt = await placeWith({
      quote: { ...quotePreview(), shares: 0 },
      wallet,
    });

    expect(receipt.averagePriceCents).toBe(52);
  });

  it("places NO receipts with side index 1", async () => {
    const { clients, wallet } = mockWallet();

    const receipt = await placeWith({ side: "no", wallet });

    const placeCall = writeCalls(clients).find(
      (call) => call.functionName === "placeReceipt"
    );
    const [request] = placeCall?.args as [{ side: number }];

    expect(request.side).toBe(1);
    expect(receipt.side).toBe("no");
  });
});

describe("mintLocalCollateral", () => {
  it("refuses to mint outside local dev chains", async () => {
    const { wallet } = mockWallet();

    await expect(
      mintLocalCollateral({
        amountUsd: 500,
        config: { ...contractConfig, chainEnv: "arc-testnet" },
        wallet,
      })
    ).rejects.toThrow("Test pUSD minting is only available on local dev chains.");
  });

  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockWallet();
    wallet.activeChainId = 1;

    await expect(
      mintLocalCollateral({ amountUsd: 500, config: contractConfig, wallet })
    ).rejects.toThrow("Switch your wallet to chain 31337.");
  });

  it("mints to the connected account and waits for confirmation", async () => {
    const steps: ReceiptPlacementStep[] = [];
    const { clients, wallet } = mockWallet();

    await mintLocalCollateral({
      amountUsd: 500.5,
      config: contractConfig,
      onStep: (step) => steps.push(step),
      wallet,
    });

    const mintCall = writeCalls(clients).find((call) => call.functionName === "mint");

    expect(steps).toEqual(["minting"]);
    expect(mintCall?.args).toEqual([ACCOUNT, parseUnits("500.5", 18)]);
    expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: PLACE_HASH,
    });
  });
});

describe("canMintLocalCollateral", () => {
  it.each([
    ["local", true],
    ["mock", true],
    ["arc-testnet", false],
    ["preview", false],
    ["production", false],
    ["testnet", false],
  ] as const)("chain env %s -> %s", (chainEnv, expected) => {
    expect(canMintLocalCollateral({ ...contractConfig, chainEnv })).toBe(expected);
  });
});

type MockClients = {
  placementLogs: ReturnType<typeof receiptPlacedLog>[];
  reads: {
    allowance: bigint;
    balanceOf: bigint;
    marketExists: boolean;
    quoteReceipt: { cost: bigint; rHigh: bigint; rLow: bigint };
  };
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockWallet() {
  const clients: MockClients = {
    placementLogs: [receiptPlacedLog()],
    reads: {
      allowance: 0n,
      balanceOf: 1_000n * WAD,
      marketExists: true,
      quoteReceipt: { cost: 100n * WAD, rHigh: 5n, rLow: 0n },
    },
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "allowance":
        return clients.reads.allowance;
      case "balanceOf":
        return clients.reads.balanceOf;
      case "marketExists":
        return clients.reads.marketExists;
      case "quoteReceipt":
        return clients.reads.quoteReceipt;
      default:
        throw new Error(`Unexpected read: ${functionName}`);
    }
  });

  clients.writeContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "approve" ? APPROVE_HASH : PLACE_HASH
  );
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === PLACE_HASH ? clients.placementLogs : [],
    })
  );

  const wallet = {
    accountAddress: ACCOUNT,
    activeChainId: 31337,
    publicClient: {
      readContract,
      waitForTransactionReceipt: clients.waitForTransactionReceipt,
    } as unknown as PublicClient,
    walletClient: {
      chain: undefined,
      writeContract: clients.writeContract,
    } as unknown as WalletClient,
  };

  return { clients, wallet };
}

function placeWith({
  market = contractMarket(),
  onStep,
  quote = quotePreview(),
  side = "yes",
  slippageBps,
  wallet,
}: {
  market?: Market;
  onStep?: (step: ReceiptPlacementStep) => void;
  quote?: ReceiptQuotePreview;
  side?: "no" | "yes";
  slippageBps?: number;
  wallet?: ReturnType<typeof mockWallet>["wallet"];
} = {}) {
  return placePregradReceipt({
    market,
    options: {
      ...(onStep ? { onStep } : {}),
      ...(slippageBps === undefined ? {} : { slippageBps }),
      ...(wallet ? { wallet } : {}),
    },
    quote,
    side,
  });
}

function writeCalls(clients: MockClients) {
  return clients.writeContract.mock.calls.map(
    (call) => call[0] as { args: unknown[]; functionName: string }
  );
}

// A genuinely ABI-encoded ReceiptPlaced log so the service exercises the real
// viem parseEventLogs decoding path instead of a mocked decoder.
function receiptPlacedLog(overrides: { marketId?: bigint } = {}) {
  return {
    address: contractConfig.pregradManagerAddress,
    data: encodeAbiParameters(
      [
        { name: "side", type: "uint8" },
        { name: "shares", type: "uint256" },
        { name: "cost", type: "uint256" },
        { name: "rLow", type: "int256" },
        { name: "rHigh", type: "int256" },
        { name: "sequence", type: "uint64" },
      ],
      [0, 192n * WAD, 100n * WAD, 0n, 5n, 3n]
    ),
    topics: encodeEventTopics({
      abi: pregradManagerAbi,
      eventName: "ReceiptPlaced",
      args: {
        marketId: overrides.marketId ?? 7n,
        owner: ACCOUNT,
        receiptId: 12n,
      },
    }),
  };
}

function contractMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    chainId: 31337,
    id: "31337:7",
    status: "bootstrap",
    ...overrides,
  });
}

function quotePreview(): ReceiptQuotePreview {
  return {
    averagePriceCents: 52,
    budgetUsd: 100,
    maxCostUsd: 101.5,
    priceBand: { fromProbability: 50, toProbability: 54 },
    priceImpactCents: 4,
    shares: 192,
    side: "yes",
  };
}
