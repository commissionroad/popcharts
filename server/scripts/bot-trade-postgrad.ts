import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  boundedPoolOrderManagerAbi,
  COMPLETE_SET_KEEPER_POLICY,
  COMPLETE_SET_PRICE_POLICY,
  COMPLETE_SET_SMOKE_POLICY,
  type CompleteSetMarketManifestData,
  type CompleteSetMarketPool,
  completeSetBinaryMarketAbi,
  ensureDevBackstopLiquidity,
  findPendingDeferredExecutions,
  minimalV4SwapRouterAbi,
  mockCollateralAbi,
  outcomeTokenAbi,
  poolManagerAbi,
  poolTickBoundsAbi,
  readPoolDisplayPrice,
  sqrtPriceX96ToDisplayPriceWad,
  tickToSqrtPriceX96,
  WAD,
} from "@popcharts/protocol";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatUnits,
  getAbiItem,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

// Relative path, not a package import: scripts/ is not a workspace package, and
// its own runtime (node --experimental-strip-types) cannot load TS out of
// node_modules, so the one parse body has to be shared by path. parseEnvFile is
// deliberately dependency-free so every runtime that reaches it can load it.
// No `.ts` suffix on the specifier: server resolves modules as a bundler and
// rejects it, while scripts/ requires it — the asymmetry is expected.
import { parseEnvFile } from "../../scripts/shared/env/parseEnvFile";

/**
 * Interactive local-dev helper that makes bot wallets trade on a *graduated*
 * (post-graduation) market. The pregrad sibling (bot-trade.ts) drives the LMSR
 * receipt book; this one drives the bounded v4 venue a graduated market trades
 * on: market orders are direct swaps through the minimal v4 router, and limit
 * orders are resting range orders on the BoundedPoolOrderManager (ADR 0009).
 *
 * The bots are devchain mnemonic accounts (indices 10-19, so they never race
 * the deployer/orchestrator on nonces). They mint their own mock collateral,
 * mint complete sets for outcome-token inventory, approve the venue once, then
 * place market and limit orders following the chosen pattern.
 *
 * Fresh venue pools carry no depth and the local stack runs no keeper, so this
 * script does both itself: it seeds one dev backstop liquidity position per
 * pool (the same helper the protocol smoke flows use) so market orders fill,
 * and — signing as the order manager's owner (devchain account 0) — it drains
 * the deferred executions that crossing swaps queue, which is what actually
 * fills a resting limit order.
 *
 * Run `pnpm run local:bot-trade-postgrad` from the repo root (or
 * `just local-bot-trade-postgrad`) with the local stack up. Every setting has a
 * flag, so it also works non-interactively: `--defaults` accepts every default.
 */

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvFile = resolve(serverDir, ".env.local-chain");
const defaultRpcHttpUrl = "http://127.0.0.1:8545";
const localDevChainId = hardhat.id;
const localDevMnemonic =
  "test test test test test test test test test test test junk";
const firstBotAccountIndex = 10;
const maxBotCount = 10;
// The order-manager owner is scanned for among the first devchain accounts so
// the keeper step can sign as it without a resolver-role grant.
const ownerAccountScanLimit = 25;
const outcomeDecimals = COMPLETE_SET_PRICE_POLICY.outcomeDecimals;
const collateralMintAmount = parseUnits("1000000", outcomeDecimals);
const minCollateralBalance = parseUnits("100000", outcomeDecimals);
// Collateral each bot converts into YES + NO complete-set inventory up front so
// it can sell either side and place asks, not only buy.
const inventoryMintCollateral = parseUnits("5000", outcomeDecimals);
const minInventoryBalance = parseUnits("1000", outcomeDecimals);
const minAllowance = parseUnits("10000000", outcomeDecimals);
const maxConsecutiveFailures = 5;

const HOOK_DATA_NONE: Hex = "0x";
// createOrder settles for ~350k gas, but a wallet that fails to estimate falls
// back to a default above the chain's 2^24 per-tx gas cap; pin it well under.
const orderManagerGasLimit = 2_000_000n;

const modePresets = {
  burst: { intervalMs: 0, label: "burst", tradeCount: 20 },
  frenzy: { intervalMs: 250, label: "frenzy", tradeCount: null },
  steady: { intervalMs: 2_000, label: "steady", tradeCount: null },
} as const;

// Trade size in whole 18-decimal units: collateral for market buys and limit
// bids, outcome tokens for market sells and limit asks.
const sizeRanges = {
  large: [25, 100],
  medium: [5, 25],
  small: [1, 5],
} as const;

const biasYesPercents = {
  balanced: 50,
  bearish: 30,
  bullish: 70,
} as const;

type ModePreset = keyof typeof modePresets;
type SizePreset = keyof typeof sizeRanges | "mixed";
type BiasPreset = keyof typeof biasYesPercents;

type MarketSide = "no" | "yes";
type TradeAction = "buy" | "sell";
type OrderDirection = "ask" | "bid";

type CliOptions = {
  bias: BiasPreset | undefined;
  botCount: number | undefined;
  defaults: boolean;
  envFile: string | undefined;
  help: boolean;
  intervalMs: number | undefined;
  keeper: boolean | undefined;
  keeperEvery: number | undefined;
  limitShare: number | undefined;
  mode: ModePreset | undefined;
  seedCollateral: number | undefined;
  size: SizePreset | undefined;
  tradeCount: number | undefined;
};

type RunPlan = {
  biasYesPercent: number;
  botCount: number;
  intervalMs: number;
  keeperEnabled: boolean;
  keeperEvery: number;
  limitSharePercent: number;
  seedCollateral: bigint;
  size: SizePreset;
  tradeCount: number | null;
};

type VenueAddresses = {
  boundedHook: Address;
  collateral: Address;
  market: Address;
  noPoolId: Hex;
  noToken: Address;
  orderManager: Address;
  poolManager: Address;
  poolTickBounds: Address;
  stateView: Address;
  swapRouter: Address;
  yesPoolId: Hex;
  yesToken: Address;
};

type Bot = {
  account: ReturnType<typeof mnemonicToAccount>;
  address: Address;
  label: string;
  walletClient: LocalWalletClient;
};

type RestingOrder = {
  bot: Bot;
  direction: OrderDirection;
  orderId: number;
  poolId: Hex;
  poolKey: CompleteSetMarketPool["poolKey"];
  side: MarketSide;
};

type TradeStats = {
  attempts: number;
  cancels: number;
  deferredResolved: number;
  failures: number;
  limitOrders: number;
  marketOrders: number;
  ordersFilled: number;
  skips: number;
  volumeUsd: number;
};

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

main().catch((error: unknown) => {
  console.error(`\n[bot-postgrad] ${getErrorMessage(error)}`);
  process.exit(1);
});

async function main(): Promise<void> {
  const options = parseArgs(rawArgs);

  if (options.help) {
    printUsage();
    return;
  }

  const envFile = resolvePath(
    options.envFile ??
      process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ??
      defaultEnvFile,
  );
  const envFileExists = existsSync(envFile);
  const fileEnv = envFileExists
    ? parseEnvFile(readFileSync(envFile, "utf8"))
    : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };

  if (envFileExists) {
    console.log(`[bot-postgrad] loading ${envFile}`);
  }

  const addresses = readVenueAddresses(env, envFile, envFileExists);
  const rpcUrl = env.RPC_HTTP_URL ?? defaultRpcHttpUrl;

  const publicClient = createPublicClient({
    chain: hardhat,
    transport: http(rpcUrl),
  });

  await validateLocalDeployment({ addresses, publicClient, rpcUrl });
  const manifest = await buildManifest({ addresses, publicClient });
  await assertMarketTradeable({ addresses, publicClient });

  const interactive =
    !options.defaults &&
    Boolean(process.stdin.isTTY) &&
    Boolean(process.stdout.isTTY);
  const rl = interactive
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;

  rl?.on("SIGINT", () => {
    rl.close();
    console.log("");
    process.exit(130);
  });

  const plan = await buildRunPlan({ manifest, options, rl });
  rl?.close();

  const bots = Array.from({ length: plan.botCount }, (_, index) => {
    const account = mnemonicToAccount(localDevMnemonic, {
      addressIndex: firstBotAccountIndex + index,
    });

    return {
      account,
      address: account.address,
      label: `bot${index + 1}`,
      walletClient: createWalletClient({
        account,
        chain: hardhat,
        transport: http(rpcUrl),
      }),
    } satisfies Bot;
  });

  console.log(
    `[bot-postgrad] market ${manifest.market.symbol} at ${manifest.market.address}`,
  );
  console.log(
    `[bot-postgrad] pattern: ${describePattern(plan)} | bots: ${
      plan.botCount
    } | size: ${plan.size} | bias: ${describeBias(plan.biasYesPercent)} | ` +
      `limit share: ${plan.limitSharePercent}%`,
  );

  const keeper = plan.keeperEnabled
    ? await resolveKeeper({ addresses, publicClient, rpcUrl })
    : null;

  if (plan.keeperEnabled && keeper === null) {
    console.warn(
      "[bot-postgrad] could not find the order-manager owner among the local " +
        "accounts; limit orders will rest but will not be filled this run.",
    );
  }

  // Seed backstop depth (idempotent — skips pools that already hold liquidity)
  // so market orders fill and crossing swaps can execute maker orders.
  if (keeper) {
    await seedBackstopLiquidity({
      addresses,
      keeper,
      manifest,
      publicClient,
      seedCollateral: plan.seedCollateral,
    });
  }

  const minimumOrderAmounts = await readMinimumOrderAmounts({
    addresses,
    publicClient,
  });

  for (const bot of bots) {
    await fundBot({ addresses, bot, publicClient });
  }

  const startPrice = await readYesDisplayPercent({ manifest, publicClient });
  const scanFromBlock = await publicClient.getBlockNumber();

  if (startPrice !== null) {
    console.log(
      `[bot-postgrad] YES ${startPrice.toFixed(1)}% — trading` +
        `${plan.tradeCount === null ? " until Ctrl+C" : ""}`,
    );
  }

  const stopController = new AbortController();
  process.once("SIGINT", () => {
    console.log("\n[bot-postgrad] stopping after the current action…");
    stopController.abort();
    process.once("SIGINT", () => process.exit(130));
  });

  const stats: TradeStats = {
    attempts: 0,
    cancels: 0,
    deferredResolved: 0,
    failures: 0,
    limitOrders: 0,
    marketOrders: 0,
    ordersFilled: 0,
    skips: 0,
    volumeUsd: 0,
  };
  const restingOrders: RestingOrder[] = [];
  // Dedupes OrderFilled events across checkpoints so a fill is counted once.
  const filledOrderKeys = new Set<string>();
  let consecutiveFailures = 0;

  // When a keeper is available, first drain any deferred-execution overflow
  // batches, then reconcile fills — reconciling last counts the OrderFilled
  // events the drain itself just emitted.
  const runCheckpoint = async (): Promise<void> => {
    if (keeper) {
      stats.deferredResolved += await drainDeferredExecutions({
        addresses,
        fromBlock: scanFromBlock,
        keeper,
        publicClient,
      });
    }
    stats.ordersFilled += await reconcileFills({
      addresses,
      filledOrderKeys,
      fromBlock: scanFromBlock,
      publicClient,
      restingOrders,
    });
  };

  while (
    !stopController.signal.aborted &&
    (plan.tradeCount === null || stats.attempts < plan.tradeCount)
  ) {
    stats.attempts += 1;
    const bot = bots[Math.floor(Math.random() * bots.length)] as Bot;

    try {
      await runOneAction({
        addresses,
        bot,
        manifest,
        minimumOrderAmounts,
        plan,
        publicClient,
        restingOrders,
        stats,
      });
      consecutiveFailures = 0;
    } catch (error) {
      stats.failures += 1;
      consecutiveFailures += 1;
      const message = getErrorMessage(error);

      if (isTerminalMarketError(message)) {
        console.error(
          `[bot-postgrad] market ${manifest.market.address} is no longer ` +
            `tradeable: ${message}`,
        );
        break;
      }

      console.warn(
        `[bot-postgrad] ${timestamp()} ${bot.label} action failed: ${message}`,
      );

      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.error(
          `[bot-postgrad] ${maxConsecutiveFailures} actions failed in a row; ` +
            "stopping. Is the local stack healthy?",
        );
        break;
      }
    }

    if (
      stats.attempts % plan.keeperEvery === 0 &&
      !stopController.signal.aborted
    ) {
      await runCheckpoint();
    }

    const isLastTrade =
      plan.tradeCount !== null && stats.attempts >= plan.tradeCount;
    if (plan.intervalMs > 0 && !isLastTrade) {
      await sleep(plan.intervalMs, stopController.signal);
    }
  }

  // Final reconcile so fills (and any deferred overflow) from the last actions
  // are counted and resolved.
  await runCheckpoint();

  const endPrice = await readYesDisplayPercent({ manifest, publicClient });
  printSummary({ endPrice, startPrice, stats });
  process.exit(stats.failures > 0 && stats.failures === stats.attempts ? 1 : 0);
}

/**
 * Runs a single bot action: a resting-order cancel (when orders are parked), a
 * limit order, or a market order, chosen by the plan's limit share. The side
 * and direction lean on the configured bias so the book acquires a net drift.
 */
async function runOneAction({
  addresses,
  bot,
  manifest,
  minimumOrderAmounts,
  plan,
  publicClient,
  restingOrders,
  stats,
}: {
  addresses: VenueAddresses;
  bot: Bot;
  manifest: CompleteSetMarketManifestData;
  minimumOrderAmounts: Map<Address, bigint>;
  plan: RunPlan;
  publicClient: LocalPublicClient;
  restingOrders: RestingOrder[];
  stats: TradeStats;
}): Promise<void> {
  // Occasionally retire a resting order (exercises cancelOrder and returns
  // inventory) instead of placing a new one.
  const ownOrders = restingOrders.filter((order) => order.bot === bot);
  if (ownOrders.length > 0 && Math.random() < 0.15) {
    const order = ownOrders[Math.floor(Math.random() * ownOrders.length)]!;
    const dropOrder = (): void => {
      const index = restingOrders.indexOf(order);
      if (index >= 0) {
        restingOrders.splice(index, 1);
      }
    };
    try {
      await cancelLimitOrder({ addresses, order, publicClient });
      dropOrder();
      stats.cancels += 1;
      console.log(
        `[bot-postgrad] ${timestamp()} ${bot.label} cancel ${order.direction} ` +
          `${order.side.toUpperCase()} order #${order.orderId}`,
      );
    } catch (error) {
      // A revert means the order already filled or was consumed — a normal
      // outcome, so drop it and move on. Anything else (RPC/network) is a real
      // failure: keep the order tracked and let the caller record it.
      if (!isContractRevert(getErrorMessage(error))) {
        throw error;
      }
      dropOrder();
      console.log(
        `[bot-postgrad] ${timestamp()} ${bot.label} ${order.side.toUpperCase()} ` +
          `order #${order.orderId} already filled, nothing to cancel`,
      );
    }
    return;
  }

  const pushYesUp = Math.random() * 100 < plan.biasYesPercent;
  const side: MarketSide = Math.random() < 0.5 ? "yes" : "no";
  // Buying YES or selling NO pushes the implied YES price up; the mirror image
  // pushes it down. Pick the action on `side` that moves price the biased way.
  const action: TradeAction =
    side === "yes" ? (pushYesUp ? "buy" : "sell") : pushYesUp ? "sell" : "buy";
  const wholeUnits = pickTradeUnits(plan.size);

  if (Math.random() * 100 < plan.limitSharePercent) {
    await placeLimitOrder({
      action,
      addresses,
      bot,
      manifest,
      minimumOrderAmounts,
      publicClient,
      restingOrders,
      side,
      stats,
      wholeUnits,
    });
    return;
  }

  await placeMarketOrder({
    action,
    addresses,
    bot,
    manifest,
    publicClient,
    side,
    stats,
    wholeUnits,
  });
}

/**
 * Places a market order as a direct exact-input v4 swap, with the price limit
 * pinned to the pool's epsilon band edge (the app's convention): an oversized
 * order stops at the bound as a partial fill instead of reverting. Buys spend
 * collateral; sells spend outcome tokens (clamped to the bot's balance).
 */
async function placeMarketOrder({
  action,
  addresses,
  bot,
  manifest,
  publicClient,
  side,
  stats,
  wholeUnits,
}: {
  action: TradeAction;
  addresses: VenueAddresses;
  bot: Bot;
  manifest: CompleteSetMarketManifestData;
  publicClient: LocalPublicClient;
  side: MarketSide;
  stats: TradeStats;
  wholeUnits: number;
}): Promise<void> {
  const pool = manifest.pools[side];
  const zeroForOne =
    action === "buy" ? !pool.outcomeIsCurrency0 : pool.outcomeIsCurrency0;
  let amountIn = parseUnits(String(wholeUnits), outcomeDecimals);

  if (action === "sell") {
    const balance = await readErc20Balance({
      account: bot.address,
      publicClient,
      token: pool.outcomeToken,
    });
    if (balance < amountIn) {
      amountIn = balance;
    }
    if (amountIn === 0n) {
      stats.skips += 1;
      return;
    }
  }

  const bounds = await readPoolBounds({
    addresses,
    poolId: pool.poolId,
    publicClient,
  });
  // Skip when price already sits within a tick spacing of the band edge this
  // order would push toward: the bounded venue reverts rather than no-op, and a
  // bot that keeps shoving one way should just move on to the next action.
  const currentTick = (
    await readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      poolId: pool.poolId,
      publicClient,
      stateView: addresses.stateView,
    })
  ).tick;
  const roomToBound = zeroForOne
    ? currentTick - bounds.lowerTick
    : bounds.upperTick - currentTick;
  if (roomToBound <= pool.poolKey.tickSpacing) {
    stats.skips += 1;
    return;
  }

  // A zeroForOne swap walks price down toward the lower bound; the opposite
  // direction walks it up. A down swap that lands on the boundary settles at
  // lowerTick - 1 (v4 tick semantics), which the hook rejects, so nudge the
  // down limit one wei inside the band.
  const limitTick = zeroForOne ? bounds.lowerTick : bounds.upperTick;
  const sqrtPriceLimitX96 = zeroForOne
    ? tickToSqrtPriceX96(limitTick) + 1n
    : tickToSqrtPriceX96(limitTick);

  let hash: Hex;
  try {
    hash = await bot.walletClient.writeContract({
      abi: minimalV4SwapRouterAbi,
      account: bot.account,
      address: addresses.swapRouter,
      chain: hardhat,
      functionName: "swap",
      args: [
        pool.poolKey,
        { amountSpecified: -amountIn, sqrtPriceLimitX96, zeroForOne },
        bot.address,
        HOOK_DATA_NONE,
      ],
    });
  } catch (error) {
    // The venue rejects a swap that would breach the price band or run out of
    // depth before the limit — expected when a bot pushes into a thin edge.
    // Treat it as a no-fill skip, not a run-ending failure.
    if (isSoftSwapRevert(getErrorMessage(error))) {
      stats.skips += 1;
      return;
    }
    throw error;
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`swap transaction reverted (${hash}).`);
  }

  const swap = parseEventLogs({
    abi: poolManagerAbi,
    eventName: "Swap",
    logs: receipt.logs,
  }).find((log) => log.args.id.toLowerCase() === pool.poolId.toLowerCase());

  if (!swap) {
    throw new Error("swap confirmed but no venue fill was recorded.");
  }

  // The Swap event carries the swapper's balance delta: input negative, output
  // positive. Collateral is whichever leg is not the outcome token.
  const collateralDelta = pool.outcomeIsCurrency0
    ? swap.args.amount1
    : swap.args.amount0;
  const collateralUsd = Number(
    formatUnits(absBigInt(collateralDelta), outcomeDecimals),
  );
  const actualIn = absBigInt(
    zeroForOne ? swap.args.amount0 : swap.args.amount1,
  );
  const partial = actualIn < amountIn;

  stats.marketOrders += 1;
  stats.volumeUsd += collateralUsd;
  const price = await readYesDisplayPercent({ manifest, publicClient });
  console.log(
    `[bot-postgrad] ${timestamp()} ${bot.label} MARKET ${action.toUpperCase()} ` +
      `${side.toUpperCase()} ${collateralUsd.toFixed(2)} pUSD` +
      `${partial ? " (partial)" : ""}` +
      `${price === null ? "" : ` → YES ${price.toFixed(1)}%`}` +
      ` (action ${stats.attempts})`,
  );
}

/**
 * Places a resting limit order on the order manager: a one-spacing range offset
 * from the current pool tick on the maker's side (so it rests, never crosses),
 * inside the pool's epsilon bounds. Bids deposit collateral (size x price),
 * asks deposit outcome tokens; the deposit is raised to the order manager's
 * minimum when a small order would fall below it.
 */
async function placeLimitOrder({
  action,
  addresses,
  bot,
  manifest,
  minimumOrderAmounts,
  publicClient,
  restingOrders,
  side,
  stats,
  wholeUnits,
}: {
  action: TradeAction;
  addresses: VenueAddresses;
  bot: Bot;
  manifest: CompleteSetMarketManifestData;
  minimumOrderAmounts: Map<Address, bigint>;
  publicClient: LocalPublicClient;
  restingOrders: RestingOrder[];
  side: MarketSide;
  stats: TradeStats;
  wholeUnits: number;
}): Promise<void> {
  const pool = manifest.pools[side];
  const direction: OrderDirection = action === "buy" ? "bid" : "ask";
  const price = await readPoolDisplayPrice({
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    poolId: pool.poolId,
    publicClient,
    stateView: addresses.stateView,
  });

  const range = buildRestingRange({ currentTick: price.tick, direction, pool });
  if (range === null) {
    stats.skips += 1;
    return;
  }

  const priceWad = sqrtPriceX96ToDisplayPriceWadForTick({
    collateralDecimals: manifest.collateral.decimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    tick: range.nearEdgeTick,
  });
  let sizeWad = parseUnits(String(wholeUnits), outcomeDecimals);
  const spendToken =
    direction === "bid" ? addresses.collateral : pool.outcomeToken;
  const minimum = minimumOrderAmounts.get(getAddress(spendToken)) ?? 0n;

  // Ensure the deposit clears the order manager's minimum for the input token.
  if (direction === "bid") {
    const minSize = priceWad > 0n ? ceilDiv(minimum * WAD, priceWad) : sizeWad;
    if (sizeWad < minSize) {
      sizeWad = minSize;
    }
  } else if (sizeWad < minimum) {
    sizeWad = minimum;
  }

  const amountInMaximum =
    direction === "ask" ? sizeWad : ceilDiv(sizeWad * priceWad, WAD);

  if (direction === "ask") {
    const balance = await readErc20Balance({
      account: bot.address,
      publicClient,
      token: pool.outcomeToken,
    });
    if (balance < amountInMaximum) {
      stats.skips += 1;
      return;
    }
  }

  const hash = await bot.walletClient.writeContract({
    abi: boundedPoolOrderManagerAbi,
    account: bot.account,
    address: addresses.orderManager,
    chain: hardhat,
    functionName: "createOrder",
    gas: orderManagerGasLimit,
    args: [
      {
        amountInMaximum,
        enablePartialFill: true,
        hookData: HOOK_DATA_NONE,
        key: pool.poolKey,
        tickLower: range.tickLower,
        tickUpper: range.tickUpper,
        zeroForOne: range.zeroForOne,
      },
    ],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`createOrder transaction reverted (${hash}).`);
  }

  const created = parseEventLogs({
    abi: boundedPoolOrderManagerAbi,
    eventName: "OrderCreated",
    logs: receipt.logs.filter(
      (log) => getAddress(log.address) === addresses.orderManager,
    ),
  })[0];

  if (!created) {
    throw new Error("createOrder confirmed but no resting order was recorded.");
  }

  restingOrders.push({
    bot,
    direction,
    orderId: created.args.orderId,
    poolId: pool.poolId,
    poolKey: pool.poolKey,
    side,
  });
  stats.limitOrders += 1;
  const priceCents = Number(formatUnits(priceWad, outcomeDecimals)) * 100;
  console.log(
    `[bot-postgrad] ${timestamp()} ${bot.label} LIMIT ${direction.toUpperCase()} ` +
      `${side.toUpperCase()} ${Number(
        formatUnits(sizeWad, outcomeDecimals),
      ).toFixed(
        2,
      )} @ ${priceCents.toFixed(0)}c order #${created.args.orderId} ` +
      `(action ${stats.attempts})`,
  );
}

/** Cancels a resting order; the order manager returns its inventory. */
async function cancelLimitOrder({
  addresses,
  order,
  publicClient,
}: {
  addresses: VenueAddresses;
  order: RestingOrder;
  publicClient: LocalPublicClient;
}): Promise<void> {
  const hash = await order.bot.walletClient.writeContract({
    abi: boundedPoolOrderManagerAbi,
    account: order.bot.account,
    address: addresses.orderManager,
    chain: hardhat,
    functionName: "cancelOrder",
    gas: orderManagerGasLimit,
    args: [order.poolKey, order.orderId, HOOK_DATA_NONE],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`cancelOrder transaction reverted (${hash}).`);
  }
}

/**
 * Discovers deferred executions queued by crossing swaps and resolves each
 * batch to completion, signing as the order manager's owner. This is the step
 * that actually fills resting limit orders. Returns the count fully drained.
 */
async function drainDeferredExecutions({
  addresses,
  fromBlock,
  keeper,
  publicClient,
}: {
  addresses: VenueAddresses;
  fromBlock: bigint;
  keeper: Keeper;
  publicClient: LocalPublicClient;
}): Promise<number> {
  const pending = await findPendingDeferredExecutions({
    fromBlock,
    orderManager: addresses.orderManager,
    poolIds: [addresses.yesPoolId, addresses.noPoolId],
    publicClient,
  });

  if (pending.length === 0) {
    return 0;
  }

  let resolved = 0;
  for (const execution of pending) {
    let complete = false;
    for (
      let i = 0;
      i < COMPLETE_SET_KEEPER_POLICY.maxDeferredResolveIterations;
      i += 1
    ) {
      const hash = await keeper.walletClient.writeContract({
        abi: boundedPoolOrderManagerAbi,
        account: keeper.account,
        address: addresses.orderManager,
        chain: hardhat,
        functionName: "resolveDeferredExecution",
        args: [execution.executionId, 0n],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`resolveDeferredExecution reverted (${hash}).`);
      }
      const state = await publicClient.readContract({
        abi: boundedPoolOrderManagerAbi,
        address: addresses.orderManager,
        functionName: "getDeferredExecution",
        args: [execution.executionId],
      });
      if (!state[0]) {
        complete = true;
        break;
      }
    }
    if (complete) {
      resolved += 1;
    }
  }

  if (resolved > 0) {
    console.log(
      `[bot-postgrad] ${timestamp()} keeper resolved ${resolved} deferred ` +
        `execution batch${resolved === 1 ? "" : "es"}`,
    );
  }

  return resolved;
}

/**
 * Counts limit orders filled since the run began — both synchronous fills during
 * a crossing swap and keeper-resolved ones emit OrderFilled — deduping by pool
 * and order id, and drops filled orders from the resting set so the bot never
 * tries to cancel an order that is already gone. Returns the newly seen count.
 */
async function reconcileFills({
  addresses,
  filledOrderKeys,
  fromBlock,
  publicClient,
  restingOrders,
}: {
  addresses: VenueAddresses;
  filledOrderKeys: Set<string>;
  fromBlock: bigint;
  publicClient: LocalPublicClient;
  restingOrders: RestingOrder[];
}): Promise<number> {
  const logs = await publicClient.getLogs({
    address: addresses.orderManager,
    event: getAbiItem({ abi: boundedPoolOrderManagerAbi, name: "OrderFilled" }),
    fromBlock,
  });
  // The order manager is a singleton shared across markets, so keep only fills
  // in this market's two pools.
  const marketPoolIds = new Set(
    [addresses.yesPoolId, addresses.noPoolId].map((id) => id.toLowerCase()),
  );

  let newlyFilled = 0;
  for (const log of logs) {
    if (!marketPoolIds.has(log.args.poolId!.toLowerCase())) {
      continue;
    }
    const key = `${log.args.poolId}:${log.args.orderId}`.toLowerCase();
    if (!filledOrderKeys.has(key)) {
      filledOrderKeys.add(key);
      newlyFilled += 1;
    }
  }

  for (let index = restingOrders.length - 1; index >= 0; index -= 1) {
    const order = restingOrders[index]!;
    const key = `${order.poolId}:${order.orderId}`.toLowerCase();
    if (filledOrderKeys.has(key)) {
      restingOrders.splice(index, 1);
    }
  }

  return newlyFilled;
}

/**
 * A one-tick-spacing resting range offset from the current pool tick on the
 * maker's side, clamped to skip when it would fall outside the pool's epsilon
 * bounds. `zeroForOne` records which sorted currency the maker supplies.
 */
function buildRestingRange({
  currentTick,
  direction,
  pool,
}: {
  currentTick: number;
  direction: OrderDirection;
  pool: CompleteSetMarketPool;
}): {
  nearEdgeTick: number;
  tickLower: number;
  tickUpper: number;
  zeroForOne: boolean;
} | null {
  const spacing = pool.poolKey.tickSpacing;
  const offset = COMPLETE_SET_SMOKE_POLICY.orderOffsetSpacings * spacing;
  const width = COMPLETE_SET_SMOKE_POLICY.orderWidthSpacings * spacing;
  const zeroForOne = (direction === "ask") === pool.outcomeIsCurrency0;

  let tickLower: number;
  let tickUpper: number;
  if (zeroForOne) {
    // Supplies currency0, rests above the current tick.
    tickLower = alignDown(currentTick, spacing) + offset;
    tickUpper = tickLower + width;
  } else {
    // Supplies currency1, rests below the current tick.
    tickUpper = alignUp(currentTick, spacing) - offset;
    tickLower = tickUpper - width;
  }

  const rests = zeroForOne ? currentTick < tickLower : currentTick > tickUpper;
  const inBounds =
    tickLower >= pool.boundLowerTick && tickUpper <= pool.boundUpperTick;
  if (!rests || !inBounds || tickLower >= tickUpper) {
    return null;
  }

  return {
    nearEdgeTick: zeroForOne ? tickLower : tickUpper,
    tickLower,
    tickUpper,
    zeroForOne,
  };
}

async function buildRunPlan({
  manifest,
  options,
  rl,
}: {
  manifest: CompleteSetMarketManifestData;
  options: CliOptions;
  rl: Interface | null;
}): Promise<RunPlan> {
  let tradeCount: number | null;
  let intervalMs: number;

  if (options.tradeCount !== undefined || options.intervalMs !== undefined) {
    tradeCount = options.tradeCount ?? null;
    intervalMs = options.intervalMs ?? 0;
  } else if (options.mode) {
    tradeCount = modePresets[options.mode].tradeCount;
    intervalMs = modePresets[options.mode].intervalMs;
  } else if (rl) {
    const patternIndex = await promptChoice(
      rl,
      "Trade pattern:",
      [
        `burst  — ${modePresets.burst.tradeCount} actions back to back, then exit`,
        "steady — one action every 2s until Ctrl+C",
        "frenzy — one action every 250ms until Ctrl+C",
        "custom — pick action count and interval",
      ],
      0,
    );

    if (patternIndex === 3) {
      tradeCount = await promptOptionalInt(
        rl,
        "How many actions (empty = until Ctrl+C): ",
        1,
      );
      intervalMs = await promptInt(rl, "Interval in ms", 1_000, 0, 3_600_000);
    } else {
      const preset =
        patternIndex === 1
          ? modePresets.steady
          : patternIndex === 2
            ? modePresets.frenzy
            : modePresets.burst;
      tradeCount = preset.tradeCount;
      intervalMs = preset.intervalMs;
    }
  } else {
    tradeCount = modePresets.burst.tradeCount;
    intervalMs = modePresets.burst.intervalMs;
  }

  let botCount = options.botCount;
  if (botCount === undefined) {
    botCount = rl
      ? await promptInt(rl, `Bot wallets (1-${maxBotCount})`, 3, 1, maxBotCount)
      : 3;
  }

  let size = options.size;
  if (size === undefined) {
    if (rl) {
      const sizeIndex = await promptChoice(
        rl,
        "Trade size (whole units):",
        [
          "small  — 1-5",
          "medium — 5-25",
          "large  — 25-100",
          "mixed  — a bit of everything",
        ],
        3,
      );
      size = (["small", "medium", "large", "mixed"] as const)[
        sizeIndex
      ] as SizePreset;
    } else {
      size = "mixed";
    }
  }

  let bias = options.bias;
  if (bias === undefined) {
    if (rl) {
      const biasIndex = await promptChoice(
        rl,
        "Side bias:",
        [
          "balanced — 50/50 up and down",
          "bullish  — 70% pushing YES up",
          "bearish  — 70% pushing YES down",
        ],
        0,
      );
      bias = (["balanced", "bullish", "bearish"] as const)[
        biasIndex
      ] as BiasPreset;
    } else {
      bias = "balanced";
    }
  }

  let limitSharePercent = options.limitShare;
  if (limitSharePercent === undefined) {
    limitSharePercent = rl
      ? await promptInt(rl, "Limit-order share (0-100%)", 35, 0, 100)
      : 35;
  }

  const keeperEnabled = options.keeper ?? true;
  const keeperEvery = options.keeperEvery ?? 6;
  const seedCollateral = parseUnits(
    String(options.seedCollateral ?? 20_000),
    manifest.collateral.decimals,
  );

  return {
    biasYesPercent: biasYesPercents[bias],
    botCount,
    intervalMs,
    keeperEnabled,
    keeperEvery,
    limitSharePercent,
    seedCollateral,
    size,
    tradeCount,
  };
}

/** Seeds one dev backstop liquidity position per pool from the keeper wallet. */
async function seedBackstopLiquidity({
  addresses,
  keeper,
  manifest,
  publicClient,
  seedCollateral,
}: {
  addresses: VenueAddresses;
  keeper: Keeper;
  manifest: CompleteSetMarketManifestData;
  publicClient: LocalPublicClient;
  seedCollateral: bigint;
}): Promise<void> {
  console.log(
    `[bot-postgrad] seeding backstop liquidity (${formatUnits(
      seedCollateral,
      manifest.collateral.decimals,
    )} pUSD/side) from ${keeper.account.address}…`,
  );
  await ensureDevBackstopLiquidity({
    account: keeper.account.address,
    chainId: localDevChainId,
    devCollateral: seedCollateral,
    manifest,
    publicClient,
    sides: ["no", "yes"],
    swapRouter: addresses.swapRouter,
    walletClient: makeContractWriter(keeper.walletClient, keeper.account),
  });
}

/** Reads the order manager's minimum order amount for each input token once. */
async function readMinimumOrderAmounts({
  addresses,
  publicClient,
}: {
  addresses: VenueAddresses;
  publicClient: LocalPublicClient;
}): Promise<Map<Address, bigint>> {
  const tokens = [addresses.collateral, addresses.yesToken, addresses.noToken];
  const minimums = new Map<Address, bigint>();
  for (const token of tokens) {
    const minimum = await publicClient.readContract({
      abi: boundedPoolOrderManagerAbi,
      address: addresses.orderManager,
      functionName: "minimumOrderAmount",
      args: [token],
    });
    minimums.set(getAddress(token), minimum);
  }
  return minimums;
}

/**
 * Funds a bot for venue trading: gas check, mint collateral, mint complete-set
 * outcome inventory, and approve the market, swap router, and order manager's
 * token puller for the tokens each spends.
 */
async function fundBot({
  addresses,
  bot,
  publicClient,
}: {
  addresses: VenueAddresses;
  bot: Bot;
  publicClient: LocalPublicClient;
}): Promise<void> {
  const ethBalance = await publicClient.getBalance({ address: bot.address });
  if (ethBalance === 0n) {
    throw new Error(
      `${bot.label} (${bot.address}) has no gas ETH. The local devchain ` +
        "normally pre-funds mnemonic accounts 0-19; restart it with " +
        "'just local-dev-control'.",
    );
  }

  const notes: string[] = [];
  let collateral = await readErc20Balance({
    account: bot.address,
    publicClient,
    token: addresses.collateral,
  });
  if (collateral < minCollateralBalance) {
    await sendAndWait(publicClient, () =>
      bot.walletClient.writeContract({
        abi: mockCollateralAbi,
        account: bot.account,
        address: addresses.collateral,
        chain: hardhat,
        functionName: "mint",
        args: [bot.address, collateralMintAmount],
      }),
    );
    collateral += collateralMintAmount;
    notes.push("minted pUSD");
  }

  const tokenPuller = await publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: addresses.orderManager,
    functionName: "tokenPuller",
  });

  // Collateral is spent minting sets, buying (swap router), and bidding (puller).
  await ensureAllowance({
    account: bot,
    owner: bot.address,
    publicClient,
    spender: addresses.market,
    token: addresses.collateral,
  });
  await ensureAllowance({
    account: bot,
    owner: bot.address,
    publicClient,
    spender: addresses.swapRouter,
    token: addresses.collateral,
  });
  await ensureAllowance({
    account: bot,
    owner: bot.address,
    publicClient,
    spender: tokenPuller,
    token: addresses.collateral,
  });

  const yesBalance = await readErc20Balance({
    account: bot.address,
    publicClient,
    token: addresses.yesToken,
  });
  if (yesBalance < minInventoryBalance) {
    await sendAndWait(publicClient, () =>
      bot.walletClient.writeContract({
        abi: completeSetBinaryMarketAbi,
        account: bot.account,
        address: addresses.market,
        chain: hardhat,
        functionName: "mintCompleteSets",
        args: [bot.address, inventoryMintCollateral],
      }),
    );
    notes.push("minted YES/NO");
  }

  // Outcome tokens are spent selling (swap router) and asking (puller).
  for (const token of [addresses.yesToken, addresses.noToken]) {
    await ensureAllowance({
      account: bot,
      owner: bot.address,
      publicClient,
      spender: addresses.swapRouter,
      token,
    });
    await ensureAllowance({
      account: bot,
      owner: bot.address,
      publicClient,
      spender: tokenPuller,
      token,
    });
  }

  console.log(
    `[bot-postgrad] ${bot.label} ${bot.address} pUSD ${formatTokenAmount(
      collateral,
    )}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
  );
}

/** Approves `spender` for `token` from a bot when the allowance is short. */
async function ensureAllowance({
  account,
  owner,
  publicClient,
  spender,
  token,
}: {
  account: Bot;
  owner: Address;
  publicClient: LocalPublicClient;
  spender: Address;
  token: Address;
}): Promise<void> {
  const allowance = await publicClient.readContract({
    abi: outcomeTokenAbi,
    address: token,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= minAllowance) {
    return;
  }
  await sendAndWait(publicClient, () =>
    account.walletClient.writeContract({
      abi: outcomeTokenAbi,
      account: account.account,
      address: token,
      chain: hardhat,
      functionName: "approve",
      args: [spender, maxUint256],
    }),
  );
}

type Keeper = {
  account: ReturnType<typeof mnemonicToAccount>;
  walletClient: LocalWalletClient;
};

/**
 * Finds the devchain account that owns the order manager (the deploy signs with
 * account 0) so the keeper step can resolve deferred executions without a
 * resolver-role grant. Returns null when no local account matches.
 */
async function resolveKeeper({
  addresses,
  publicClient,
  rpcUrl,
}: {
  addresses: VenueAddresses;
  publicClient: LocalPublicClient;
  rpcUrl: string;
}): Promise<Keeper | null> {
  const owner = await publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: addresses.orderManager,
    functionName: "owner",
  });

  for (let index = 0; index < ownerAccountScanLimit; index += 1) {
    const account = mnemonicToAccount(localDevMnemonic, {
      addressIndex: index,
    });
    if (account.address.toLowerCase() === owner.toLowerCase()) {
      return {
        account,
        walletClient: createWalletClient({
          account,
          chain: hardhat,
          transport: http(rpcUrl),
        }),
      };
    }
  }

  return null;
}

/** Reads the market's YES probability as a percentage, or null on failure. */
async function readYesDisplayPercent({
  manifest,
  publicClient,
}: {
  manifest: CompleteSetMarketManifestData;
  publicClient: LocalPublicClient;
}): Promise<number | null> {
  try {
    const price = await readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: manifest.pools.yes.outcomeIsCurrency0,
      poolId: manifest.pools.yes.poolId,
      publicClient,
      stateView: manifest.venue.stateView,
    });
    return Number(formatUnits(price.displayPriceWad, outcomeDecimals)) * 100;
  } catch {
    return null;
  }
}

async function readPoolBounds({
  addresses,
  poolId,
  publicClient,
}: {
  addresses: VenueAddresses;
  poolId: Hex;
  publicClient: LocalPublicClient;
}): Promise<{ lowerTick: number; upperTick: number }> {
  const bounds = await publicClient.readContract({
    abi: poolTickBoundsAbi,
    address: addresses.poolTickBounds,
    functionName: "getPoolTickBounds",
    args: [poolId],
  });
  if (!bounds[0]) {
    throw new Error(
      `pool ${poolId} has no registered price bounds; the venue cannot trade it.`,
    );
  }
  return { lowerTick: bounds[1], upperTick: bounds[2] };
}

/** Reconstructs the market manifest the venue helpers expect from env + chain. */
async function buildManifest({
  addresses,
  publicClient,
}: {
  addresses: VenueAddresses;
  publicClient: LocalPublicClient;
}): Promise<CompleteSetMarketManifestData> {
  const [
    collateralDecimals,
    resolver,
    onChainYesToken,
    onChainNoToken,
    symbol,
  ] = await Promise.all([
    publicClient.readContract({
      abi: mockCollateralAbi,
      address: addresses.collateral,
      functionName: "decimals",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: addresses.market,
      functionName: "resolver",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: addresses.market,
      functionName: "yesToken",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: addresses.market,
      functionName: "noToken",
    }),
    publicClient
      .readContract({
        abi: outcomeTokenAbi,
        address: addresses.yesToken,
        functionName: "symbol",
      })
      .catch(() => `PCM-${addresses.market.slice(2, 10)}`),
  ]);

  // The price, deposit, and WAD math all assume 18-decimal collateral (the
  // ADR 0009 local venue); refuse to trade a mis-scaled collateral rather than
  // submit amounts off by the decimal factor.
  if (collateralDecimals !== outcomeDecimals) {
    throw new Error(
      `This helper assumes ${outcomeDecimals}-decimal collateral, but ` +
        `${addresses.collateral} reports ${collateralDecimals} decimals.`,
    );
  }

  // Guard against a stale env that points at tokens the market no longer uses:
  // the pool-id check below is env-internal and would pass on a consistent but
  // outdated set, so confirm the env tokens against the market on-chain.
  for (const [label, envToken, onChainToken] of [
    ["YES", addresses.yesToken, onChainYesToken],
    ["NO", addresses.noToken, onChainNoToken],
  ] as const) {
    if (getAddress(onChainToken) !== getAddress(envToken)) {
      throw new Error(
        `Market ${addresses.market} reports its ${label} token as ` +
          `${onChainToken}, but the env has ${envToken}. Regenerate ` +
          "server/.env.local-chain — it is stale.",
      );
    }
  }

  const buildPool = async (
    outcomeToken: Address,
    poolIdFromEnv: Hex,
  ): Promise<CompleteSetMarketPool> => {
    const outcomeIsCurrency0 =
      BigInt(outcomeToken.toLowerCase()) <
      BigInt(addresses.collateral.toLowerCase());
    const poolKey = {
      currency0: outcomeIsCurrency0 ? outcomeToken : addresses.collateral,
      currency1: outcomeIsCurrency0 ? addresses.collateral : outcomeToken,
      fee: COMPLETE_SET_PRICE_POLICY.poolFee,
      hooks: addresses.boundedHook,
      tickSpacing: COMPLETE_SET_PRICE_POLICY.tickSpacing,
    };
    const poolId = computePoolId(poolKey);
    if (poolId.toLowerCase() !== poolIdFromEnv.toLowerCase()) {
      throw new Error(
        `Reconstructed pool id ${poolId} does not match the env pool id ` +
          `${poolIdFromEnv}; the app policy constants and the deployed venue ` +
          "have drifted.",
      );
    }
    const bounds = await readPoolBounds({ addresses, poolId, publicClient });
    return {
      boundLowerTick: bounds.lowerTick,
      boundUpperTick: bounds.upperTick,
      outcomeIsCurrency0,
      outcomeToken,
      poolId,
      poolKey,
    };
  };

  const [yes, no] = await Promise.all([
    buildPool(addresses.yesToken, addresses.yesPoolId),
    buildPool(addresses.noToken, addresses.noPoolId),
  ]);

  return {
    chainId: localDevChainId,
    collateral: { address: addresses.collateral, decimals: collateralDecimals },
    market: {
      address: addresses.market,
      noToken: addresses.noToken,
      outcomeDecimals,
      resolver,
      symbol,
      yesToken: addresses.yesToken,
    },
    pools: { no, yes },
    venue: {
      boundedHook: addresses.boundedHook,
      orderManager: addresses.orderManager,
      poolManager: addresses.poolManager,
      poolTickBounds: addresses.poolTickBounds,
      stateView: addresses.stateView,
    },
  };
}

async function assertMarketTradeable({
  addresses,
  publicClient,
}: {
  addresses: VenueAddresses;
  publicClient: LocalPublicClient;
}): Promise<void> {
  const status = await publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: addresses.market,
    functionName: "status",
  });
  // CompleteSetBinaryMarket.Status: Trading = 0, Resolved = 1, Cancelled = 2.
  if (Number(status) !== 0) {
    throw new Error(
      `market ${addresses.market} has status ${status}; only Trading markets ` +
        "accept orders (it may already be resolved or cancelled).",
    );
  }
}

async function validateLocalDeployment({
  addresses,
  publicClient,
  rpcUrl,
}: {
  addresses: VenueAddresses;
  publicClient: LocalPublicClient;
  rpcUrl: string;
}): Promise<void> {
  let chainId: number;
  try {
    chainId = await publicClient.getChainId();
  } catch (error) {
    throw new Error(
      `Cannot reach local RPC at ${rpcUrl}. Start the local stack with ` +
        `'just local-dev-control' or 'just local-dev'. (${getErrorMessage(error)})`,
    );
  }

  if (chainId !== localDevChainId) {
    throw new Error(
      `RPC_HTTP_URL=${rpcUrl} reported chain ${chainId}, but bot-trade-postgrad ` +
        `expects the local devchain ${localDevChainId}.`,
    );
  }

  for (const [name, address] of [
    ["SWAP_ROUTER_ADDRESS", addresses.swapRouter],
    ["ORDER_MANAGER_ADDRESS", addresses.orderManager],
    ["COMPLETE_SET_MARKET_ADDRESS", addresses.market],
  ] as const) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") {
      throw new Error(
        `No contract code at ${name}=${address} on ${rpcUrl}. Restart the ` +
          "stack with 'just local-dev-control' and wait for the venue deploy.",
      );
    }
  }
}

function readVenueAddresses(
  env: NodeJS.ProcessEnv,
  envFile: string,
  envFileExists: boolean,
): VenueAddresses {
  const read = (...names: string[]): string => {
    for (const name of names) {
      const value = env[name];
      if (value) {
        return value;
      }
    }
    throw new Error(
      `${
        envFileExists
          ? `${envFile} is missing ${names[0]}`
          : `Missing ${envFile}`
      }. Start the local stack with 'just local-dev-control' or 'just ` +
        "local-dev' and wait for the postgrad venue + demo market to deploy.",
    );
  };

  return {
    boundedHook: parseAddress(
      "BOUNDED_HOOK_ADDRESS",
      read("LOCAL_BOUNDED_HOOK_ADDRESS", "BOUNDED_HOOK_ADDRESS"),
    ),
    collateral: parseAddress(
      "COLLATERAL_ADDRESS",
      read("LOCAL_COLLATERAL_ADDRESS", "COLLATERAL_ADDRESS"),
    ),
    market: parseAddress(
      "COMPLETE_SET_MARKET_ADDRESS",
      read("LOCAL_COMPLETE_SET_MARKET_ADDRESS", "COMPLETE_SET_MARKET_ADDRESS"),
    ),
    noPoolId: parseBytes32(
      "COMPLETE_SET_NO_POOL_ID",
      read("LOCAL_COMPLETE_SET_NO_POOL_ID", "COMPLETE_SET_NO_POOL_ID"),
    ),
    noToken: parseAddress(
      "COMPLETE_SET_NO_TOKEN_ADDRESS",
      read(
        "LOCAL_COMPLETE_SET_NO_TOKEN_ADDRESS",
        "COMPLETE_SET_NO_TOKEN_ADDRESS",
      ),
    ),
    orderManager: parseAddress(
      "ORDER_MANAGER_ADDRESS",
      read("LOCAL_ORDER_MANAGER_ADDRESS", "ORDER_MANAGER_ADDRESS"),
    ),
    poolManager: parseAddress(
      "POOL_MANAGER_ADDRESS",
      read("LOCAL_POOL_MANAGER_ADDRESS", "POOL_MANAGER_ADDRESS"),
    ),
    poolTickBounds: parseAddress(
      "POOL_TICK_BOUNDS_ADDRESS",
      read("LOCAL_POOL_TICK_BOUNDS_ADDRESS", "POOL_TICK_BOUNDS_ADDRESS"),
    ),
    stateView: parseAddress(
      "STATE_VIEW_ADDRESS",
      read("LOCAL_STATE_VIEW_ADDRESS", "STATE_VIEW_ADDRESS"),
    ),
    swapRouter: parseAddress(
      "SWAP_ROUTER_ADDRESS",
      read("LOCAL_SWAP_ROUTER_ADDRESS", "SWAP_ROUTER_ADDRESS"),
    ),
    yesPoolId: parseBytes32(
      "COMPLETE_SET_YES_POOL_ID",
      read("LOCAL_COMPLETE_SET_YES_POOL_ID", "COMPLETE_SET_YES_POOL_ID"),
    ),
    yesToken: parseAddress(
      "COMPLETE_SET_YES_TOKEN_ADDRESS",
      read(
        "LOCAL_COMPLETE_SET_YES_TOKEN_ADDRESS",
        "COMPLETE_SET_YES_TOKEN_ADDRESS",
      ),
    ),
  };
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    bias: undefined,
    botCount: undefined,
    defaults: false,
    envFile: undefined,
    help: false,
    intervalMs: undefined,
    keeper: undefined,
    keeperEvery: undefined,
    limitShare: undefined,
    mode: undefined,
    seedCollateral: undefined,
    size: undefined,
    tradeCount: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    const readValue = (name: string): string => {
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
      const value = args[index + 1];
      if (value === undefined) {
        throw new Error(`${name} requires a value.`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--defaults") {
      options.defaults = true;
    } else if (arg === "--no-keeper") {
      options.keeper = false;
    } else if (arg === "--mode" || arg.startsWith("--mode=")) {
      options.mode = parseMode(readValue("--mode"));
    } else if (arg === "--count" || arg.startsWith("--count=")) {
      options.tradeCount = parsePositiveInt("--count", readValue("--count"));
    } else if (arg === "--interval-ms" || arg.startsWith("--interval-ms=")) {
      options.intervalMs = parseNonNegativeInt(
        "--interval-ms",
        readValue("--interval-ms"),
      );
    } else if (arg === "--bots" || arg.startsWith("--bots=")) {
      const value = parsePositiveInt("--bots", readValue("--bots"));
      if (value > maxBotCount) {
        throw new Error(`--bots must be between 1 and ${maxBotCount}.`);
      }
      options.botCount = value;
    } else if (arg === "--size" || arg.startsWith("--size=")) {
      options.size = parseSize(readValue("--size"));
    } else if (arg === "--bias" || arg.startsWith("--bias=")) {
      options.bias = parseBias(readValue("--bias"));
    } else if (arg === "--limit-share" || arg.startsWith("--limit-share=")) {
      options.limitShare = parseBoundedInt(
        "--limit-share",
        readValue("--limit-share"),
        0,
        100,
      );
    } else if (arg === "--keeper-every" || arg.startsWith("--keeper-every=")) {
      options.keeperEvery = parsePositiveInt(
        "--keeper-every",
        readValue("--keeper-every"),
      );
    } else if (
      arg === "--seed-collateral" ||
      arg.startsWith("--seed-collateral=")
    ) {
      options.seedCollateral = parsePositiveInt(
        "--seed-collateral",
        readValue("--seed-collateral"),
      );
    } else if (
      arg === "--local-chain-env" ||
      arg.startsWith("--local-chain-env=")
    ) {
      options.envFile = readValue("--local-chain-env");
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:bot-trade-postgrad -- [options]

Make bot wallets trade a graduated (post-graduation) market on the local
bounded venue: market orders (v4 swaps) and resting limit orders (order
manager). The script seeds pool depth and, signing as the order manager owner,
drains the deferred executions that fill crossed limit orders. Bots mint their
own test collateral (pUSD) and complete-set inventory.

Options:
  --mode <mode>             burst (${modePresets.burst.tradeCount} instant actions), steady (every 2s),
                            or frenzy (every 250ms). Defaults to burst.
  --count <n>               Exact number of actions (overrides --mode).
  --interval-ms <n>         Delay between actions in ms (overrides --mode).
  --bots <n>                Bot wallets to trade with, 1-${maxBotCount}. Defaults to 3.
  --size <size>             small (1-5), medium (5-25), large (25-100), or
                            mixed. Whole-unit trade size. Defaults to mixed.
  --bias <bias>             balanced, bullish (70% push YES up), or bearish
                            (70% push YES down). Defaults to balanced.
  --limit-share <pct>       Percent of actions placed as limit orders (0-100).
                            Defaults to 35.
  --keeper-every <n>        Drain deferred executions every n actions.
                            Defaults to 6.
  --no-keeper               Do not seed liquidity or fill crossed orders. Orders
                            still rest; market swaps need existing depth.
  --seed-collateral <n>     Backstop liquidity budget per pool side, in whole
                            pUSD. Defaults to 20000.
  --defaults                Skip all prompts and accept every default.
  --local-chain-env <path>  Load a generated local-chain env file.
                            Defaults to server/.env.local-chain.
  -h, --help                Show this help.

Examples:
  pnpm run local:bot-trade-postgrad                    interactive
  pnpm run local:bot-trade-postgrad -- --defaults      burst of 20 actions
  pnpm run local:bot-trade-postgrad -- --mode frenzy --bias bullish
  pnpm run local:bot-trade-postgrad -- --count 100 --interval-ms 50 --limit-share 50

Start the local stack first with 'just local-dev-control' or 'just local-dev'.`);
}

async function promptChoice(
  rl: Interface,
  header: string,
  labels: readonly string[],
  defaultIndex: number,
): Promise<number> {
  console.log(header);
  labels.forEach((label, index) => {
    console.log(`  ${index + 1}) ${label}`);
  });

  for (;;) {
    const answer = (await rl.question(`Choice [${defaultIndex + 1}]: `)).trim();
    if (answer === "") {
      return defaultIndex;
    }
    const value = Number.parseInt(answer, 10);
    if (Number.isInteger(value) && value >= 1 && value <= labels.length) {
      return value - 1;
    }
    console.log(`Enter a number between 1 and ${labels.length}.`);
  }
}

async function promptInt(
  rl: Interface,
  label: string,
  fallback: number,
  min: number,
  max: number,
): Promise<number> {
  for (;;) {
    const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
    if (answer === "") {
      return fallback;
    }
    const value = Number.parseInt(answer, 10);
    if (Number.isInteger(value) && value >= min && value <= max) {
      return value;
    }
    console.log(`Enter a number between ${min} and ${max}.`);
  }
}

async function promptOptionalInt(
  rl: Interface,
  label: string,
  min: number,
): Promise<number | null> {
  for (;;) {
    const answer = (await rl.question(label)).trim();
    if (answer === "") {
      return null;
    }
    const value = Number.parseInt(answer, 10);
    if (Number.isInteger(value) && value >= min) {
      return value;
    }
    console.log(`Enter a number of at least ${min}, or leave empty.`);
  }
}

function pickTradeUnits(size: SizePreset): number {
  const range =
    size === "mixed"
      ? sizeRanges[
          (["small", "medium", "large"] as const)[
            Math.floor(Math.random() * 3)
          ] as keyof typeof sizeRanges
        ]
      : sizeRanges[size];
  return range[0] + Math.floor(Math.random() * (range[1] - range[0] + 1));
}

function printSummary({
  endPrice,
  startPrice,
  stats,
}: {
  endPrice: number | null;
  startPrice: number | null;
  stats: TradeStats;
}): void {
  console.log(
    `[bot-postgrad] done: ${stats.marketOrders} market, ${stats.limitOrders} ` +
      `limit, ${stats.ordersFilled} filled, ${stats.cancels} cancels, ` +
      `${stats.skips} skipped, ${stats.failures} failed, ` +
      `${stats.volumeUsd.toFixed(2)} pUSD swap volume`,
  );
  if (stats.deferredResolved > 0) {
    console.log(
      `[bot-postgrad] keeper resolved ${stats.deferredResolved} deferred ` +
        `execution batch${stats.deferredResolved === 1 ? "" : "es"}`,
    );
  }
  if (startPrice !== null && endPrice !== null) {
    console.log(
      `[bot-postgrad] YES ${startPrice.toFixed(1)}% → ${endPrice.toFixed(1)}%`,
    );
  }
}

function describePattern(plan: RunPlan): string {
  const count = plan.tradeCount === null ? "unlimited" : `${plan.tradeCount}`;
  if (plan.intervalMs === 0) {
    return `${count} actions, back to back`;
  }
  return `${count} actions, every ${plan.intervalMs}ms`;
}

function describeBias(biasYesPercent: number): string {
  if (biasYesPercent === 50) {
    return "balanced";
  }
  return biasYesPercent > 50
    ? `bullish (${biasYesPercent}% up)`
    : `bearish (${100 - biasYesPercent}% down)`;
}

/** keccak256 of the ABI-encoded pool key (the v4 pool id). */
function computePoolId(key: CompleteSetMarketPool["poolKey"]): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        {
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
          type: "tuple",
        },
      ],
      [key],
    ),
  );
}

function sqrtPriceX96ToDisplayPriceWadForTick({
  collateralDecimals,
  outcomeIsCurrency0,
  tick,
}: {
  collateralDecimals: number;
  outcomeIsCurrency0: boolean;
  tick: number;
}): bigint {
  return sqrtPriceX96ToDisplayPriceWad({
    collateralDecimals,
    outcomeDecimals,
    outcomeIsCurrency0,
    sqrtPriceX96: tickToSqrtPriceX96(tick),
  });
}

function makeContractWriter(
  walletClient: LocalWalletClient,
  account: ReturnType<typeof mnemonicToAccount>,
) {
  return {
    writeContract: (parameters: {
      abi: readonly unknown[];
      address: Address;
      args: readonly unknown[];
      functionName: string;
    }): Promise<Hex> =>
      walletClient.writeContract({
        abi: parameters.abi as [],
        account,
        address: parameters.address,
        args: parameters.args as [],
        chain: hardhat,
        functionName: parameters.functionName,
      }),
  };
}

async function readErc20Balance({
  account,
  publicClient,
  token,
}: {
  account: Address;
  publicClient: LocalPublicClient;
  token: Address;
}): Promise<bigint> {
  return publicClient.readContract({
    abi: outcomeTokenAbi,
    address: token,
    functionName: "balanceOf",
    args: [account],
  });
}

async function sendAndWait(
  publicClient: LocalPublicClient,
  send: () => Promise<Hex>,
): Promise<void> {
  const hash = await send();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`transaction reverted (${hash}).`);
  }
}

function alignDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function alignUp(tick: number, spacing: number): number {
  const aligned = Math.ceil(tick / spacing) * spacing;
  return aligned === 0 ? 0 : aligned;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n);
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function parseMode(value: string): ModePreset {
  if (value === "burst" || value === "steady" || value === "frenzy") {
    return value;
  }
  throw new Error("--mode must be burst, steady, or frenzy.");
}

function parseSize(value: string): SizePreset {
  if (
    value === "small" ||
    value === "medium" ||
    value === "large" ||
    value === "mixed"
  ) {
    return value;
  }
  throw new Error("--size must be small, medium, large, or mixed.");
}

function parseBias(value: string): BiasPreset {
  if (value === "balanced" || value === "bullish" || value === "bearish") {
    return value;
  }
  throw new Error("--bias must be balanced, bullish, or bearish.");
}

function parsePositiveInt(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== value) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInt(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || String(parsed) !== value) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function parseBoundedInt(
  name: string,
  value: string,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < min ||
    parsed > max ||
    String(parsed) !== value
  ) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseAddress(name: string, value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name}=${value} is not a valid address.`);
  }
  return getAddress(value);
}

function parseBytes32(name: string, value: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name}=${value} is not a valid bytes32 pool id.`);
  }
  return value as Hex;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function formatTokenAmount(value: bigint): string {
  return Number(formatUnits(value, outcomeDecimals)).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveSleep) => {
    if (signal.aborted || ms <= 0) {
      resolveSleep();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolveSleep();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function getErrorMessage(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "shortMessage" in error &&
    typeof (error as { shortMessage: unknown }).shortMessage === "string"
  ) {
    return (error as { shortMessage: string }).shortMessage;
  }
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? error.message;
  }
  return String(error);
}

function isTerminalMarketError(message: string): boolean {
  return (
    message.includes("MarketNotTrading") ||
    message.includes("MarketResolved") ||
    message.includes("MarketCancelled")
  );
}

/**
 * A swap revert that means "this order could not fill against the band," not a
 * broken call: v4 wraps the bounded hook's / pool's price-limit rejection in a
 * WrappedError (0x90bfb865), and the underlying causes decode as the bound and
 * price-limit errors. Callers treat these as skips rather than failures.
 */
function isSoftSwapRevert(message: string): boolean {
  return (
    message.includes("0x90bfb865") ||
    message.includes("PoolTickOutOfBounds") ||
    message.includes("PriceLimitAlreadyExceeded") ||
    message.includes("PriceLimitOutOfBounds")
  );
}

/**
 * Distinguishes a contract revert (the call ran and reverted — for a cancel,
 * the order was already filled or consumed) from a transport/RPC error, which
 * should surface as a real failure rather than be mistaken for a fill.
 */
function isContractRevert(message: string): boolean {
  return message.toLowerCase().includes("revert");
}

type LocalPublicClient = ReturnType<
  typeof createPublicClient<ReturnType<typeof http>, typeof hardhat>
>;
type LocalWalletClient = ReturnType<
  typeof createWalletClient<
    ReturnType<typeof http>,
    typeof hardhat,
    ReturnType<typeof mnemonicToAccount>
  >
>;
