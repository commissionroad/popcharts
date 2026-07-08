import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Market, MarketVenueInfo } from "@/domain/markets/types";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import {
  buildVenuePoolKey,
  computeVenuePoolId,
  getPostgradVenueContractConfig,
  poolManagerSwapEventAbi,
  type PostgradVenueContractConfig,
  tickToSqrtPriceX96,
} from "@/integrations/contracts/postgrad-venue";
import { marketFactory } from "@/test/factories/markets";

import {
  buildVenuePoolContext,
  placeVenueSwap,
  quoteVenueSwap,
  resolveVenueTradingEnvironment,
  venueSwapDirection,
  type VenueSwapStep,
} from "./postgrad-swap-service";

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

vi.mock("@/integrations/contracts/postgrad-venue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/postgrad-venue")>()),
  getPostgradVenueContractConfig: vi.fn(),
}));

const WAD = 10n ** 18n;
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const APPROVE_HASH = `0x${"aa".repeat(32)}` as const;
const SWAP_HASH = `0x${"bb".repeat(32)}` as const;
const HOOK = "0x00000000000000000000000000000000000000f1" as const;
// Sorts below the collateral address, so the YES outcome is currency0.
const YES_TOKEN = "0x0000000000000000000000000000000000000abc" as const;
// Sorts above the collateral address, so the NO outcome is currency1.
const NO_TOKEN = "0xffffffffffffffffffffffffffffffffffffffff" as const;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const venueConfig: PostgradVenueContractConfig = {
  orderManagerAddress: "0x00000000000000000000000000000000000000f2",
  poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
  quoterAddress: "0x00000000000000000000000000000000000000b3",
  stateViewAddress: null,
  swapRouterAddress: "0x00000000000000000000000000000000000000b1",
};

beforeEach(() => {
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
  vi.mocked(getPostgradVenueContractConfig).mockReturnValue(venueConfig);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveVenueTradingEnvironment", () => {
  it("selects contract trading for a live venue on the configured chain", () => {
    const market = venueMarket();

    expect(resolveVenueTradingEnvironment(market)).toEqual({
      config: contractConfig,
      kind: "contract",
      venue: market.postgrad?.venue,
      venueConfig,
    });
  });

  it("falls back to mock without a base contract config", () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);

    expect(resolveVenueTradingEnvironment(venueMarket())).toEqual({ kind: "mock" });
  });

  it("falls back to mock without the venue contract addresses", () => {
    vi.mocked(getPostgradVenueContractConfig).mockReturnValue(null);

    expect(resolveVenueTradingEnvironment(venueMarket())).toEqual({ kind: "mock" });
  });

  it("falls back to mock while the venue is not live", () => {
    const market = venueMarket();
    market.postgrad!.venue!.live = false;

    expect(resolveVenueTradingEnvironment(market)).toEqual({ kind: "mock" });
  });

  it("falls back to mock when the market lives on another chain", () => {
    expect(resolveVenueTradingEnvironment(venueMarket({ chainId: 1 }))).toEqual({
      kind: "mock",
    });
  });
});

describe("buildVenuePoolContext", () => {
  it("reconstructs the YES pool with the outcome token as currency0", () => {
    const pool = buildVenuePoolContext({
      collateral: contractConfig.collateralAddress,
      side: "yes",
      venue: venueInfo(),
    });

    expect(pool.outcomeIsCurrency0).toBe(true);
    expect(pool.outcomeTokenAddress).toBe(getAddress(YES_TOKEN));
    expect(pool.poolKey.currency0).toBe(getAddress(YES_TOKEN));
    expect(pool.poolId).toBe(venueInfo().yesPool.poolId);
  });

  it("reconstructs the NO pool with collateral as currency0", () => {
    const pool = buildVenuePoolContext({
      collateral: contractConfig.collateralAddress,
      side: "no",
      venue: venueInfo(),
    });

    expect(pool.outcomeIsCurrency0).toBe(false);
    expect(pool.poolKey.currency1).toBe(getAddress(NO_TOKEN));
    expect(pool.poolId).toBe(venueInfo().noPool.poolId);
  });

  it("rejects a pool whose indexed id no longer matches the key", () => {
    const venue = venueInfo();
    venue.yesPool.poolId = `0x${"99".repeat(32)}`;

    expect(() =>
      buildVenuePoolContext({
        collateral: contractConfig.collateralAddress,
        side: "yes",
        venue,
      })
    ).toThrow(/no longer matches the indexed pool/);
  });
});

describe("venueSwapDirection", () => {
  it.each([
    ["buy", true, false],
    ["buy", false, true],
    ["sell", true, true],
    ["sell", false, false],
  ] as const)(
    "%s with outcomeIsCurrency0=%s swaps zeroForOne=%s",
    (action, outcomeIsCurrency0, expected) => {
      expect(venueSwapDirection({ action, outcomeIsCurrency0 })).toBe(expected);
    }
  );
});

describe("quoteVenueSwap", () => {
  it("returns null without a configured quoter", async () => {
    const { clients } = mockClients();

    const quoted = await quoteVenueSwap({
      action: "buy",
      amountIn: 100n * WAD,
      pool: yesPool(),
      publicClient: clients.publicClient,
      venueConfig: { ...venueConfig, quoterAddress: null },
    });

    expect(quoted).toBeNull();
    expect(clients.simulateContract).not.toHaveBeenCalled();
  });

  it("simulates quoteExactInputSingle and returns the output amount", async () => {
    const { clients } = mockClients();
    clients.simulateContract.mockResolvedValue({ result: [42n * WAD, 123n] });

    const quoted = await quoteVenueSwap({
      action: "buy",
      amountIn: 100n * WAD,
      pool: yesPool(),
      publicClient: clients.publicClient,
      venueConfig,
    });

    expect(quoted).toBe(42n * WAD);
    const call = clients.simulateContract.mock.calls[0]?.[0] as {
      address: string;
      args: [{ exactAmount: bigint; zeroForOne: boolean }];
      functionName: string;
    };
    expect(call.address).toBe(venueConfig.quoterAddress);
    expect(call.functionName).toBe("quoteExactInputSingle");
    // Buying YES (outcome is currency0) pays collateral in: oneForZero.
    expect(call.args[0].zeroForOne).toBe(false);
    expect(call.args[0].exactAmount).toBe(100n * WAD);
  });
});

describe("placeVenueSwap", () => {
  it("requires the venue contracts to be configured", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { wallet } = mockClients();

    await expect(swapWith({ wallet })).rejects.toThrow(
      "Venue contracts are not configured."
    );
  });

  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockClients();
    wallet.activeChainId = 1;

    await expect(swapWith({ wallet })).rejects.toThrow(
      "Switch your wallet to chain 31337."
    );
  });

  it("rejects a buy the collateral balance cannot cover", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.balanceOf = 5n * WAD;

    await expect(swapWith({ wallet })).rejects.toThrow(
      /Insufficient balance\. You have 5\.00 pUSD/
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("names outcome tokens when a sell balance is short", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.balanceOf = 5n * WAD;

    await expect(swapWith({ action: "sell", wallet })).rejects.toThrow(
      /Insufficient balance\. You have 5\.00 outcome tokens/
    );
  });

  it("rejects swaps while the pool has no registered bounds", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.bounds = [false, 0, 0];

    await expect(swapWith({ wallet })).rejects.toThrow(/no registered price bounds/);
  });

  it("skips the approval when the router allowance already covers the input", async () => {
    const steps: VenueSwapStep[] = [];
    const { clients, wallet } = mockClients();
    clients.reads.allowance = 1_000n * WAD;

    await swapWith({ onStep: (step) => steps.push(step), wallet });

    expect(steps).toEqual(["swapping", "confirming"]);
    expect(writeCalls(clients).map((call) => call.functionName)).toEqual(["swap"]);
  });

  it("approves the router for the exact input when allowance is short", async () => {
    const steps: VenueSwapStep[] = [];
    const { clients, wallet } = mockClients();

    await swapWith({ onStep: (step) => steps.push(step), wallet });

    const calls = writeCalls(clients);

    expect(steps).toEqual(["approving", "swapping", "confirming"]);
    expect(calls.map((call) => call.functionName)).toEqual(["approve", "swap"]);
    expect(calls[0]?.address).toBe(contractConfig.collateralAddress);
    expect(calls[0]?.args).toEqual([venueConfig.swapRouterAddress, 100n * WAD]);
    expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: APPROVE_HASH,
    });
  });

  it("buys YES with exact collateral input limited at the upper bound tick", async () => {
    const { clients, wallet } = mockClients();

    await swapWith({ wallet });

    const swapCall = writeCalls(clients).find((call) => call.functionName === "swap");
    const [, params] = swapCall?.args as [
      unknown,
      { amountSpecified: bigint; sqrtPriceLimitX96: bigint; zeroForOne: boolean },
    ];

    // YES is currency0, so buying it swaps collateral (currency1) in:
    // oneForZero walks the price up toward the upper bound.
    expect(params.zeroForOne).toBe(false);
    expect(params.amountSpecified).toBe(-(100n * WAD));
    expect(params.sqrtPriceLimitX96).toBe(tickToSqrtPriceX96(120));
  });

  it("sells YES with exact token input limited at the lower bound tick", async () => {
    const { clients, wallet } = mockClients();
    clients.swapLogs = [swapLog({ amount0: -(100n * WAD), amount1: 60n * WAD })];

    await swapWith({ action: "sell", wallet });

    const swapCall = writeCalls(clients).find((call) => call.functionName === "swap");
    const [, params] = swapCall?.args as [
      unknown,
      { sqrtPriceLimitX96: bigint; zeroForOne: boolean },
    ];

    expect(params.zeroForOne).toBe(true);
    // One wei above the boundary price so a bound-stopped swap settles at
    // the bound tick instead of one below it.
    expect(params.sqrtPriceLimitX96).toBe(tickToSqrtPriceX96(-120) + 1n);
    // Selling spends the outcome token, so the approval targets it.
    expect(writeCalls(clients)[0]?.address).toBe(getAddress(YES_TOKEN));
  });

  it("maps the Swap event into the actual fill amounts", async () => {
    const { clients, wallet } = mockClients();
    clients.swapLogs = [swapLog({ amount0: 180n * WAD, amount1: -(100n * WAD) })];

    const receipt = await swapWith({ wallet });

    expect(receipt.amountIn).toBe(100n * WAD);
    expect(receipt.amountOut).toBe(180n * WAD);
    expect(receipt.partialFill).toBe(false);
    expect(receipt.requestedIn).toBe(100n * WAD);
    expect(receipt.transactionHash).toBe(SWAP_HASH);
    expect(receipt.side).toBe("yes");
    expect(receipt.action).toBe("buy");
  });

  it("flags a partial fill when the pool stopped at its price bound", async () => {
    const { clients, wallet } = mockClients();
    clients.swapLogs = [swapLog({ amount0: 90n * WAD, amount1: -(50n * WAD) })];

    const receipt = await swapWith({ wallet });

    expect(receipt.amountIn).toBe(50n * WAD);
    expect(receipt.amountOut).toBe(90n * WAD);
    expect(receipt.partialFill).toBe(true);
  });

  it("normalizes unexpected delta signs from the Swap event", async () => {
    const { clients, wallet } = mockClients();
    // Sign-flipped deltas should still surface as positive fill amounts.
    clients.swapLogs = [swapLog({ amount0: -(180n * WAD), amount1: 100n * WAD })];

    const receipt = await swapWith({ wallet });

    expect(receipt.amountIn).toBe(100n * WAD);
    expect(receipt.amountOut).toBe(180n * WAD);
  });

  it("fails when the transaction confirms without a Swap event for the pool", async () => {
    const { clients, wallet } = mockClients();
    clients.swapLogs = [swapLog({ poolId: `0x${"77".repeat(32)}` })];

    await expect(swapWith({ wallet })).rejects.toThrow(
      "Transaction confirmed but no venue fill was recorded."
    );
  });
});

type WriteCall = {
  address: string;
  args: readonly unknown[];
  functionName: string;
};

type MockClients = {
  publicClient: PublicClient;
  reads: {
    allowance: bigint;
    balanceOf: bigint;
    bounds: readonly [boolean, number, number];
  };
  simulateContract: ReturnType<typeof vi.fn>;
  swapLogs: unknown[];
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockClients() {
  const clients: MockClients = {
    publicClient: undefined as unknown as PublicClient,
    reads: {
      allowance: 0n,
      balanceOf: 1_000n * WAD,
      bounds: [true, -120, 120] as readonly [boolean, number, number],
    },
    simulateContract: vi.fn(),
    swapLogs: [swapLog()],
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
    switch (functionName) {
      case "allowance":
        return clients.reads.allowance;
      case "balanceOf":
        return clients.reads.balanceOf;
      case "getPoolTickBounds":
        return clients.reads.bounds;
      default:
        throw new Error(`Unexpected read: ${functionName}`);
    }
  });

  clients.writeContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "approve" ? APPROVE_HASH : SWAP_HASH
  );
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === SWAP_HASH ? clients.swapLogs : [],
    })
  );

  clients.publicClient = {
    readContract,
    simulateContract: clients.simulateContract,
    waitForTransactionReceipt: clients.waitForTransactionReceipt,
  } as unknown as PublicClient;
  const wallet = {
    accountAddress: ACCOUNT,
    activeChainId: 31337,
    publicClient: clients.publicClient,
    walletClient: {
      chain: undefined,
      writeContract: clients.writeContract,
    } as unknown as WalletClient,
  };

  return { clients, wallet };
}

async function swapWith({
  action = "buy",
  onStep,
  wallet,
}: {
  action?: "buy" | "sell";
  onStep?: (step: VenueSwapStep) => void;
  wallet: ReturnType<typeof mockClients>["wallet"];
}) {
  return placeVenueSwap({
    action,
    amountIn: 100n * WAD,
    ...(onStep ? { onStep } : {}),
    pool: yesPool(),
    side: "yes",
    venueConfig,
    wallet,
  });
}

function writeCalls(clients: MockClients): WriteCall[] {
  return clients.writeContract.mock.calls.map((call) => call[0] as WriteCall);
}

function yesPool() {
  return buildVenuePoolContext({
    collateral: contractConfig.collateralAddress,
    side: "yes",
    venue: venueInfo(),
  });
}

function swapLog(
  overrides: { amount0?: bigint; amount1?: bigint; poolId?: `0x${string}` } = {}
) {
  const pool = venueInfo().yesPool;

  return {
    address: "0x00000000000000000000000000000000000000c9",
    data: encodeAbiParameters(
      [
        { name: "amount0", type: "int128" },
        { name: "amount1", type: "int128" },
        { name: "sqrtPriceX96", type: "uint160" },
        { name: "liquidity", type: "uint128" },
        { name: "tick", type: "int24" },
        { name: "fee", type: "uint24" },
      ],
      [
        // A YES buy by default: collateral (currency1) in, tokens out.
        overrides.amount0 ?? 190n * WAD,
        overrides.amount1 ?? -(100n * WAD),
        1n << 96n,
        1_000n,
        12,
        3000,
      ]
    ),
    topics: encodeEventTopics({
      abi: poolManagerSwapEventAbi,
      eventName: "Swap",
      args: {
        id: overrides.poolId ?? (pool.poolId as `0x${string}`),
        sender: venueConfig.swapRouterAddress,
      },
    }),
  };
}

function venueInfo(): MarketVenueInfo {
  const yes = buildVenuePoolKey({
    boundedHook: HOOK,
    collateral: contractConfig.collateralAddress,
    outcomeToken: YES_TOKEN,
  });
  const no = buildVenuePoolKey({
    boundedHook: HOOK,
    collateral: contractConfig.collateralAddress,
    outcomeToken: NO_TOKEN,
  });

  return {
    boundedHookAddress: HOOK,
    live: true,
    noPool: {
      displayPriceWad: "120000000000000000",
      initialized: true,
      outcomeTokenAddress: NO_TOKEN.toLowerCase(),
      poolId: computeVenuePoolId(no.key),
      whitelisted: true,
    },
    orderManagerAddress: "0x00000000000000000000000000000000000000c1",
    poolManagerAddress: "0x00000000000000000000000000000000000000c2",
    yesPool: {
      displayPriceWad: "880000000000000000",
      initialized: true,
      outcomeTokenAddress: YES_TOKEN.toLowerCase(),
      poolId: computeVenuePoolId(yes.key),
      whitelisted: true,
    },
  };
}

function venueMarket(overrides: Partial<Market> = {}): Market {
  return marketFactory({
    chainId: 31337,
    id: "31337:7",
    postgrad: {
      adapterAddress: "0x00000000000000000000000000000000000000ab",
      completeSets: 100,
      finalizedAt: "2026-07-01T00:00:00.000Z",
      marketAddress: "0x00000000000000000000000000000000000000cd",
      refundedUsd: 0,
      retainedUsd: 100,
      venue: venueInfo(),
    },
    status: "graduated",
    ...overrides,
  });
}
