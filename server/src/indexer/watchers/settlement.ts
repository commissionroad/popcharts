import { parseAbiItem, type AbiEvent } from "viem";

import { config } from "src/config";
import type { BlockchainClient } from "src/blockchain/client";
import {
  buildClearingRootSubmittedRecord,
  buildGraduatedReceiptClaimedRecord,
  buildGraduationFinalizedRecord,
  buildGraduationStartedRecord,
  buildMarketRefundsAvailableRecord,
  buildRefundedReceiptClaimedRecord,
  persistClearingRootSubmittedRecord,
  persistGraduatedReceiptClaimedRecord,
  persistGraduationFinalizedRecord,
  persistGraduationStartedRecord,
  persistMarketRefundsAvailableRecord,
  persistRefundedReceiptClaimedRecord,
  type ClearingRootSubmittedLog,
  type GraduatedReceiptClaimedLog,
  type GraduationFinalizedLog,
  type GraduationStartedLog,
  type MarketRefundsAvailableLog,
  type RefundedReceiptClaimedLog,
} from "src/indexer/handlers/settlement";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getRecoveryStartBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import { registerVenuePoolsForGraduatedMarket } from "src/indexer/utils/venue-pool-registry";

const GRADUATION_STARTED_EVENT = parseAbiItem(
  "event GraduationStarted(uint256 indexed marketId, address indexed manager, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt, bytes32 snapshotHash)",
);
const CLEARING_ROOT_SUBMITTED_EVENT = parseAbiItem(
  "event ClearingRootSubmitted(uint256 indexed marketId, address indexed submitter, bytes32 indexed merkleRoot, bytes32 snapshotHash, uint256 matchedMarketCap, uint256 retainedCostTotal, uint256 refundTotal, uint256 completeSetCount, uint64 submittedAt, uint64 challengeDeadline)",
);
const GRADUATION_FINALIZED_EVENT = parseAbiItem(
  "event GraduationFinalized(uint256 indexed marketId, address indexed postgradAdapter, address indexed postgradMarket, uint256 completeSetCount, uint256 retainedCostTotal, uint256 refundTotal)",
);
const MARKET_REFUNDS_AVAILABLE_EVENT = parseAbiItem(
  "event MarketRefundsAvailable(uint256 indexed marketId, uint256 totalEscrowed)",
);
const GRADUATED_RECEIPT_CLAIMED_EVENT = parseAbiItem(
  "event GraduatedReceiptClaimed(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 retainedShares, uint256 retainedCost, uint256 refund)",
);
const REFUNDED_RECEIPT_CLAIMED_EVENT = parseAbiItem(
  "event RefundedReceiptClaimed(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint256 refund)",
);

type RecoveryOptions = {
  quiet?: boolean;
};

type SettlementEventDefinition<TLog> = {
  cursorName: string;
  event: AbiEvent;
  eventName:
    | "GraduationStarted"
    | "ClearingRootSubmitted"
    | "GraduationFinalized"
    | "MarketRefundsAvailable"
    | "GraduatedReceiptClaimed"
    | "RefundedReceiptClaimed";
  label: string;
  process: (client: BlockchainClient, log: TLog) => Promise<void>;
};

const SETTLEMENT_EVENTS = [
  {
    cursorName: "GraduationStarted",
    event: GRADUATION_STARTED_EVENT as AbiEvent,
    eventName: "GraduationStarted",
    label: "GraduationStarted",
    process: processGraduationStartedEvent,
  },
  {
    cursorName: "ClearingRootSubmitted",
    event: CLEARING_ROOT_SUBMITTED_EVENT as AbiEvent,
    eventName: "ClearingRootSubmitted",
    label: "ClearingRootSubmitted",
    process: processClearingRootSubmittedEvent,
  },
  {
    cursorName: "GraduationFinalized",
    event: GRADUATION_FINALIZED_EVENT as AbiEvent,
    eventName: "GraduationFinalized",
    label: "GraduationFinalized",
    process: processGraduationFinalizedEvent,
  },
  {
    cursorName: "MarketRefundsAvailable",
    event: MARKET_REFUNDS_AVAILABLE_EVENT as AbiEvent,
    eventName: "MarketRefundsAvailable",
    label: "MarketRefundsAvailable",
    process: processMarketRefundsAvailableEvent,
  },
  {
    cursorName: "GraduatedReceiptClaimed",
    event: GRADUATED_RECEIPT_CLAIMED_EVENT as AbiEvent,
    eventName: "GraduatedReceiptClaimed",
    label: "GraduatedReceiptClaimed",
    process: processGraduatedReceiptClaimedEvent,
  },
  {
    cursorName: "RefundedReceiptClaimed",
    event: REFUNDED_RECEIPT_CLAIMED_EVENT as AbiEvent,
    eventName: "RefundedReceiptClaimed",
    label: "RefundedReceiptClaimed",
    process: processRefundedReceiptClaimedEvent,
  },
] as const;

export async function processGraduationStartedEvent(
  client: BlockchainClient,
  log: GraduationStartedLog,
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[GraduationStarted] marketId=${marketId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildGraduationStartedRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  // Settlement events can race ahead of the independent MarketCreated
  // watcher; wait for the markets row rather than losing the projection. If
  // retries run out, the error keeps the cursor behind so recovery replays it.
  await retryUntilMarketIndexed(() => persistGraduationStartedRecord(record), {
    label: "GraduationStarted",
  });
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "GraduationStarted",
    record.blockNumber,
  );
}

export async function processClearingRootSubmittedEvent(
  client: BlockchainClient,
  log: ClearingRootSubmittedLog,
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[ClearingRootSubmitted] marketId=${marketId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildClearingRootSubmittedRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await retryUntilMarketIndexed(
    () => persistClearingRootSubmittedRecord(record),
    { label: "ClearingRootSubmitted" },
  );
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "ClearingRootSubmitted",
    record.blockNumber,
  );
}

export async function processGraduationFinalizedEvent(
  client: BlockchainClient,
  log: GraduationFinalizedLog,
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[GraduationFinalized] marketId=${marketId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildGraduationFinalizedRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await retryUntilMarketIndexed(
    () => persistGraduationFinalizedRecord(record),
    { label: "GraduationFinalized" },
  );

  // Best-effort: the venue order watcher re-derives this mapping lazily, so a
  // failure here (e.g. venue not deployed yet) must not hold the cursor back.
  try {
    await registerVenuePoolsForGraduatedMarket({
      client,
      marketId: record.marketId,
      postgradMarket: record.postgradMarket as `0x${string}`,
    });
  } catch (error) {
    console.warn(
      `[GraduationFinalized] Venue pool registration failed for market ${marketId}:`,
      error,
    );
  }

  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "GraduationFinalized",
    record.blockNumber,
  );
}

export async function processMarketRefundsAvailableEvent(
  client: BlockchainClient,
  log: MarketRefundsAvailableLog,
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[MarketRefundsAvailable] marketId=${marketId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildMarketRefundsAvailableRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await retryUntilMarketIndexed(
    () => persistMarketRefundsAvailableRecord(record),
    { label: "MarketRefundsAvailable" },
  );
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "MarketRefundsAvailable",
    record.blockNumber,
  );
}

export async function processGraduatedReceiptClaimedEvent(
  client: BlockchainClient,
  log: GraduatedReceiptClaimedLog,
) {
  const receiptId = log.args.receiptId?.toString() ?? "unknown";
  console.log(`[GraduatedReceiptClaimed] receiptId=${receiptId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildGraduatedReceiptClaimedRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await retryUntilMarketIndexed(
    () => persistGraduatedReceiptClaimedRecord(record),
    { label: "GraduatedReceiptClaimed" },
  );
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "GraduatedReceiptClaimed",
    record.blockNumber,
  );
}

export async function processRefundedReceiptClaimedEvent(
  client: BlockchainClient,
  log: RefundedReceiptClaimedLog,
) {
  const receiptId = log.args.receiptId?.toString() ?? "unknown";
  console.log(`[RefundedReceiptClaimed] receiptId=${receiptId}`);

  const contractId = await pregradManagerContractId();
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildRefundedReceiptClaimedRecord({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await retryUntilMarketIndexed(
    () => persistRefundedReceiptClaimedRecord(record),
    { label: "RefundedReceiptClaimed" },
  );
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    "RefundedReceiptClaimed",
    record.blockNumber,
  );
}

export async function recoverSettlementEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  for (const definition of SETTLEMENT_EVENTS) {
    await recoverSettlementEvent(client, currentBlock, definition, options);
  }
}

export function watchSettlementEvents(client: BlockchainClient) {
  console.log("[Settlement] Starting real-time event watchers");

  const unwatchers = SETTLEMENT_EVENTS.map((definition) =>
    client.watchContractEvent({
      abi: [definition.event],
      address: config.contracts.pregradManager,
      eventName: definition.eventName,
      onError: (error) => {
        console.error(`[${definition.label}] Watch error:`, error);
      },
      onLogs: async (logs) => {
        for (const log of logs) {
          await definition.process(client, log as never);
        }
      },
    }),
  );

  return () => {
    for (const unwatch of unwatchers) {
      unwatch();
    }
  };
}

async function recoverSettlementEvent<TLog>(
  client: BlockchainClient,
  currentBlock: bigint,
  definition: SettlementEventDefinition<TLog>,
  options: RecoveryOptions,
) {
  const fromBlock = await getRecoveryStartBlock(
    config.contracts.pregradManager,
    definition.cursorName,
    currentBlock,
  );

  if (fromBlock >= currentBlock) {
    if (!options.quiet) {
      console.log(`[${definition.label}] No blocks to recover`);
    }
    return;
  }

  if (!options.quiet) {
    console.log(
      `[${definition.label}] Recovering events from block ${fromBlock} to ${currentBlock}`,
    );
  }

  const logs = await client.getLogs({
    address: config.contracts.pregradManager,
    event: definition.event,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log(`[${definition.label}] Found 0 historical events`);
    }
    await updateLastProcessedBlock(
      config.contracts.pregradManager,
      definition.cursorName,
      currentBlock,
    );
    return;
  }

  console.log(`[${definition.label}] Found ${logs.length} historical events`);

  for (const log of logs) {
    await definition.process(client, log as TLog);
  }
}

function pregradManagerContractId() {
  return getOrCreateContractId(
    config.contracts.pregradManager,
    "PregradManager",
  );
}
