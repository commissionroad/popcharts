import { reviewBondVaultAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config, ZERO_ADDRESS } from "src/config";
import {
  buildReviewBondRecord,
  persistReviewBondRecord,
  type ReviewBondEventKind,
  type ReviewBondLog,
} from "src/indexer/handlers/review-bond";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches the ReviewBondVault's four money events — user deposits, resolver
 * settlements of consumed review fees, user withdrawals of unconsumed bond,
 * and owner fee sweeps — so every value transfer through the review-bond
 * escrow (ADR 0022) leaves an immutable review_bond_events row
 * (docs/portfolio-data-design.md money invariant). The vault is standalone:
 * nothing here touches markets, so events apply in any order and the persist
 * is a pure deduped append.
 */

const CURSOR_NAME = "ReviewBond";
const LABEL = "ReviewBond";

const EVENTS = [
  getAbiItem({ abi: reviewBondVaultAbi, name: "ReviewBondDeposited" }),
  getAbiItem({ abi: reviewBondVaultAbi, name: "ReviewFeesSettled" }),
  getAbiItem({ abi: reviewBondVaultAbi, name: "ReviewBondWithdrawn" }),
  getAbiItem({ abi: reviewBondVaultAbi, name: "ReviewFeesWithdrawn" }),
];

const KIND_BY_EVENT: Record<string, ReviewBondEventKind> = {
  ReviewBondDeposited: "deposited",
  ReviewFeesSettled: "settled",
  ReviewBondWithdrawn: "bond_withdrawn",
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
      config.contracts.reviewBondVault,
      "ReviewBondVault",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildReviewBondRecord({
      blockTimestamp,
      config,
      contractId,
      kind,
      log: log as ReviewBondLog,
    });

    console.log(
      `[${log.eventName}] account=${record.event.account} amount=${record.event.amount}`,
    );

    await persistReviewBondRecord(record);
  },
  label: LABEL,
  subject: "review bond vault",
  // The vault address is unset until the review-bond escrow deploys on a
  // chain; an unconfigured vault contributes no addresses, so the watcher
  // idles instead of subscribing to the zero address.
  ...staticContractSet(() =>
    config.contracts.reviewBondVault === ZERO_ADDRESS
      ? null
      : config.contracts.reviewBondVault,
  ),
});

/** Catch-up sweep over review-bond vault logs up to currentBlock. */
export const recoverReviewBondEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchReviewBondEvents = watcher.watch;
