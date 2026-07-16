import { parseAbiItem } from "viem";

import { config } from "src/config";
import {
  buildOutcomeTokenTransferRecord,
  persistOutcomeTokenTransferRecord,
  type OutcomeTokenTransferLog,
} from "src/indexer/handlers/outcome-token-transfers";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownOutcomeToken,
  refreshOutcomeTokenRegistry,
} from "src/indexer/utils/outcome-token-registry";
import { createDynamicAddressWatcher } from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches ERC-20 Transfer on every graduated market's outcome tokens so
 * per-wallet balances stay queryable from the database. One Transfer stream
 * covers all balance changes (claim mints, venue swaps, order pulls/fills,
 * plain transfers), so no v4 Swap indexing is needed.
 *
 * Tokens are discovered from venue_pools as markets graduate; a token
 * discovered late backfills from its market's graduation block — minting is
 * market-only, so no transfer can precede it. Subscription lifecycle and
 * cursor discipline live in the shared dynamic-address scaffolding.
 */

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const LABEL = "OutcomeTokenTransfer";

const watcher = createDynamicAddressWatcher({
  cursorName: "Transfer",
  events: [TRANSFER_EVENT],
  getKnownContract: getKnownOutcomeToken,
  handleLog: async (client, log, token) => {
    const transferLog = log as OutcomeTokenTransferLog;

    console.log(
      `[${LABEL}] token=${token.address} from=${transferLog.args.from ?? "unknown"} to=${transferLog.args.to ?? "unknown"}`,
    );

    const contractId = await getOrCreateContractId(
      token.address,
      "OutcomeToken",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildOutcomeTokenTransferRecord({
      blockTimestamp,
      config,
      contractId,
      log: transferLog,
      marketId: token.marketId,
      side: token.side,
    });

    await persistOutcomeTokenTransferRecord(record);
  },
  label: LABEL,
  refreshRegistry: refreshOutcomeTokenRegistry,
  subject: "graduated outcome token",
});

/** Catch-up sweep over every known token's Transfer logs up to currentBlock. */
export const recoverOutcomeTokenTransferEvents = watcher.recover;
/** Live Transfer subscription with token discovery; returns a stop function. */
export const watchOutcomeTokenTransferEvents = watcher.watch;
