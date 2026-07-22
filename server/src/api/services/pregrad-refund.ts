import { pregradManagerAbi } from "@popcharts/protocol";
import { parseEventLogs, type Hash, type Log } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createReadOnlyClient,
  createWalletClient,
} from "src/blockchain/client";
import { config } from "src/config";
import {
  buildMarketRefundsAvailableRecord,
  persistMarketRefundsAvailableRecord,
  type MarketRefundsAvailableLog,
} from "src/indexer/handlers/settlement";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";

import {
  fastForwardLocalRpc,
  getLatestBlockTimestamp,
  readDevPrivateKey,
} from "./local-dev-chain";

const PREGRAD_MARKET_STATUS_ACTIVE = 0;
const PREGRAD_MARKET_STATUS_REFUNDED = 4;

/**
 * Outcome of driving PregradManager.markRefundable on-chain for one market.
 * "refunded" carries the emitted MarketRefundsAvailable log so a caller can
 * mirror the refunded status into the indexed projection; "already_refunded"
 * makes the call idempotent, and "wrong_status" reports a market that is not an
 * active market past its deadline.
 */
export type MarkRefundableOnChainResult =
  | {
      blockTimestamp: Date;
      kind: "already_refunded";
    }
  | {
      blockTimestamp: Date;
      kind: "refunded";
      refundLog: MarketRefundsAvailableLog;
      totalEscrowed: bigint;
      transactionHash: Hash;
    }
  | {
      kind: "wrong_status";
      status: number;
    };

/**
 * Calls PregradManager.markRefundable for a market that missed graduation,
 * using the dev manager key. Only touches a market whose contract status is
 * still Active; a market already Refunded returns idempotently and any other
 * status is reported without a write. When `fastForwardToDeadline` is set the
 * local chain is jumped to the graduation deadline first (the dev close tool
 * closes markets that have not reached it yet); the automated keeper leaves it
 * false because it only refunds markets the graduation flow already reported
 * past their deadline.
 */
export async function markPregradMarketRefundableOnChain(
  marketId: bigint,
  { fastForwardToDeadline = false }: { fastForwardToDeadline?: boolean } = {},
): Promise<MarkRefundableOnChainResult> {
  const publicClient = createReadOnlyClient();
  const state = await publicClient.readContract({
    abi: pregradManagerAbi,
    address: config.contracts.pregradManager,
    functionName: "getMarketState",
    args: [marketId],
  });

  if (state.status === PREGRAD_MARKET_STATUS_REFUNDED) {
    return {
      blockTimestamp: await getLatestBlockTimestamp(publicClient),
      kind: "already_refunded",
    };
  }

  if (state.status !== PREGRAD_MARKET_STATUS_ACTIVE) {
    return {
      kind: "wrong_status",
      status: state.status,
    };
  }

  if (fastForwardToDeadline) {
    const marketConfig = await publicClient.readContract({
      abi: pregradManagerAbi,
      address: config.contracts.pregradManager,
      functionName: "getMarketConfig",
      args: [marketId],
    });
    await fastForwardLocalRpc(publicClient, marketConfig.graduationDeadline);
  }

  const account = privateKeyToAccount(readDevPrivateKey());
  const walletClient = createWalletClient(account);
  const transactionHash = await walletClient.writeContract({
    abi: pregradManagerAbi,
    address: config.contracts.pregradManager,
    functionName: "markRefundable",
    args: [marketId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });

  if (receipt.status !== "success") {
    throw new Error(`markRefundable transaction failed: ${transactionHash}`);
  }

  const block = await publicClient.getBlock({
    blockNumber: receipt.blockNumber,
  });
  const blockTimestamp = new Date(Number(block.timestamp) * 1000);
  const refundLog = extractMarketRefundsAvailableLog(marketId, receipt.logs);

  return {
    blockTimestamp,
    kind: "refunded",
    refundLog,
    totalEscrowed: refundLog.args.totalEscrowed ?? state.totalEscrowed,
    transactionHash,
  };
}

/**
 * Mirrors a MarketRefundsAvailable log through the indexer's idempotent
 * handler, so the market projection flips to refunded before the caller
 * returns instead of waiting on the live watcher. Racing the watcher is safe:
 * the insert is guarded by onConflictDoNothing.
 */
export async function mirrorMarketRefunded({
  blockTimestamp,
  refundLog,
}: {
  blockTimestamp: Date;
  refundLog: MarketRefundsAvailableLog;
}): Promise<void> {
  const contractId = await getOrCreateContractId(
    config.contracts.pregradManager,
    "PregradManager",
  );
  await persistMarketRefundsAvailableRecord(
    buildMarketRefundsAvailableRecord({
      blockTimestamp,
      config,
      contractId,
      log: refundLog,
    }),
  );
}

/** Terminal outcome of the automated (keeper) refund path. */
export type RefundPregradMarketResult = "refunded" | "skipped";

/**
 * Automated no-match/full-refund settlement: opens full escrow refunds on a
 * market that reached its graduation deadline without matching enough
 * liquidity to graduate, then mirrors the refunded status into the indexed
 * projection. Idempotent and resumable — a market already refunded on-chain
 * resolves to "refunded" without a second write, and a market no longer active
 * (e.g. it graduated in a racing pass) is a quiet "skipped".
 */
export async function refundPregradMarket(
  {
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  },
  {
    markRefundable = markPregradMarketRefundableOnChain,
    mirror = mirrorMarketRefunded,
  }: {
    markRefundable?: typeof markPregradMarketRefundableOnChain;
    mirror?: typeof mirrorMarketRefunded;
  } = {},
): Promise<RefundPregradMarketResult> {
  const result = await markRefundable(marketId);

  if (result.kind === "wrong_status") {
    return "skipped";
  }

  if (result.kind === "refunded") {
    await mirror({
      blockTimestamp: result.blockTimestamp,
      refundLog: result.refundLog,
    });
  }

  return "refunded";
}

/**
 * Pulls the market's MarketRefundsAvailable event out of a markRefundable
 * receipt. The manager emits exactly one per call; a missing event means the
 * transaction did not actually open refunds and must not be mirrored as if it
 * had.
 */
function extractMarketRefundsAvailableLog(
  marketId: bigint,
  logs: Log[],
): MarketRefundsAvailableLog {
  const managerAddress = config.contracts.pregradManager.toLowerCase();
  const parsed = parseEventLogs({
    abi: pregradManagerAbi,
    eventName: "MarketRefundsAvailable",
    logs,
  });
  const match = parsed.find(
    (log) =>
      log.address.toLowerCase() === managerAddress &&
      log.args.marketId === marketId,
  );

  if (!match) {
    throw new Error(
      `markRefundable for market ${marketId} emitted no MarketRefundsAvailable event.`,
    );
  }

  return match as unknown as MarketRefundsAvailableLog;
}
