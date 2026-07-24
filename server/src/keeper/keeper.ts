import {
  COMPLETE_SET_KEEPER_POLICY,
  decideCompleteSetArbAction,
  executeCompleteSetArb,
  findPendingDeferredExecutions,
  readPoolDisplayPrice,
  wadToNumber,
} from "@popcharts/protocol";
import { parseUnits, type PublicClient } from "viem";

import { graduateDevMarket } from "src/api/services/dev-market-graduate";
import { createVenueContractWriter } from "src/api/services/postgrad-venue";
import { refundPregradMarket } from "src/api/services/pregrad-refund";
import type {
  BlockchainClient,
  BlockchainWalletClient,
} from "src/blockchain/client";
import { config } from "src/config";

import type { TrackedMarket, TrackedPregradMarket } from "./discovery";

/**
 * One keeper maintenance pass for one market: read both pool prices, run the
 * complete-set arbitrage policy when the price sum drifts off one full set,
 * and drain any deferred maker-order executions. The pass is idempotent — a
 * healthy market costs four reads and no writes — so it can run after every
 * swap without churning.
 */
export async function runMarketPass({
  clients,
  market,
}: {
  clients: {
    publicClient: BlockchainClient;
    walletClient: BlockchainWalletClient;
  };
  market: TrackedMarket;
}): Promise<{
  action: "buyAndMerge" | "hold" | "mintAndSell";
  priceSumWad: bigint;
  resolvedDeferred: number;
}> {
  const { manifest } = market;
  const publicClient = clients.publicClient as PublicClient;
  const [yes, no] = await Promise.all([
    readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: manifest.pools.yes.outcomeIsCurrency0,
      poolId: manifest.pools.yes.poolId,
      publicClient,
      stateView: manifest.venue.stateView,
    }),
    readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: manifest.pools.no.outcomeIsCurrency0,
      poolId: manifest.pools.no.poolId,
      publicClient,
      stateView: manifest.venue.stateView,
    }),
  ]);

  const decision = decideCompleteSetArbAction({
    noDisplayPriceWad: no.displayPriceWad,
    toleranceWad: keeperPriceSumToleranceWad(),
    yesDisplayPriceWad: yes.displayPriceWad,
  });

  if (decision.action !== "hold") {
    await executeCompleteSetArb({
      account: clients.walletClient.account.address,
      action: decision.action,
      arbCollateral: keeperArbCollateral(manifest.collateral.decimals),
      chainId: config.chainId,
      collateralLabel: "POPCHARTS_KEEPER_ARB_COLLATERAL",
      manifest,
      publicClient,
      swapRouter: config.contracts.swapRouter,
      walletClient: createVenueContractWriter(clients.walletClient),
    });
    console.log(
      `[Keeper] ${market.label}: ${decision.action} at price sum ` +
        `${formatWad(decision.priceSumWad)}.`,
    );
  }

  const resolvedDeferred = await drainDeferredExecutions({
    clients,
    market,
  });

  return {
    action: decision.action,
    priceSumWad: decision.priceSumWad,
    resolvedDeferred,
  };
}

/**
 * Resolves deferred maker-order executions for one market's pools. Crossed
 * orders that could not settle inline stay queued in the order manager until
 * a resolver call executes them; without this drain, maker fills never land.
 */
async function drainDeferredExecutions({
  clients,
  market,
}: {
  clients: {
    publicClient: BlockchainClient;
    walletClient: BlockchainWalletClient;
  };
  market: TrackedMarket;
}): Promise<number> {
  const pending = await findPendingDeferredExecutions({
    fromBlock: config.deployBlock,
    orderManager: config.contracts.orderManager,
    poolIds: [
      market.manifest.pools.yes.poolId,
      market.manifest.pools.no.poolId,
    ],
    publicClient: clients.publicClient as PublicClient,
  });
  let resolved = 0;

  for (const execution of pending) {
    const requested = minBigInt(
      execution.remainingOrderCount,
      BigInt(COMPLETE_SET_KEEPER_POLICY.maxDeferredResolveIterations),
    );

    if (requested <= 0n) {
      continue;
    }

    const hash = await clients.walletClient.writeContract({
      abi: RESOLVE_DEFERRED_ABI,
      account: clients.walletClient.account,
      address: config.contracts.orderManager,
      args: [execution.executionId, requested],
      chain: config.chain,
      functionName: "resolveDeferredExecution",
    });
    const receipt = await clients.publicClient.waitForTransactionReceipt({
      hash,
    });

    if (receipt.status !== "success") {
      throw new Error(`resolveDeferredExecution failed: ${hash}`);
    }

    resolved += 1;
    console.log(
      `[Keeper] ${market.label}: resolved deferred execution ` +
        `${execution.executionId} (${requested} orders).`,
    );
  }

  return resolved;
}

const RESOLVE_DEFERRED_ABI = [
  {
    inputs: [
      { name: "executionId", type: "bytes32" },
      { name: "requestedExecutionCount", type: "uint256" },
    ],
    name: "resolveDeferredExecution",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * One graduation pass for one pregrad market: asks the dev graduation flow to
 * settle it without force, so a market below its threshold is a cheap
 * "below_threshold" no-op and an eligible one settles end to end (clearing
 * root, finalize, claims, venue wiring, liquidity seed). A market that reached
 * its graduation deadline without ever matching enough liquidity can no longer
 * graduate (the contract blocks startGraduation past the deadline), so the pass
 * opens full escrow refunds on-chain via markRefundable — the automated
 * no-match/full-refund outcome. The flow is idempotent and resumable, so a pass
 * racing the graduate button only heals whatever the other left unfinished.
 */
export async function runGraduationPass({
  graduate = graduateDevMarket,
  refund = refundPregradMarket,
  market,
}: {
  graduate?: typeof graduateDevMarket;
  market: TrackedPregradMarket;
  refund?: typeof refundPregradMarket;
}): Promise<"graduated" | "refunded" | "skipped"> {
  const result = await graduate({
    chainId: market.chainId,
    force: false,
    marketId: market.marketId.toString(),
  });

  if (result.kind === "graduated") {
    // A zero-transaction result is the idempotent resume path re-confirming
    // an already settled market; only real settlements are worth a log line.
    if (result.transactionHashes.length > 0) {
      console.log(
        `[Keeper] ${market.label}: graduated automatically ` +
          `(${result.transactionHashes.length} transactions).`,
      );
    }
    return "graduated";
  }

  if (result.kind === "ineligible" && result.reason === "below_threshold") {
    return "skipped";
  }

  // Past its deadline and still not graduated: the market never matched enough
  // liquidity and never will, so settle the no-match outcome by opening full
  // refunds instead of leaving escrow stranded.
  if (result.kind === "ineligible" && result.reason === "past_deadline") {
    const refundOutcome = await refund({
      chainId: market.chainId,
      marketId: market.marketId,
    });

    if (refundOutcome === "refunded") {
      console.log(
        `[Keeper] ${market.label}: no match by graduation deadline; ` +
          `opened full refunds.`,
      );
      return "refunded";
    }

    return "skipped";
  }

  console.log(
    `[Keeper] ${market.label}: graduation pass skipped (${result.kind}` +
      `${result.kind === "ineligible" ? `: ${result.reason}` : ""}).`,
  );
  return "skipped";
}

/** Collateral committed per arbitrage round trip, env-overridable. */
function keeperArbCollateral(collateralDecimals: number): bigint {
  return parseUnits(
    process.env.POPCHARTS_KEEPER_ARB_COLLATERAL ??
      COMPLETE_SET_KEEPER_POLICY.arbCollateral,
    collateralDecimals,
  );
}

/** Displayed |YES + NO - 1| drift tolerated before arbitrage, env-overridable. */
function keeperPriceSumToleranceWad(): bigint {
  return parseUnits(
    process.env.POPCHARTS_KEEPER_PRICE_SUM_TOLERANCE ??
      COMPLETE_SET_KEEPER_POLICY.priceSumTolerance,
    18,
  );
}

function formatWad(value: bigint): string {
  return wadToNumber(value).toFixed(4);
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
