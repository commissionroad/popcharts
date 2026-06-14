import { unlinkSync, writeFileSync } from "fs";

import { config, validateIndexerConfig } from "src/config";
import { createBlockchainClient } from "src/indexer/blockchain/client";
import {
  recoverMarketCreatedEvents,
  recoverReceiptPlacedEvents,
  watchMarketCreatedEvents,
  watchReceiptPlacedEvents,
} from "src/indexer/watchers";

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
  await recoverMarketCreatedEvents(client, currentBlock);
  await recoverReceiptPlacedEvents(client, currentBlock);

  console.log("\n--- Starting real-time event watchers ---");
  const unwatchMarketCreated = watchMarketCreatedEvents(client);
  const unwatchReceiptPlaced = watchReceiptPlacedEvents(client);

  markHealthy();
  console.log("\nIndexer is running and healthy");

  const healthInterval = setInterval(markHealthy, 30_000);

  const shutdown = () => {
    console.log("\nShutting down indexer...");
    clearInterval(healthInterval);
    markUnhealthy();
    unwatchMarketCreated();
    unwatchReceiptPlaced();
    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise(() => {});
}

main().catch((error) => {
  console.error("Fatal error:", error);
  markUnhealthy();
  process.exit(1);
});
