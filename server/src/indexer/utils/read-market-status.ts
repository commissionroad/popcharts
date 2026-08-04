import { pregradManagerAbi } from "@popcharts/protocol";

import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";

/**
 * Reads a pregrad market's current `MarketTypes.MarketStatus` ordinal from the
 * manager. Enums have no ABI representation, so this comes back as a `uint8`;
 * decode it with `marketStatusFromCode` rather than comparing against a
 * hand-written number.
 *
 * This is the market's status *now*, not at the block the caller is
 * processing. That is what the market-created projection wants: `markets.status`
 * is the current-state column, other watchers advance it under guarded
 * transitions, and the creation upsert deliberately never overwrites it on
 * replay. A recovery sweep meeting a long-since-graduated market therefore
 * seeds the truth instead of a stale `under_review` the later sweeps have to
 * walk forward.
 */
export async function readMarketStatusCode(
  client: BlockchainClient,
  marketId: bigint,
): Promise<number> {
  const state = (await client.readContract({
    abi: pregradManagerAbi,
    address: config.contracts.pregradManager,
    args: [marketId],
    functionName: "getMarketState",
  })) as { status: number };

  return Number(state.status);
}
