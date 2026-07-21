import { SIDE_NO, SIDE_YES } from "@popcharts/protocol";
import { parseUnits } from "viem";

import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { assertEqual } from "../asserts";
import { createLifecycleMarket } from "../market-factory";
import { waitForApiStatus, waitForIndexedRows } from "../market-checks";
import { assertMarketPaperTrail } from "../paper-trail";
import { placeReceipt } from "../pregrad-trading";
import { SCENARIO_ACCOUNTS } from "../stack";
import { startService, stopService } from "../stack-control";
import type { Scenario } from "../report";

/**
 * ADR 0014 infrastructure drill: the indexer restarts mid-lifecycle and the
 * lifecycle still completes. Proof of the catch-up path: stop the indexer,
 * emit on-chain receipt events while it is down, confirm they are NOT
 * indexed, then restart it — on restart each watcher sweeps its persisted
 * cursor to the tip BEFORE subscribing live, so the missed events are
 * backfilled. The restart's readiness (health marker) is only written after
 * that backfill completes, so a re-appeared market row proves recovery.
 */
export const indexerRestart: Scenario = {
  name: "indexer-restart",
  run: async ({ step }) => {
    const market = await step("create market on-chain", () =>
      createLifecycleMarket({
        question: `Will the indexer-restart lifecycle market recover its feed? (run ${Date.now()})`,
        graduationSeconds: 600,
        resolutionSeconds: 700,
      }),
    );

    await step("review runner approves via heuristic provider", () =>
      waitForApiStatus(market.marketId, "bootstrap", { timeoutMs: 135_000 }),
    );

    await step("stop the indexer mid-lifecycle", () => stopService("indexer"));

    const placed = await step(
      "emit receipt events while the indexer is down",
      async () => {
        // Both below threshold — this drill proves feed recovery, not
        // graduation. Same account: sequential nonces, no funding race.
        const yes = await placeReceipt({
          marketId: market.marketId,
          sharesWad: parseUnits("40", 18),
          side: SIDE_YES,
          traderAccountIndex: SCENARIO_ACCOUNTS.indexerRestartTrader,
        });
        const no = await placeReceipt({
          marketId: market.marketId,
          sharesWad: parseUnits("40", 18),
          side: SIDE_NO,
          traderAccountIndex: SCENARIO_ACCOUNTS.indexerRestartTrader,
        });
        return [yes, no];
      },
    );

    await step("confirm the events are unindexed while down", async () => {
      const rows = await db
        .select()
        .from(schema.receiptPlacedEvents)
        .where(
          and(
            eq(schema.receiptPlacedEvents.chainId, config.chainId),
            eq(schema.receiptPlacedEvents.marketId, market.marketId),
          ),
        );
      assertEqual(
        "receipts indexed while the indexer is stopped",
        rows.length,
        0,
      );
    });

    await step("restart the indexer (backfill before live)", () =>
      startService("indexer"),
    );

    await step("the missed events are backfilled after restart", () =>
      waitForIndexedRows(
        `both receipts backfilled for market ${market.marketId}`,
        schema.receiptPlacedEvents,
        market.marketId,
        placed.length,
      ),
    );

    await step("money paper trail balances end to end", () =>
      assertMarketPaperTrail({
        createdBlock: market.createdBlock,
        marketId: market.marketId,
      }),
    );
  },
};
