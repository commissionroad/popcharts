import type { PublicClient, WalletClient } from "viem";
import { encodeAbiParameters, encodeEventTopics, getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketVenueInfo } from "@/domain/markets/types";
import { WAD } from "@/domain/tokens/wad";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import {
  boundedPoolOrderManagerAbi,
  buildVenuePoolKey,
  computeVenuePoolId,
  type PostgradVenueContractConfig,
} from "@/integrations/contracts/postgrad-venue";

import {
  cancelVenueLimitOrder,
  LIMIT_PRICE_OUT_OF_BAND_MESSAGE,
  LIMIT_WOULD_CROSS_MESSAGE,
  placeVenueLimitOrder,
  type VenueCancelOrderStep,
  type VenueLimitOrderStep,
} from "./limit-order-service";
import { buildVenuePoolContext } from "./postgrad-swap-service";

vi.mock("@/integrations/contracts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/integrations/contracts/config")>()),
  getPopChartsContractConfig: vi.fn(),
}));

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const APPROVE_HASH = `0x${"aa".repeat(32)}` as const;
const ORDER_HASH = `0x${"bb".repeat(32)}` as const;
const HOOK = "0x00000000000000000000000000000000000000f1" as const;
const ORDER_MANAGER = "0x00000000000000000000000000000000000000F2" as const;
const TOKEN_PULLER = "0x00000000000000000000000000000000000000F3" as const;
const STATE_VIEW = "0x00000000000000000000000000000000000000A5" as const;
// Sorts below the collateral address, so the YES outcome is currency0.
const YES_TOKEN = "0x0000000000000000000000000000000000000abc" as const;
// Sorts above the collateral address, so the NO outcome is currency1.
const NO_TOKEN = "0xffffffffffffffffffffffffffffffffffffffff" as const;
// The YES pool trades near 88c (tick ~ -1279 with YES as currency0).
const YES_POOL_PRICE_WAD = 880_000_000_000_000_000n;

const contractConfig: PopChartsContractConfig = {
  chainEnv: "local",
  chainId: 31337,
  collateralAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
  pregradManagerAddress: "0x0000000000000000000000000000000000000001",
  rpcUrl: "http://127.0.0.1:8545",
};

const venueConfig: PostgradVenueContractConfig = {
  orderManagerAddress: ORDER_MANAGER,
  poolTickBoundsAddress: "0x00000000000000000000000000000000000000b2",
  quoterAddress: null,
  stateViewAddress: null,
  swapRouterAddress: "0x00000000000000000000000000000000000000b1",
};

beforeEach(() => {
  vi.mocked(getPopChartsContractConfig).mockReturnValue(contractConfig);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("placeVenueLimitOrder", () => {
  it("requires the venue contracts to be configured", async () => {
    vi.mocked(getPopChartsContractConfig).mockReturnValue(null);
    const { wallet } = mockClients();

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Venue contracts are not configured."
    );
  });

  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockClients();
    wallet.activeChainId = 1;

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Switch your wallet to chain 31337."
    );
  });

  it("requires an order manager address", async () => {
    const { wallet } = mockClients();

    await expect(
      placeWith({
        config: { ...venueConfig, orderManagerAddress: null },
        wallet,
      })
    ).rejects.toThrow("Limit orders are not configured on this deployment.");
  });

  it("rejects an order manager that drifted from the indexed venue", async () => {
    const { wallet } = mockClients();
    const venue = venueInfo();
    venue.orderManagerAddress = "0x00000000000000000000000000000000000000ee";

    await expect(placeWith({ venue, wallet })).rejects.toThrow(
      /no longer matches the indexed venue/
    );
  });

  it("rejects a bid that would cross the current pool tick", async () => {
    const { wallet } = mockClients();

    // A 95c bid on a pool trading at 88c is marketable, not resting.
    await expect(placeWith({ priceCents: 95, wallet })).rejects.toThrow(
      LIMIT_WOULD_CROSS_MESSAGE
    );
  });

  it("rejects an ask that would cross the current pool tick", async () => {
    const { wallet } = mockClients();

    await expect(
      placeWith({ direction: "ask", priceCents: 30, wallet })
    ).rejects.toThrow(LIMIT_WOULD_CROSS_MESSAGE);
  });

  it("reads the live pool tick from StateView when configured", async () => {
    const { clients, wallet } = mockClients();
    // StateView reports the pool far below the indexed price: tick -13000
    // (~27c), so even a 30c bid would cross.
    clients.reads.slot0Tick = -13_000;

    await expect(
      placeWith({
        config: { ...venueConfig, stateViewAddress: STATE_VIEW },
        priceCents: 30,
        wallet,
      })
    ).rejects.toThrow(LIMIT_WOULD_CROSS_MESSAGE);
    expect(
      clients.readCalls.find((call) => call.functionName === "getSlot0")?.address
    ).toBe(STATE_VIEW);
  });

  it("rejects a range outside the pool's registered price band", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.bounds = [true, -600, 0];

    await expect(placeWith({ priceCents: 30, wallet })).rejects.toThrow(
      LIMIT_PRICE_OUT_OF_BAND_MESSAGE
    );
  });

  it("rejects a pool without registered bounds", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.bounds = [false, 0, 0];

    await expect(placeWith({ wallet })).rejects.toThrow(
      LIMIT_PRICE_OUT_OF_BAND_MESSAGE
    );
  });

  it("rejects a bid the collateral balance cannot fund", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.balanceOf = 5n * WAD;

    // 100 tokens at 30c needs a 30 pUSD deposit.
    await expect(placeWith({ wallet })).rejects.toThrow(
      /Insufficient balance\. You have 5\.00 pUSD/
    );
    expect(clients.writeContract).not.toHaveBeenCalled();
  });

  it("names outcome tokens when an ask balance is short", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.balanceOf = 5n * WAD;

    await expect(
      placeWith({ direction: "ask", priceCents: 95, wallet })
    ).rejects.toThrow(/Insufficient balance\. You have 5\.00 outcome tokens/);
  });

  it("approves the token puller (not the order manager) for a short allowance", async () => {
    const steps: VenueLimitOrderStep[] = [];
    const { clients, wallet } = mockClients();

    await placeWith({ onStep: (step) => steps.push(step), wallet });

    const calls = writeCalls(clients);

    expect(steps).toEqual(["approving", "placing", "confirming"]);
    expect(calls.map((call) => call.functionName)).toEqual(["approve", "createOrder"]);
    expect(calls[0]?.address).toBe(contractConfig.collateralAddress);
    // A 100-token bid at 30c escrows exactly 30 pUSD with the puller.
    expect(calls[0]?.args).toEqual([TOKEN_PULLER, 30n * WAD]);
    expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: APPROVE_HASH,
    });
  });

  it("skips the approval when the puller allowance already covers the deposit", async () => {
    const steps: VenueLimitOrderStep[] = [];
    const { clients, wallet } = mockClients();
    clients.reads.allowance = 1_000n * WAD;

    await placeWith({ onStep: (step) => steps.push(step), wallet });

    expect(steps).toEqual(["placing", "confirming"]);
    expect(writeCalls(clients).map((call) => call.functionName)).toEqual([
      "createOrder",
    ]);
  });

  it("grants the order manager a pull allowance on a singleton puller", async () => {
    const { clients, wallet } = mockClients();
    // A real allowance-transfer singleton with no standing grant for the manager.
    clients.reads.pullerAllowance = [0n, 0, 0];

    await placeWith({ wallet });

    const calls = writeCalls(clients);
    // ERC20 approve to the puller, then the singleton grant to the manager,
    // then the order.
    expect(calls.map((call) => call.functionName)).toEqual([
      "approve",
      "approve",
      "createOrder",
    ]);
    const grant = calls[1];
    expect(grant?.address).toBe(TOKEN_PULLER);
    // approve(token, spender=orderManager, amount, expiration>now).
    expect(grant?.args?.slice(0, 3)).toEqual([
      contractConfig.collateralAddress,
      ORDER_MANAGER,
      30n * WAD,
    ]);
    expect(Number(grant?.args?.[3])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("re-grants the singleton allowance when it has expired", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.allowance = 1_000n * WAD;
    // Ample amount, but the grant already expired.
    clients.reads.pullerAllowance = [1_000n * WAD, 0, 0];

    await placeWith({ wallet });

    // The ERC20 approve is skipped; only the singleton re-grant and the order run.
    expect(writeCalls(clients).map((call) => call.functionName)).toEqual([
      "approve",
      "createOrder",
    ]);
    expect(writeCalls(clients)[0]?.address).toBe(TOKEN_PULLER);
  });

  it("skips the singleton grant when the standing allowance still covers it", async () => {
    const { clients, wallet } = mockClients();
    clients.reads.allowance = 1_000n * WAD;
    // Ample amount with a far-future expiration.
    clients.reads.pullerAllowance = [1_000n * WAD, 9_999_999_999, 0];

    await placeWith({ wallet });

    expect(writeCalls(clients).map((call) => call.functionName)).toEqual([
      "createOrder",
    ]);
  });

  it("creates a resting one-spacing bid below the pool price", async () => {
    const { clients, wallet } = mockClients();

    const receipt = await placeWith({ wallet });

    const createCall = writeCalls(clients).find(
      (call) => call.functionName === "createOrder"
    );
    const [params] = createCall?.args as [
      {
        amountInMaximum: bigint;
        enablePartialFill: boolean;
        hookData: string;
        tickLower: number;
        tickUpper: number;
        zeroForOne: boolean;
      },
    ];

    expect(createCall?.address).toBe(ORDER_MANAGER);
    // YES is currency0, so a bid supplies collateral (currency1).
    expect(params.zeroForOne).toBe(false);
    expect(params.tickUpper - params.tickLower).toBe(60);
    expect(params.tickUpper % 60 === 0).toBe(true);
    // 30c maps below the 88c pool tick.
    expect(params.tickUpper).toBeLessThan(-1_279);
    expect(params.amountInMaximum).toBe(30n * WAD);
    expect(params.enablePartialFill).toBe(true);
    expect(params.hookData).toBe("0x");
    expect(receipt.orderId).toBe(9);
    expect(receipt.amountIn).toBe(30n * WAD);
    expect(receipt.direction).toBe("bid");
    expect(receipt.priceCents).toBe(30);
    expect(receipt.sizeWad).toBe(100n * WAD);
    expect(receipt.transactionHash).toBe(ORDER_HASH);
  });

  it("creates a resting ask funded with outcome tokens above the pool price", async () => {
    const { clients, wallet } = mockClients();
    clients.orderLogs = [orderCreatedLog({ amountIn: 100n * WAD, orderId: 4 })];

    const receipt = await placeWith({ direction: "ask", priceCents: 95, wallet });

    const calls = writeCalls(clients);
    const [params] = calls.find((call) => call.functionName === "createOrder")
      ?.args as [{ amountInMaximum: bigint; tickLower: number; zeroForOne: boolean }];

    // Selling YES (currency0) supplies currency0.
    expect(params.zeroForOne).toBe(true);
    expect(params.amountInMaximum).toBe(100n * WAD);
    expect(params.tickLower).toBeGreaterThan(-1_279);
    // The approval escrows the outcome token with the puller.
    expect(calls[0]?.address).toBe(getAddress(YES_TOKEN));
    expect(receipt.direction).toBe("ask");
    expect(receipt.orderId).toBe(4);
  });

  it("fails when the transaction confirms without an OrderCreated event", async () => {
    const { clients, wallet } = mockClients();
    clients.orderLogs = [];

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Transaction confirmed but no resting order was recorded."
    );
  });

  it("ignores OrderCreated events from other contracts", async () => {
    const { clients, wallet } = mockClients();
    clients.orderLogs = [
      {
        ...orderCreatedLog({}),
        address: "0x00000000000000000000000000000000000000ee",
      },
    ];

    await expect(placeWith({ wallet })).rejects.toThrow(
      "Transaction confirmed but no resting order was recorded."
    );
  });
});

describe("cancelVenueLimitOrder", () => {
  it("requires the wallet to be on the configured chain", async () => {
    const { wallet } = mockClients();
    wallet.activeChainId = 1;

    await expect(cancelWith({ wallet })).rejects.toThrow(
      "Switch your wallet to chain 31337."
    );
  });

  it("cancels the order and returns the reclaimed inventory", async () => {
    const steps: VenueCancelOrderStep[] = [];
    const { clients, wallet } = mockClients();
    clients.orderLogs = [orderCancelledLog({ amount0: 0n, amount1: 30n * WAD })];

    const receipt = await cancelWith({ onStep: (step) => steps.push(step), wallet });

    const cancelCall = writeCalls(clients)[0];

    expect(steps).toEqual(["cancelling", "confirming"]);
    expect(cancelCall?.functionName).toBe("cancelOrder");
    expect(cancelCall?.address).toBe(ORDER_MANAGER);
    expect(cancelCall?.args?.[1]).toBe(9);
    expect(cancelCall?.args?.[2]).toBe("0x");
    expect(receipt.amount0).toBe(0n);
    expect(receipt.amount1).toBe(30n * WAD);
    expect(receipt.orderId).toBe(9);
    expect(receipt.transactionHash).toBe(ORDER_HASH);
  });

  it("fails when the transaction confirms without an OrderCancelled event", async () => {
    const { clients, wallet } = mockClients();
    clients.orderLogs = [];

    await expect(cancelWith({ wallet })).rejects.toThrow(
      "Transaction confirmed but no cancellation was recorded."
    );
  });
});

type WriteCall = {
  address: string;
  args: readonly unknown[];
  functionName: string;
};

type MockClients = {
  orderLogs: unknown[];
  publicClient: PublicClient;
  readCalls: { address: string; functionName: string }[];
  reads: {
    allowance: bigint;
    balanceOf: bigint;
    bounds: readonly [boolean, number, number];
    // The puller's allowance-transfer grant for the order manager
    // (amount, expiration, nonce). Undefined models a mock puller with no
    // allowance surface (the read reverts).
    pullerAllowance?: readonly [bigint, number, number];
    slot0Tick: number;
  };
  waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  writeContract: ReturnType<typeof vi.fn>;
};

function mockClients() {
  const clients: MockClients = {
    orderLogs: [orderCreatedLog({})],
    publicClient: undefined as unknown as PublicClient,
    readCalls: [],
    reads: {
      allowance: 0n,
      balanceOf: 1_000n * WAD,
      // Wide enough for every whole-cent price on this pool.
      bounds: [true, -69_120, 0] as readonly [boolean, number, number],
      slot0Tick: -1_279,
    },
    waitForTransactionReceipt: vi.fn(),
    writeContract: vi.fn(),
  };

  const readContract = vi.fn(
    async ({ address, functionName }: { address: string; functionName: string }) => {
      clients.readCalls.push({ address, functionName });

      switch (functionName) {
        case "allowance":
          // The puller's allowance-transfer grant is read on the puller
          // itself; a mock puller (default) has no such surface and reverts.
          if (getAddress(address) === getAddress(TOKEN_PULLER)) {
            if (clients.reads.pullerAllowance === undefined) {
              throw new Error("execution reverted: no allowance surface");
            }

            return clients.reads.pullerAllowance;
          }

          return clients.reads.allowance;
        case "balanceOf":
          return clients.reads.balanceOf;
        case "getPoolTickBounds":
          return clients.reads.bounds;
        case "getSlot0":
          return [1n << 96n, clients.reads.slot0Tick, 0, 3000];
        case "tokenPuller":
          return TOKEN_PULLER;
        default:
          throw new Error(`Unexpected read: ${functionName}`);
      }
    }
  );

  clients.writeContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === "approve" ? APPROVE_HASH : ORDER_HASH
  );
  clients.waitForTransactionReceipt.mockImplementation(
    async ({ hash }: { hash: string }) => ({
      logs: hash === ORDER_HASH ? clients.orderLogs : [],
    })
  );

  clients.publicClient = {
    readContract,
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

async function placeWith({
  config = venueConfig,
  direction = "bid" as const,
  onStep,
  priceCents = 30,
  venue = venueInfo(),
  wallet,
}: {
  config?: PostgradVenueContractConfig;
  direction?: "ask" | "bid";
  onStep?: (step: VenueLimitOrderStep) => void;
  priceCents?: number;
  venue?: MarketVenueInfo;
  wallet: ReturnType<typeof mockClients>["wallet"];
}) {
  return placeVenueLimitOrder({
    direction,
    ...(onStep ? { onStep } : {}),
    pool: yesPool(venue),
    poolDisplayPriceWad: YES_POOL_PRICE_WAD,
    priceCents,
    side: "yes",
    sizeWad: 100n * WAD,
    venue,
    venueConfig: config,
    wallet,
  });
}

async function cancelWith({
  onStep,
  wallet,
}: {
  onStep?: (step: VenueCancelOrderStep) => void;
  wallet: ReturnType<typeof mockClients>["wallet"];
}) {
  return cancelVenueLimitOrder({
    ...(onStep ? { onStep } : {}),
    orderId: 9,
    pool: yesPool(venueInfo()),
    venue: venueInfo(),
    venueConfig,
    wallet,
  });
}

function writeCalls(clients: MockClients): WriteCall[] {
  return clients.writeContract.mock.calls.map((call) => call[0] as WriteCall);
}

function yesPool(venue: MarketVenueInfo) {
  return buildVenuePoolContext({
    collateral: contractConfig.collateralAddress,
    side: "yes",
    venue,
  });
}

function orderCreatedLog({
  amountIn = 30n * WAD,
  orderId = 9,
}: {
  amountIn?: bigint;
  orderId?: number;
}) {
  const pool = venueInfo().yesPool;

  return {
    address: ORDER_MANAGER,
    data: encodeAbiParameters(
      [
        { name: "zeroForOne", type: "bool" },
        { name: "tickLower", type: "int24" },
        { name: "tickUpper", type: "int24" },
        { name: "liquidity", type: "uint128" },
        { name: "amountIn", type: "uint256" },
      ],
      [false, -12_120, -12_060, 1_000n, amountIn]
    ),
    topics: encodeEventTopics({
      abi: boundedPoolOrderManagerAbi,
      eventName: "OrderCreated",
      args: {
        orderId,
        owner: ACCOUNT,
        poolId: pool.poolId as `0x${string}`,
      },
    }),
  };
}

function orderCancelledLog({
  amount0 = 0n,
  amount1 = 30n * WAD,
}: {
  amount0?: bigint;
  amount1?: bigint;
}) {
  const pool = venueInfo().yesPool;

  return {
    address: ORDER_MANAGER,
    data: encodeAbiParameters(
      [
        { name: "amount0", type: "uint256" },
        { name: "amount1", type: "uint256" },
      ],
      [amount0, amount1]
    ),
    topics: encodeEventTopics({
      abi: boundedPoolOrderManagerAbi,
      eventName: "OrderCancelled",
      args: {
        orderId: 9,
        owner: ACCOUNT,
        poolId: pool.poolId as `0x${string}`,
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
    orderManagerAddress: ORDER_MANAGER,
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
