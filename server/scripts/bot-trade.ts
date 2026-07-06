import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  maxUint256,
  parseAbi,
  parseEventLogs,
  parseUnits,
  type Address,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";

/**
 * Interactive local-dev helper that makes bot wallets trade on a pregrad
 * market. Useful for exercising price movement, receipt volume, and indexer
 * throughput without clicking through the app.
 *
 * The bots are devchain mnemonic accounts (indices 10-19, so they never race
 * the deployer or orchestrator accounts on nonces). They mint their own mock
 * collateral, approve the PregradManager once, then place receipts following
 * the chosen pattern until the trade count is reached or Ctrl+C.
 *
 * Run `pnpm run local:bot-trade` from the repo root (or
 * `just local-bot-trade`) with the local stack up. Every setting has a flag,
 * so it also works non-interactively: `--defaults` accepts every default.
 */

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvFile = resolve(serverDir, ".env.local-chain");
const defaultRpcHttpUrl = "http://127.0.0.1:8545";
const defaultApiPort = "3001";
const localDevChainId = hardhat.id;
const localDevMnemonic =
  "test test test test test test test test test test test junk";
const firstBotAccountIndex = 10;
const maxBotCount = 10;
const tokenDecimals = 18;
const minCollateralBalance = parseUnits("100000", tokenDecimals);
const collateralMintAmount = parseUnits("1000000", tokenDecimals);
const minAllowance = parseUnits("10000000", tokenDecimals);
const slippageBps = 1000n;
const probeShares = parseUnits("1", tokenDecimals);
const apiTimeoutMs = 8_000;
const maxConsecutiveFailures = 5;
const marketListLimit = 15;
const questionDisplayLength = 72;

const pregradManagerAbi = parseAbi([
  "struct ReceiptParams { uint256 marketId; uint8 side; uint256 shares; uint256 maxCost; }",
  "function placeReceipt(ReceiptParams params) returns (uint256 receiptId)",
  "function quoteReceipt(uint256 marketId, uint8 side, uint256 shares) view returns ((uint256 cost, int256 rLow, int256 rHigh))",
  "function marketExists(uint256 marketId) view returns (bool)",
  "function getMarketState(uint256 marketId) view returns ((uint8 status, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt))",
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
]);

const collateralAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address account, uint256 amount)",
]);

const PREGRAD_MARKET_STATUS_ACTIVE = 0;

const modePresets = {
  burst: { intervalMs: 0, label: "burst", tradeCount: 20 },
  frenzy: { intervalMs: 250, label: "frenzy", tradeCount: null },
  steady: { intervalMs: 2_000, label: "steady", tradeCount: null },
} as const;

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

type CliOptions = {
  apiBaseUrl: string | undefined;
  bias: BiasPreset | undefined;
  botCount: number | undefined;
  defaults: boolean;
  envFile: string | undefined;
  help: boolean;
  intervalMs: number | undefined;
  marketId: string | undefined;
  mode: ModePreset | undefined;
  size: SizePreset | undefined;
  tradeCount: number | undefined;
};

type ApiMarket = {
  marketId: string;
  metadata?: { question?: string };
  receiptCount: string;
  status: string;
};

type SelectedMarket = {
  id: bigint;
  question: string;
};

type RunPlan = {
  biasYesPercent: number;
  botCount: number;
  intervalMs: number;
  market: SelectedMarket;
  size: SizePreset;
  tradeCount: number | null;
};

type TradeStats = {
  attempts: number;
  failures: number;
  noTrades: number;
  volumeUsd: number;
  yesTrades: number;
};

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

main().catch((error: unknown) => {
  console.error(`\n[bot-trade] ${getErrorMessage(error)}`);
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
  const fileEnv = envFileExists ? readEnvFile(envFile) : {};
  const env: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };

  const managerAddress = readRequiredAddress(
    env,
    "PREGRAD_MANAGER_ADDRESS",
    envFile,
    envFileExists,
  );
  const collateralAddress = readCollateralAddress(env, envFile, envFileExists);
  const rpcUrl = env.RPC_HTTP_URL ?? defaultRpcHttpUrl;
  const apiBaseUrl = readApiBaseUrl(options, env);

  if (envFileExists) {
    console.log(`[bot-trade] loading ${envFile}`);
  }

  const publicClient = createPublicClient({
    chain: hardhat,
    transport: http(rpcUrl),
  });

  await validateLocalDeployment(publicClient, managerAddress, rpcUrl, envFile);

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

  const plan = await buildRunPlan({
    apiBaseUrl,
    options,
    publicClient,
    managerAddress,
    rl,
  });

  rl?.close();

  const bots = Array.from({ length: plan.botCount }, (_, index) => {
    const account = mnemonicToAccount(localDevMnemonic, {
      addressIndex: firstBotAccountIndex + index,
    });

    return {
      account,
      label: `bot${index + 1}`,
      walletClient: createWalletClient({
        account,
        chain: hardhat,
        transport: http(rpcUrl),
      }),
    };
  });
  type Bot = (typeof bots)[number];

  console.log(
    `[bot-trade] market #${plan.market.id}: ${plan.market.question}`,
  );
  console.log(
    `[bot-trade] pattern: ${describePattern(plan)} | bots: ${
      plan.botCount
    } | size: ${plan.size} | bias: ${describeBias(plan.biasYesPercent)}`,
  );

  for (const bot of bots) {
    await fundBot({ bot, collateralAddress, managerAddress, publicClient });
  }

  const startImpliedYes = await readImpliedYesPercent(
    publicClient,
    managerAddress,
    plan.market.id,
  );

  if (startImpliedYes !== null) {
    console.log(
      `[bot-trade] implied YES ${startImpliedYes.toFixed(1)}% — trading` +
        `${plan.tradeCount === null ? " until Ctrl+C" : ""}`,
    );
  }

  const stopController = new AbortController();
  process.once("SIGINT", () => {
    console.log("\n[bot-trade] stopping after the current trade…");
    stopController.abort();
    process.once("SIGINT", () => process.exit(130));
  });

  const stats: TradeStats = {
    attempts: 0,
    failures: 0,
    noTrades: 0,
    volumeUsd: 0,
    yesTrades: 0,
  };
  let lastImpliedYes = startImpliedYes;
  let consecutiveFailures = 0;

  while (
    !stopController.signal.aborted &&
    (plan.tradeCount === null || stats.attempts < plan.tradeCount)
  ) {
    stats.attempts += 1;
    const bot = bots[Math.floor(Math.random() * bots.length)] as Bot;
    const side = Math.random() * 100 < plan.biasYesPercent ? 0 : 1;
    const wholeShares = pickTradeShares(plan.size);

    try {
      const costUsd = await placeBotTrade({
        bot,
        managerAddress,
        marketId: plan.market.id,
        publicClient,
        side,
        wholeShares,
      });

      consecutiveFailures = 0;
      stats.volumeUsd += costUsd;
      if (side === 0) {
        stats.yesTrades += 1;
      } else {
        stats.noTrades += 1;
      }

      lastImpliedYes = await readImpliedYesPercent(
        publicClient,
        managerAddress,
        plan.market.id,
      );

      console.log(
        `[bot-trade] ${timestamp()} ${bot.label} ${side === 0 ? "YES" : "NO "}` +
          ` ${String(wholeShares).padStart(3)} shares` +
          ` @ ${(costUsd / wholeShares).toFixed(3)}` +
          ` cost ${costUsd.toFixed(2)} pUSD` +
          `${lastImpliedYes === null ? "" : ` → YES ${lastImpliedYes.toFixed(1)}%`}` +
          ` (trade ${stats.attempts})`,
      );
    } catch (error) {
      stats.failures += 1;
      consecutiveFailures += 1;
      const message = getErrorMessage(error);

      if (isTerminalMarketError(message)) {
        console.error(
          `[bot-trade] market #${plan.market.id} is no longer tradeable: ${message}`,
        );
        break;
      }

      console.warn(
        `[bot-trade] ${timestamp()} ${bot.label} trade failed: ${message}`,
      );

      if (consecutiveFailures >= maxConsecutiveFailures) {
        console.error(
          `[bot-trade] ${maxConsecutiveFailures} trades failed in a row; ` +
            "stopping. Is the local stack healthy?",
        );
        break;
      }
    }

    const isLastTrade =
      plan.tradeCount !== null && stats.attempts >= plan.tradeCount;
    if (plan.intervalMs > 0 && !isLastTrade) {
      await sleep(plan.intervalMs, stopController.signal);
    }
  }

  printSummary(stats, startImpliedYes, lastImpliedYes);
  process.exit(stats.failures > 0 && stats.failures === stats.attempts ? 1 : 0);
}

async function buildRunPlan({
  apiBaseUrl,
  options,
  publicClient,
  managerAddress,
  rl,
}: {
  apiBaseUrl: string;
  options: CliOptions;
  publicClient: LocalPublicClient;
  managerAddress: Address;
  rl: Interface | null;
}): Promise<RunPlan> {
  const market = await selectMarket({
    apiBaseUrl,
    managerAddress,
    marketIdOption: options.marketId,
    publicClient,
    rl,
  });

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
        `burst  — ${modePresets.burst.tradeCount} trades back to back, then exit`,
        "steady — one trade every 2s until Ctrl+C",
        "frenzy — one trade every 250ms until Ctrl+C",
        "custom — pick trade count and interval",
      ],
      0,
    );

    if (patternIndex === 3) {
      tradeCount = await promptOptionalInt(
        rl,
        "How many trades (empty = until Ctrl+C): ",
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
        "Trade size:",
        [
          "small  — 1-5 shares",
          "medium — 5-25 shares",
          "large  — 25-100 shares",
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
          "balanced — 50/50 YES and NO",
          "bullish  — 70% YES",
          "bearish  — 70% NO",
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

  return {
    biasYesPercent: biasYesPercents[bias],
    botCount,
    intervalMs,
    market,
    size,
    tradeCount,
  };
}

async function selectMarket({
  apiBaseUrl,
  managerAddress,
  marketIdOption,
  publicClient,
  rl,
}: {
  apiBaseUrl: string;
  managerAddress: Address;
  marketIdOption: string | undefined;
  publicClient: LocalPublicClient;
  rl: Interface | null;
}): Promise<SelectedMarket> {
  if (marketIdOption !== undefined) {
    const id = BigInt(marketIdOption);
    await assertMarketTradeable(publicClient, managerAddress, id);
    const markets = await fetchMarkets(apiBaseUrl).catch(() => []);
    const match = markets.find((market) => market.marketId === id.toString());

    return {
      id,
      question: match?.metadata?.question ?? "(question unavailable)",
    };
  }

  const markets = await fetchMarkets(apiBaseUrl).catch((error: unknown) => {
    throw new Error(
      `Could not list markets from ${apiBaseUrl} (${getErrorMessage(error)}). ` +
        "Start the local stack with 'just local-dev-control' or pass " +
        "--market <id> to skip the listing.",
    );
  });
  const tradeable = markets.filter((market) => market.status === "bootstrap");

  if (tradeable.length === 0) {
    throw new Error(
      "No tradeable (bootstrap) markets found. Create one with " +
        "'just local-create-market' and wait for review to approve it.",
    );
  }

  const shown = tradeable.slice(0, marketListLimit);
  let index = 0;

  if (rl && shown.length > 1) {
    index = await promptChoice(
      rl,
      `Tradeable markets (newest first${
        tradeable.length > shown.length
          ? `, showing ${shown.length} of ${tradeable.length}`
          : ""
      }):`,
      shown.map(
        (market) =>
          `#${market.marketId}  ${truncate(
            market.metadata?.question ?? "(no metadata)",
            questionDisplayLength,
          )}  (${market.receiptCount} receipts)`,
      ),
      0,
    );
  }

  const chosen = shown[index] as ApiMarket;
  const id = BigInt(chosen.marketId);
  await assertMarketTradeable(publicClient, managerAddress, id);

  return {
    id,
    question: chosen.metadata?.question ?? "(no metadata)",
  };
}

async function assertMarketTradeable(
  publicClient: LocalPublicClient,
  managerAddress: Address,
  marketId: bigint,
): Promise<void> {
  const exists = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: managerAddress,
    functionName: "marketExists",
    args: [marketId],
  });

  if (!exists) {
    throw new Error(
      `Market ${marketId} does not exist on the current PregradManager.`,
    );
  }

  const state = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: managerAddress,
    functionName: "getMarketState",
    args: [marketId],
  });

  if (Number(state.status) !== PREGRAD_MARKET_STATUS_ACTIVE) {
    throw new Error(
      `Market ${marketId} has contract status ${state.status}; only active ` +
        "(bootstrap) markets accept receipts.",
    );
  }
}

async function fundBot({
  bot,
  collateralAddress,
  managerAddress,
  publicClient,
}: {
  bot: {
    account: { address: Address };
    label: string;
    walletClient: LocalWalletClient;
  };
  collateralAddress: Address;
  managerAddress: Address;
  publicClient: LocalPublicClient;
}): Promise<void> {
  const ethBalance = await publicClient.getBalance({
    address: bot.account.address,
  });

  if (ethBalance === 0n) {
    throw new Error(
      `${bot.label} (${bot.account.address}) has no gas ETH. The local ` +
        "devchain normally pre-funds mnemonic accounts 0-19; restart it with " +
        "'just local-dev-control'.",
    );
  }

  const notes: string[] = [];
  let balance = await publicClient.readContract({
    abi: collateralAbi,
    address: collateralAddress,
    functionName: "balanceOf",
    args: [bot.account.address],
  });

  if (balance < minCollateralBalance) {
    const mintHash = await bot.walletClient.writeContract({
      abi: collateralAbi,
      address: collateralAddress,
      functionName: "mint",
      args: [bot.account.address, collateralMintAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: mintHash });
    balance += collateralMintAmount;
    notes.push("minted");
  }

  const allowance = await publicClient.readContract({
    abi: collateralAbi,
    address: collateralAddress,
    functionName: "allowance",
    args: [bot.account.address, managerAddress],
  });

  if (allowance < minAllowance) {
    const approveHash = await bot.walletClient.writeContract({
      abi: collateralAbi,
      address: collateralAddress,
      functionName: "approve",
      args: [managerAddress, maxUint256],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    notes.push("approved");
  }

  console.log(
    `[bot-trade] ${bot.label} ${bot.account.address} ` +
      `pUSD ${formatTokenAmount(balance)}` +
      `${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`,
  );
}

async function placeBotTrade({
  bot,
  managerAddress,
  marketId,
  publicClient,
  side,
  wholeShares,
}: {
  bot: {
    account: { address: Address };
    label: string;
    walletClient: LocalWalletClient;
  };
  managerAddress: Address;
  marketId: bigint;
  publicClient: LocalPublicClient;
  side: number;
  wholeShares: number;
}): Promise<number> {
  const shares = parseUnits(String(wholeShares), tokenDecimals);
  const quote = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: managerAddress,
    functionName: "quoteReceipt",
    args: [marketId, side, shares],
  });
  const maxCost = quote.cost + (quote.cost * slippageBps) / 10_000n;

  const hash = await bot.walletClient.writeContract({
    abi: pregradManagerAbi,
    address: managerAddress,
    functionName: "placeReceipt",
    args: [{ marketId, maxCost, shares, side }],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error(`placeReceipt transaction reverted (${hash}).`);
  }

  const placed = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "ReceiptPlaced",
    logs: receipt.logs,
  }).find((log) => log.args.marketId === marketId);

  if (!placed) {
    throw new Error("Transaction succeeded but ReceiptPlaced was not emitted.");
  }

  return Number(formatUnits(placed.args.cost, tokenDecimals));
}

async function readImpliedYesPercent(
  publicClient: LocalPublicClient,
  managerAddress: Address,
  marketId: bigint,
): Promise<number | null> {
  try {
    const quote = await publicClient.readContract({
      abi: pregradManagerAbi,
      address: managerAddress,
      functionName: "quoteReceipt",
      args: [marketId, 0, probeShares],
    });

    return Number(formatUnits(quote.cost, tokenDecimals)) * 100;
  } catch {
    return null;
  }
}

async function validateLocalDeployment(
  publicClient: LocalPublicClient,
  managerAddress: Address,
  rpcUrl: string,
  envFile: string,
): Promise<void> {
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
      `RPC_HTTP_URL=${rpcUrl} reported chain ${chainId}, but bot-trade ` +
        `expects the local devchain ${localDevChainId}. ${envFile} and the ` +
        "running RPC are probably out of sync.",
    );
  }

  const code = await publicClient.getCode({ address: managerAddress });

  if (!code || code === "0x") {
    throw new Error(
      `No contract code at PREGRAD_MANAGER_ADDRESS=${managerAddress} on ` +
        `${rpcUrl}. Restart the stack with 'just local-dev-control' and wait ` +
        "for contract deployment.",
    );
  }
}

async function fetchMarkets(apiBaseUrl: string): Promise<ApiMarket[]> {
  const response = await fetch(
    new URL(
      `markets?chainId=${localDevChainId}`,
      ensureTrailingSlash(apiBaseUrl),
    ),
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(apiTimeoutMs),
    },
  );

  if (!response.ok) {
    throw new Error(`GET ${response.url} returned ${response.status}`);
  }

  return (await response.json()) as ApiMarket[];
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: undefined,
    bias: undefined,
    botCount: undefined,
    defaults: false,
    envFile: undefined,
    help: false,
    intervalMs: undefined,
    marketId: undefined,
    mode: undefined,
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
    } else if (arg === "--market" || arg.startsWith("--market=")) {
      options.marketId = parseMarketId(readValue("--market"));
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
    } else if (
      arg === "--local-chain-env" ||
      arg.startsWith("--local-chain-env=")
    ) {
      options.envFile = readValue("--local-chain-env");
    } else if (arg === "--api-url" || arg.startsWith("--api-url=")) {
      options.apiBaseUrl = readValue("--api-url");
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:bot-trade -- [options]

Make bot wallets trade on a local pregrad market. With no options the helper
runs interactively: pick a market, a trade pattern, and bot settings, each
with a sensible default. Bots mint their own test collateral (pUSD).

Options:
  --market <id>             On-chain market id to trade. Defaults to an
                            interactive pick from tradeable markets.
  --mode <mode>             burst (${modePresets.burst.tradeCount} instant trades), steady (every 2s),
                            or frenzy (every 250ms). Defaults to burst.
  --count <n>               Exact number of trades (overrides --mode).
  --interval-ms <n>         Delay between trades in ms (overrides --mode).
  --bots <n>                Bot wallets to trade with, 1-${maxBotCount}. Defaults to 3.
  --size <size>             small (1-5 shares), medium (5-25), large (25-100),
                            or mixed. Defaults to mixed.
  --bias <bias>             balanced (50/50), bullish (70% YES), or bearish
                            (70% NO). Defaults to balanced.
  --defaults                Skip all prompts and accept every default.
  --api-url <url>           Market listing API base URL.
                            Defaults to http://127.0.0.1:${defaultApiPort}.
  --local-chain-env <path>  Load a generated local-chain env file.
                            Defaults to server/.env.local-chain.
  -h, --help                Show this help.

Examples:
  pnpm run local:bot-trade                          interactive
  pnpm run local:bot-trade -- --defaults            burst of 20 trades, newest market
  pnpm run local:bot-trade -- --mode frenzy --bias bullish
  pnpm run local:bot-trade -- --market 3 --count 100 --interval-ms 50

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

function pickTradeShares(size: SizePreset): number {
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

function printSummary(
  stats: TradeStats,
  startImpliedYes: number | null,
  lastImpliedYes: number | null,
): void {
  const completed = stats.attempts - stats.failures;
  console.log(
    `[bot-trade] done: ${completed} trades (${stats.yesTrades} YES / ` +
      `${stats.noTrades} NO), ${stats.failures} failed, ` +
      `${stats.volumeUsd.toFixed(2)} pUSD volume`,
  );

  if (startImpliedYes !== null && lastImpliedYes !== null) {
    console.log(
      `[bot-trade] implied YES ${startImpliedYes.toFixed(1)}% → ` +
        `${lastImpliedYes.toFixed(1)}%`,
    );
  }
}

function describePattern(plan: RunPlan): string {
  const count = plan.tradeCount === null ? "unlimited" : `${plan.tradeCount}`;

  if (plan.intervalMs === 0) {
    return `${count} trades, back to back`;
  }

  return `${count} trades, every ${plan.intervalMs}ms`;
}

function describeBias(biasYesPercent: number): string {
  if (biasYesPercent === 50) {
    return "balanced";
  }

  return biasYesPercent > 50
    ? `bullish (${biasYesPercent}% YES)`
    : `bearish (${100 - biasYesPercent}% NO)`;
}

function parseMarketId(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error("--market must be a decimal on-chain market id.");
  }

  return value;
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

function readRequiredAddress(
  env: NodeJS.ProcessEnv,
  name: string,
  envFile: string,
  envFileExists: boolean,
): Address {
  const value = env[name];

  if (!value) {
    throw new Error(
      `${envFileExists ? `${envFile} is missing ${name}` : `Missing ${envFile}`}. ` +
        "Start the local stack with 'just local-dev-control' or " +
        "'just local-dev' and wait for contract deployment to complete.",
    );
  }

  return parseAddress(name, value);
}

function readCollateralAddress(
  env: NodeJS.ProcessEnv,
  envFile: string,
  envFileExists: boolean,
): Address {
  const value = env.LOCAL_COLLATERAL_ADDRESS ?? env.COLLATERAL_ADDRESS;

  if (!value) {
    throw new Error(
      `${
        envFileExists
          ? `${envFile} is missing LOCAL_COLLATERAL_ADDRESS`
          : `Missing ${envFile}`
      }. ` +
        "Start the local stack with 'just local-dev-control' or " +
        "'just local-dev' and wait for contract deployment to complete.",
    );
  }

  return parseAddress("LOCAL_COLLATERAL_ADDRESS", value);
}

function parseAddress(name: string, value: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name}=${value} is not a valid address.`);
  }

  return value as Address;
}

function readApiBaseUrl(options: CliOptions, env: NodeJS.ProcessEnv): string {
  return (
    options.apiBaseUrl ??
    env.POPCHARTS_INDEXER_API_URL ??
    env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL ??
    `http://127.0.0.1:${env.LOCAL_API_PORT ?? env.PORT ?? defaultApiPort}`
  );
}

// Matches scripts/shared/env/readEnvFile.ts, which lives outside this
// package's typecheck root.
function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
  }

  return env;
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function formatTokenAmount(value: bigint): string {
  return Number(formatUnits(value, tokenDecimals)).toLocaleString("en-US", {
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
    message.includes("InvalidMarketStatus") ||
    message.includes("MarketDoesNotExist") ||
    message.includes("MarketPastGraduationDeadline")
  );
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
