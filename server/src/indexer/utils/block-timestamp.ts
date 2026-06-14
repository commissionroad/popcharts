import type { BlockchainClient } from "src/indexer/blockchain/client";

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
  const timestamp = new Date(Number(block.timestamp) * 1000);
  blockTimestampCache.set(blockNumber, timestamp);

  return timestamp;
}

export function clearBlockTimestampCache() {
  blockTimestampCache.clear();
}
