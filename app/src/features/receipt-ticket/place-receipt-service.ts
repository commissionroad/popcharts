import type { PublicClient, WalletClient } from "viem";
import { formatUnits, parseEventLogs, parseUnits } from "viem";

import { parseApiMarketAppId } from "@/domain/markets/api-market";
import type { Market, MarketSide } from "@/domain/markets/types";
import type {
  PlacedPregradReceipt,
  ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { erc20Abi } from "@/integrations/contracts/erc20";
import { pregradManagerAbi } from "@/integrations/contracts/pregrad-manager";

const TOKEN_DECIMALS = 18;

export type PlaceReceiptWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

export type ReceiptPlacementStep =
  | "approving"
  | "confirming"
  | "minting"
  | "placing"
  | "quoting";

export type PlaceReceiptOptions = {
  onStep?: (step: ReceiptPlacementStep) => void;
  slippageBps?: number;
  wallet?: PlaceReceiptWallet;
};

export type TradingEnvironment =
  | { kind: "contract"; config: PopChartsContractConfig; marketId: bigint }
  | { kind: "mock" };

export async function placePregradReceipt({
  market,
  options = {},
  quote,
  side,
}: {
  market: Market;
  options?: PlaceReceiptOptions;
  quote: ReceiptQuotePreview;
  side: MarketSide;
}): Promise<PlacedPregradReceipt> {
  const environment = resolveTradingEnvironment(market);

  if (environment.kind === "mock") {
    return placeMockReceipt({ market, quote, side });
  }

  return placeContractReceipt({
    environment,
    market,
    options,
    quote,
    side,
  });
}

export function resolveTradingEnvironment(market: Market): TradingEnvironment {
  const config = getPopChartsContractConfig();
  const parsedId = parseApiMarketAppId(market.id);

  if (
    config &&
    parsedId &&
    market.chainId === config.chainId &&
    parsedId.chainId === config.chainId
  ) {
    return { config, kind: "contract", marketId: BigInt(parsedId.marketId) };
  }

  return { kind: "mock" };
}

async function placeMockReceipt({
  market,
  quote,
  side,
}: {
  market: Market;
  quote: ReceiptQuotePreview;
  side: MarketSide;
}): Promise<PlacedPregradReceipt> {
  await new Promise((resolve) => window.setTimeout(resolve, 180));

  const receiptId = `mock-${Date.now().toString(36)}`;

  return {
    averagePriceCents: quote.averagePriceCents,
    collateralUsd: quote.budgetUsd,
    createdAt: new Date().toISOString(),
    id: `${market.id}:${receiptId}`,
    marketId: market.id,
    marketQuestion: market.question,
    priceBand: quote.priceBand,
    receiptId,
    shares: quote.shares,
    side,
    status: "waiting",
  };
}

async function placeContractReceipt({
  environment,
  market,
  options,
  quote,
  side,
}: {
  environment: Extract<TradingEnvironment, { kind: "contract" }>;
  market: Market;
  options: PlaceReceiptOptions;
  quote: ReceiptQuotePreview;
  side: MarketSide;
}): Promise<PlacedPregradReceipt> {
  const wallet = options.wallet;

  if (!wallet) {
    throw new Error("Connect a wallet before placing a receipt.");
  }

  if (wallet.activeChainId !== environment.config.chainId) {
    throw new Error(`Switch your wallet to chain ${environment.config.chainId}.`);
  }

  const shares = toTokenUnits(quote.shares);
  const sideIndex = side === "yes" ? 0 : 1;

  options.onStep?.("quoting");
  const marketExists = await wallet.publicClient.readContract({
    abi: pregradManagerAbi,
    address: environment.config.pregradManagerAddress,
    functionName: "marketExists",
    args: [environment.marketId],
  });

  if (!marketExists) {
    throw new Error(
      "This market is not available on the current PregradManager. Create a new local market and try again."
    );
  }

  const chainQuote = await wallet.publicClient.readContract({
    abi: pregradManagerAbi,
    address: environment.config.pregradManagerAddress,
    functionName: "quoteReceipt",
    args: [environment.marketId, sideIndex, shares],
  });
  const maxCost = applySlippage(chainQuote.cost, options.slippageBps ?? 150);

  await ensureCollateralReady({
    config: environment.config,
    cost: maxCost,
    onStep: options.onStep,
    wallet,
  });

  options.onStep?.("placing");
  const hash = await wallet.walletClient.writeContract({
    abi: pregradManagerAbi,
    account: wallet.accountAddress,
    address: environment.config.pregradManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "placeReceipt",
    args: [
      {
        marketId: environment.marketId,
        maxCost,
        shares,
        side: sideIndex,
      },
    ],
  });

  options.onStep?.("confirming");
  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const receiptLogs = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "ReceiptPlaced",
    logs: transactionReceipt.logs,
  });
  const receiptPlaced = receiptLogs.find(
    (log) => log.args.marketId === environment.marketId
  );

  if (!receiptPlaced) {
    throw new Error("Transaction succeeded but ReceiptPlaced was not emitted.");
  }

  const costUsd = Number(formatUnits(receiptPlaced.args.cost, TOKEN_DECIMALS));

  return {
    averagePriceCents:
      quote.shares > 0 ? (costUsd / quote.shares) * 100 : quote.averagePriceCents,
    collateralUsd: costUsd,
    createdAt: new Date().toISOString(),
    id: `${environment.config.chainId}:${receiptPlaced.args.receiptId.toString()}`,
    marketId: market.id,
    marketQuestion: market.question,
    priceBand: quote.priceBand,
    receiptId: receiptPlaced.args.receiptId.toString(),
    sequence: receiptPlaced.args.sequence.toString(),
    shares: quote.shares,
    side,
    status: "waiting",
    transactionHash: hash,
  };
}

async function ensureCollateralReady({
  config,
  cost,
  onStep,
  wallet,
}: {
  config: PopChartsContractConfig;
  cost: bigint;
  onStep: ((step: ReceiptPlacementStep) => void) | undefined;
  wallet: PlaceReceiptWallet;
}) {
  const balance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: config.collateralAddress,
    functionName: "balanceOf",
    args: [wallet.accountAddress],
  });

  if (balance < cost) {
    throw new Error(
      `Insufficient pUSD. You have ${formatTokenAmount(
        balance
      )} pUSD available, but this receipt can cost up to ${formatTokenAmount(
        cost
      )} pUSD.`
    );
  }

  const allowance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: config.collateralAddress,
    functionName: "allowance",
    args: [wallet.accountAddress, config.pregradManagerAddress],
  });

  if (allowance >= cost) {
    return;
  }

  onStep?.("approving");
  const approvalHash = await wallet.walletClient.writeContract({
    abi: erc20Abi,
    account: wallet.accountAddress,
    address: config.collateralAddress,
    chain: wallet.walletClient.chain,
    functionName: "approve",
    args: [config.pregradManagerAddress, cost],
  });

  await wallet.publicClient.waitForTransactionReceipt({ hash: approvalHash });
}

export async function mintLocalCollateral({
  amountUsd,
  config,
  onStep,
  wallet,
}: {
  amountUsd: number;
  config: PopChartsContractConfig;
  onStep?: (step: ReceiptPlacementStep) => void;
  wallet: PlaceReceiptWallet;
}) {
  if (!canMintLocalCollateral(config)) {
    throw new Error("Test pUSD minting is only available on local dev chains.");
  }

  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId}.`);
  }

  onStep?.("minting");
  const hash = await wallet.walletClient.writeContract({
    abi: erc20Abi,
    account: wallet.accountAddress,
    address: config.collateralAddress,
    chain: wallet.walletClient.chain,
    functionName: "mint",
    args: [wallet.accountAddress, toTokenUnits(amountUsd)],
  });

  await wallet.publicClient.waitForTransactionReceipt({ hash });
}

function applySlippage(cost: bigint, slippageBps: number) {
  return (cost * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}

export function canMintLocalCollateral(config: PopChartsContractConfig) {
  return config.chainEnv === "local" || config.chainEnv === "mock";
}

function toTokenUnits(value: number) {
  return parseUnits(toDecimalString(value), TOKEN_DECIMALS);
}

function toDecimalString(value: number) {
  return value.toFixed(8).replace(/\.?0+$/, "");
}

function formatTokenAmount(value: bigint) {
  const amount = Number(formatUnits(value, TOKEN_DECIMALS));

  return amount.toLocaleString("en-US", {
    maximumFractionDigits: amount >= 100 ? 0 : 2,
    minimumFractionDigits: amount > 0 && amount < 100 ? 2 : 0,
  });
}
