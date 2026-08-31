import { unlinkSync, writeFileSync } from "fs";

import { config, validateIndexerConfig } from "src/config";
import {
  createBlockchainClient,
  type BlockchainClient,
} from "src/blockchain/client";
import {
  recoverEntryFeeEvents,
  recoverMarketCreatedEvents,
  recoverMarketCreationFeeEvents,
  recoverOutcomeTokenTransferEvents,
  recoverPoolPriceTickEvents,
  recoverPostgradMarketEvents,
  recoverReceiptPlacedEvents,
  recoverReceiptWithdrawalEvents,
  recoverReviewCreditEvents,
  recoverSettlementEvents,
  recoverVenueOrderEvents,
  watchEntryFeeEvents,
  watchMarketCreatedEvents,
  watchMarketCreationFeeEvents,
  watchOutcomeTokenTransferEvents,
  watchPoolPriceTickEvents,
  watchPostgradMarketEvents,
  watchReceiptPlacedEvents,
  watchReceiptWithdrawalEvents,
  watchReviewCreditEvents,
  watchSettlementEvents,
  watchVenueOrderEvents,
} from "src/indexer/watchers";

const LOCAL_RECOVERY_POLL_INTERVAL_MS = 2_000;

function markHealthy() {
  try {
    writeFileSync(config.healthCheckFile, new Date().toISOString());
  } catch {
    // Health marker writes are best effort for local and container runtimes.
  }
}

function markUnhealthy() {
  try {
    unlinkSync(config.healthCheckFile);
  } catch {
    // Health marker cleanup is best effort.
  }
}

async function main() {
  const commitSha = process.env.GIT_COMMIT_SHA ?? "development";
  const buildTime = process.env.BUILD_TIME ?? new Date().toISOString();

  console.log("=== Pop Charts Event Indexer ===");
  console.log(`Version: ${commitSha}`);
  console.log(`Build Time: ${buildTime}`);
  console.log(`Chain: ${config.name} (${config.chainId})`);
  console.log(`PregradManager: ${config.contracts.pregradManager}`);

  validateIndexerConfig();

  console.log("\nConnecting to blockchain...");
  const client = createBlockchainClient();
  const currentBlock = await client.getBlockNumber();
  console.log(`Current block: ${currentBlock}`);

  console.log("\n--- Recovering missed events ---");
  await recoverMissedEvents(client);

  console.log("\n--- Starting real-time event watchers ---");
  const unwatchMarketCreated = watchMarketCreatedEvents(client);
  const unwatchMarketCreationFee = watchMarketCreationFeeEvents(client);
  const unwatchEntryFees = watchEntryFeeEvents(client);
  const unwatchReceiptWithdrawals = watchReceiptWithdrawalEvents(client);
  const unwatchReviewBond = watchReviewCreditEvents(client);
  const unwatchReceiptPlaced = watchReceiptPlacedEvents(client);
  const unwatchSettlement = watchSettlementEvents(client);
  const unwatchVenueOrders = watchVenueOrderEvents(client);
  const unwatchPoolPriceTicks = watchPoolPriceTickEvents(client);
  const unwatchOutcomeTokenTransfers = watchOutcomeTokenTransferEvents(client);
  const unwatchPostgradMarket = watchPostgradMarketEvents(client);

  markHealthy();
  console.log("\nIndexer is running and healthy");

  const healthInterval = setInterval(markHealthy, 30_000);
  const recoveryInterval =
    config.name === "local"
      ? setInterval(() => {
          void recoverMissedEvents(client, { quiet: true }).catch((error) => {
            console.error("[Recovery] Poll error:", error);
          });
        }, LOCAL_RECOVERY_POLL_INTERVAL_MS)
      : null;

  const shutdown = () => {
    console.log("\nShutting down indexer...");
    clearInterval(healthInterval);
    if (recoveryInterval) {
      clearInterval(recoveryInterval);
    }
    markUnhealthy();
    unwatchMarketCreated();
    unwatchMarketCreationFee();
    unwatchEntryFees();
    unwatchReceiptWithdrawals();
    unwatchReviewBond();
    unwatchReceiptPlaced();
    unwatchSettlement();
    unwatchVenueOrders();
    unwatchPoolPriceTicks();
    unwatchOutcomeTokenTransfers();
    unwatchPostgradMarket();
    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

async function recoverMissedEvents(
  client: BlockchainClient,
  { quiet = false }: { quiet?: boolean } = {},
) {
  const currentBlock = await client.getBlockNumber();

  await recoverMarketCreatedEvents(client, currentBlock, { quiet });
  await recoverMarketCreationFeeEvents(client, currentBlock, { quiet });
  await recoverReviewCreditEvents(client, currentBlock, { quiet });
  await recoverReceiptPlacedEvents(client, currentBlock, { quiet });
  // After receipt recovery on purpose: entry-fee rows foreign-key to
  // receipt_placed_events, so a cold backfill that recovered fees first would
  // park every collected log for the length of its retry budget.
  await recoverEntryFeeEvents(client, currentBlock, { quiet });
  // Same dependency, same ordering: withdrawal rows foreign-key to
  // receipt_placed_events (twice, for the refuted kind's counterexample).
  await recoverReceiptWithdrawalEvents(client, currentBlock, { quiet });
  await recoverSettlementEvents(client, currentBlock, { quiet });
  await recoverVenueOrderEvents(client, currentBlock, { quiet });
  await recoverPoolPriceTickEvents(client, currentBlock, { quiet });
  // Runs after settlement so newly finalized graduations are discoverable
  // through venue_pools before the token transfer sweep.
  await recoverOutcomeTokenTransferEvents(client, currentBlock, { quiet });
  // Also after settlement: postgrad markets are discovered from
  // GraduationFinalized rows, and their events cannot precede them.
  await recoverPostgradMarketEvents(client, currentBlock, { quiet });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  markUnhealthy();
  process.exit(1);
});
