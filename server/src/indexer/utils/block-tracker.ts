import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

export async function getLastProcessedBlock(
  contractAddress: string,
  cursorName: string,
) {
  const row = await db.query.indexerCursors.findFirst({
    where: and(
      eq(schema.indexerCursors.contractAddress, contractAddress.toLowerCase()),
      eq(schema.indexerCursors.chainId, config.chainId),
      eq(schema.indexerCursors.cursorName, cursorName),
    ),
  });

  return row?.lastProcessedBlock ?? null;
}

export async function updateLastProcessedBlock(
  contractAddress: string,
  cursorName: string,
  blockNumber: bigint,
) {
  const normalizedAddress = contractAddress.toLowerCase();

  await db
    .insert(schema.indexerCursors)
    .values({
      chainId: config.chainId,
      contractAddress: normalizedAddress,
      cursorName,
      lastProcessedBlock: blockNumber,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.indexerCursors.contractAddress,
        schema.indexerCursors.chainId,
        schema.indexerCursors.cursorName,
      ],
      set: {
        lastProcessedBlock: blockNumber,
        updatedAt: new Date(),
      },
    });
}

/**
 * First-recovery start for a fixed contract with no cursor yet: the
 * configured deploy block when known, the current block on a local chain
 * (fresh deploys index from the start anyway), else a bounded look-back.
 */
export function getDefaultStartBlock(cursorName: string, currentBlock: bigint) {
  if (config.deployBlock > 0n) {
    console.log(
      `[BlockTracker] Using deployment block ${config.deployBlock} for ${cursorName}`,
    );
    return config.deployBlock;
  }

  if (config.chainId === 31337) {
    console.log(
      `[BlockTracker] Local network has no deploy block; starting ${cursorName} recovery at current block`,
    );
    return currentBlock;
  }

  const fallbackBlock = currentBlock > 10_000n ? currentBlock - 10_000n : 1n;
  console.log(
    `[BlockTracker] No deployment block configured; using fallback ${fallbackBlock} for ${cursorName}`,
  );

  return fallbackBlock;
}
