import type { BlockchainClient } from "src/blockchain/client";

import { unixSecondsToDate } from "./unix-seconds";

const blockTimestampCache = new Map<bigint, Date>();

export async function getBlockTimestamp(
  client: BlockchainClient,
  blockNumber: bigint,
) {
  const cached = blockTimestampCache.get(blockNumber);
  if (cached) {
    return cached;
  }

  const block = await client.getBlock({ blockNumber });
  const timestamp = unixSecondsToDate(block.timestamp);
  blockTimestampCache.set(blockNumber, timestamp);

  return timestamp;
}

export function clearBlockTimestampCache() {
  blockTimestampCache.clear();
}
