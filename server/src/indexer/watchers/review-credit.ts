import { reviewCreditVaultAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config, ZERO_ADDRESS } from "src/config";
import {
  buildReviewCreditRecord,
  persistReviewCreditRecord,
  type ReviewCreditEventKind,
  type ReviewCreditLog,
} from "src/indexer/handlers/review-credit";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches the vault's two money events — credit deposits and owner fee
 * sweeps — so every value transfer through the prepaid review credit
 * (ADR 0022's prepaid-credit amendment) leaves an immutable
 * review_bond_events row (docs/portfolio-data-design.md money invariant).
 * The vault is standalone: nothing here touches markets, so events apply in
 * any order and the persist is a pure deduped append.
 */

// The cursor row in existing dev databases carries the legacy name; renaming
// it would orphan the stored position and force a full re-sweep for nothing.
const CURSOR_NAME = "ReviewBond";
const LABEL = "ReviewCredit";

const EVENTS = [
  getAbiItem({ abi: reviewCreditVaultAbi, name: "ReviewCreditDeposited" }),
  getAbiItem({ abi: reviewCreditVaultAbi, name: "ReviewFeesWithdrawn" }),
];

const KIND_BY_EVENT: Record<string, ReviewCreditEventKind> = {
  ReviewCreditDeposited: "deposited",
  ReviewFeesWithdrawn: "fees_withdrawn",
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: EVENTS,
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const kind = log.eventName ? KIND_BY_EVENT[log.eventName] : undefined;

    if (!kind) {
      console.warn(
        `[${LABEL}] Unrecognized event ${log.eventName ?? "unknown"}; skipping`,
      );
      return;
    }

    const contractId = await getOrCreateContractId(
      config.contracts.reviewCreditVault,
      "ReviewCreditVault",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildReviewCreditRecord({
      blockTimestamp,
      config,
      contractId,
      kind,
      log: log as ReviewCreditLog,
    });

    console.log(
      `[${log.eventName}] account=${record.event.account} amount=${record.event.amount}`,
    );

    await persistReviewCreditRecord(record);
  },
  label: LABEL,
  subject: "review credit vault",
  // The vault address is unset until the review-credit vault deploys on a
  // chain; an unconfigured vault contributes no addresses, so the watcher
  // idles instead of subscribing to the zero address.
  ...staticContractSet(() =>
    config.contracts.reviewCreditVault === ZERO_ADDRESS
      ? null
      : config.contracts.reviewCreditVault,
  ),
});

/** Catch-up sweep over review-credit vault logs up to currentBlock. */
export const recoverReviewCreditEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchReviewCreditEvents = watcher.watch;
