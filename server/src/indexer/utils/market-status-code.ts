import { MARKET_STATUS, MARKET_STATUS_MEMBERS } from "@popcharts/protocol";

import type { MarketStatus } from "src/db/schema/markets";

/**
 * Translates the contract's `MarketTypes.MarketStatus` ordinal into the
 * projected `markets.status`. The two sets are deliberately different — the
 * contract's `Active` is the board's `bootstrap`, and the DB carries
 * postgrad-side states (`resolution_pending`, `disputed`) the pregrad enum has
 * no member for — so the mapping is written out rather than derived by name.
 *
 * The ordinals come from `@popcharts/protocol`'s generated table, which is
 * derived from the solc AST and regenerates with the contracts. Enums have no
 * ABI representation, so a hand-written ordinal is a silent decode bug waiting
 * for someone to append a member.
 */
const STATUS_BY_CODE: ReadonlyMap<number, MarketStatus> = new Map([
  [MARKET_STATUS.active, "bootstrap"],
  [MARKET_STATUS.graduating, "graduating"],
  [MARKET_STATUS.graduated, "graduated"],
  [MARKET_STATUS.refunded, "refunded"],
  [MARKET_STATUS.resolved, "resolved"],
  [MARKET_STATUS.cancelled, "cancelled"],
  [MARKET_STATUS.underReview, "under_review"],
  [MARKET_STATUS.rejected, "rejected"],
]);

/**
 * `MarketTypes.MarketStatus.Frozen` is declared "reserved for future use" and
 * is set nowhere in the contracts, so it has no projected counterpart. It is
 * left out of the map on purpose: if a future contract starts reaching it,
 * this throws and the sweep parks, rather than the indexer quietly recording a
 * market as something it is not.
 */
export function marketStatusFromCode(code: number): MarketStatus {
  const status = STATUS_BY_CODE.get(code);

  if (!status) {
    const member = MARKET_STATUS_MEMBERS[code] ?? "out of range";
    throw new Error(
      `Contract market status ${code} (${member}) has no projected markets.status.`,
    );
  }

  return status;
}
