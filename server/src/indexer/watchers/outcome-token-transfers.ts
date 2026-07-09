import { parseAbiItem } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";
import {
  buildOutcomeTokenTransferRecord,
  persistOutcomeTokenTransferRecord,
  type OutcomeTokenTransferLog,
} from "src/indexer/handlers/outcome-token-transfers";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getLastProcessedBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownOutcomeToken,
  refreshOutcomeTokenRegistry,
  type IndexedOutcomeToken,
} from "src/indexer/utils/outcome-token-registry";

/**
 * Watches ERC-20 Transfer on every graduated market's outcome tokens so
 * per-wallet balances stay queryable from the database. One Transfer stream
 * covers all balance changes (claim mints, venue swaps, order pulls/fills,
 * plain transfers), so no v4 Swap indexing is needed.
 *
 * Unlike the singleton-contract watchers, the address set here is dynamic:
 * tokens are discovered from venue_pools as markets graduate, each token runs
 * behind its own per-address cursor, and the live subscription is rebuilt on
 * a discovery interval when new tokens appear. A token discovered late
 * backfills from its market's graduation block — minting is market-only, so
 * no transfer can precede it.
 */

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const TRANSFER_CURSOR = "Transfer";
const TOKEN_DISCOVERY_INTERVAL_MS = 15_000;
const LABEL = "OutcomeTokenTransfer";

type RecoveryOptions = {
  quiet?: boolean;
};

export async function recoverOutcomeTokenTransferEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  const tokens = await refreshOutcomeTokenRegistry();

  if (tokens.length === 0) {
    if (!options.quiet) {
      console.log(`[${LABEL}] No graduated outcome tokens known; skipping`);
    }
    return;
  }

  for (const token of tokens) {
    await recoverTokenTransferEvents(client, currentBlock, token, options);
  }
}

export function watchOutcomeTokenTransferEvents(client: BlockchainClient) {
  console.log(`[${LABEL}] Starting real-time event watcher`);

  let stopped = false;
  let synchronizing = false;
  let unwatch: () => void = () => {};
  let watchedTokenKey: string | null = null;

  // Rebuilds the subscription whenever the discovered token set changes. New
  // tokens are backfilled from their cursor (or graduation block) before the
  // resubscribe so no transfer falls between discovery and the live watch.
  const synchronize = async () => {
    if (stopped || synchronizing) {
      return;
    }
    synchronizing = true;

    try {
      const tokens = await refreshOutcomeTokenRegistry();
      const tokenKey = tokens
        .map((token) => token.address)
        .sort()
        .join(",");

      if (tokenKey === watchedTokenKey) {
        return;
      }

      const currentBlock = await client.getBlockNumber();
      for (const token of tokens) {
        await recoverTokenTransferEvents(client, currentBlock, token, {
          quiet: true,
        });
      }

      if (stopped) {
        return;
      }

      unwatch();
      unwatch =
        tokens.length === 0
          ? () => {}
          : client.watchContractEvent({
              abi: [TRANSFER_EVENT],
              address: tokens.map((token) => token.address as `0x${string}`),
              eventName: "Transfer",
              onError: (error) => {
                console.error(`[${LABEL}] Watch error:`, error);
              },
              onLogs: async (logs) => {
                for (const log of logs) {
                  await processOutcomeTokenTransferEvent(
                    client,
                    log as OutcomeTokenTransferLog,
                  );
                }
              },
            });
      watchedTokenKey = tokenKey;

      if (tokens.length > 0) {
        console.log(`[${LABEL}] Watching ${tokens.length} outcome token(s)`);
      }
    } finally {
      synchronizing = false;
    }
  };

  const logSynchronizeError = (error: unknown) => {
    console.error(`[${LABEL}] Token discovery error:`, error);
  };

  void synchronize().catch(logSynchronizeError);
  const discoveryInterval = setInterval(() => {
    void synchronize().catch(logSynchronizeError);
  }, TOKEN_DISCOVERY_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(discoveryInterval);
    unwatch();
  };
}

export async function processOutcomeTokenTransferEvent(
  client: BlockchainClient,
  log: OutcomeTokenTransferLog,
) {
  const tokenAddress = log.address.toLowerCase();
  let token = getKnownOutcomeToken(tokenAddress);

  if (!token) {
    await refreshOutcomeTokenRegistry();
    token = getKnownOutcomeToken(tokenAddress);
  }

  // Only registry-discovered addresses are watched, so a miss is a stale
  // in-process cache at worst; leaving the cursor behind replays the log.
  if (!token) {
    console.warn(
      `[${LABEL}] Transfer for unknown token ${tokenAddress}; skipping`,
    );
    return;
  }

  console.log(
    `[${LABEL}] token=${tokenAddress} from=${log.args.from ?? "unknown"} to=${log.args.to ?? "unknown"}`,
  );

  const contractId = await getOrCreateContractId(tokenAddress, "OutcomeToken");
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildOutcomeTokenTransferRecord({
    blockTimestamp,
    config,
    contractId,
    log,
    marketId: token.marketId,
    side: token.side,
  });

  await persistOutcomeTokenTransferRecord(record);
  await updateLastProcessedBlock(
    tokenAddress,
    TRANSFER_CURSOR,
    record.blockNumber,
  );
}

async function recoverTokenTransferEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  token: IndexedOutcomeToken,
  options: RecoveryOptions,
) {
  const lastProcessed = await getLastProcessedBlock(
    token.address,
    TRANSFER_CURSOR,
  );
  // First recovery starts at the market's graduation block, not the global
  // deploy-block heuristics: the token cannot have transfers earlier, and a
  // token graduated at the chain head must still scan its own start block
  // (hence > rather than the singleton watchers' >=).
  const fromBlock =
    lastProcessed !== null ? lastProcessed + 1n : token.startBlock;

  if (fromBlock > currentBlock) {
    if (!options.quiet) {
      console.log(`[${LABEL}] ${token.address}: no blocks to recover`);
    }
    return;
  }

  const logs = await client.getLogs({
    address: token.address as `0x${string}`,
    event: TRANSFER_EVENT,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log(`[${LABEL}] ${token.address}: found 0 historical events`);
    }
    await updateLastProcessedBlock(
      token.address,
      TRANSFER_CURSOR,
      currentBlock,
    );
    return;
  }

  console.log(
    `[${LABEL}] ${token.address}: found ${logs.length} historical events`,
  );

  for (const log of logs) {
    await processOutcomeTokenTransferEvent(
      client,
      log as OutcomeTokenTransferLog,
    );
  }
}
