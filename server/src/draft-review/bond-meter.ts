import { config, ZERO_ADDRESS } from "src/config";
import { and, db, eq, schema, sql } from "src/db/client";
import type { MarketDraftRow } from "src/db/schema/market-drafts";

/**
 * The per-review-run rate, in the vault's native units with the inherited
 * `$1 = 1e18` peg (protocol ADR 0009 Q1). ADR 0022's prepaid-credit amendment
 * replaced the bundled "$1 per submission incl. 5 runs, $0.20 after" schedule
 * with this single rate.
 *
 * **$0.10 is a testing rate and is below cost** — a review run measures $0.169
 * on the claude-cli provider, so every run loses money and iterating loses
 * more, which inverts the anti-spam incentive the credit exists to create.
 * Public draft submission must not open until the rate clears cost or review
 * moves to a cheaper provider. It is configuration precisely so that change is
 * a deploy rather than a release.
 */
const DEFAULT_REVIEW_RUN_RATE_WAD = 10n ** 17n;

/** Reads the per-review-run rate, falling back to the testing default. */
export function readReviewRunRateWad(
  env: Record<string, string | undefined> = process.env,
): bigint {
  const value = env.POPCHARTS_REVIEW_RUN_RATE_WAD;

  if (value === undefined || value === "") {
    return DEFAULT_REVIEW_RUN_RATE_WAD;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      "POPCHARTS_REVIEW_RUN_RATE_WAD must be a non-negative integer in wei.",
    );
  }

  return BigInt(value);
}

export type ReviewCreditQuote =
  | { kind: "not_metered" }
  | { kind: "missing_wallet" }
  | { amountWad: bigint; kind: "chargeable"; rateWad: bigint }
  | {
      availableWad: bigint;
      kind: "insufficient";
      requiredWad: bigint;
      runsUsed: number;
    };

/** A wallet's credit position, as the deposit panel renders it. */
export type ReviewCreditSummary = {
  availableWad: bigint;
  rateWad: bigint;
  /** Whole review runs the remaining credit covers at the current rate. */
  runsRemaining: number;
  /** Lifetime review runs charged to this wallet. */
  runsUsed: number;
};

export type ReviewCreditDependencies = {
  rateWad: () => bigint;
  vaultAddress: () => string;
};

const defaultDependencies: ReviewCreditDependencies = {
  rateWad: () => readReviewRunRateWad(),
  vaultAddress: () => config.contracts.reviewBondVault,
};

/**
 * A wallet's remaining review credit: indexed lifetime deposits minus every
 * review run metered against it.
 *
 * Both halves come from the database — deliberately, and never from a direct
 * chain read. Deposits are indexed from the vault's events; charges are written
 * synchronously as runs are metered. That ordering is what makes the gate safe:
 * indexer lag can only make a balance look *too low*, never too high, so the
 * gate fails closed by construction rather than by error handling. The cost is
 * that a creator who has just deposited can be briefly refused, which is why
 * the deposit handler signals the change feed.
 *
 * Clamped at zero: charges can only be written against a balance that covered
 * them, so a negative result would mean a deposit row vanished, and refusing
 * the next run is the safe reading of that.
 */
export async function reviewCreditSummary(
  address: string,
  dependencies: ReviewCreditDependencies = defaultDependencies,
): Promise<ReviewCreditSummary> {
  const normalized = address.toLowerCase();
  const [deposits] = await db
    .select({
      total: sql<string>`coalesce(sum(${schema.reviewBondEvents.amount}), 0)`,
    })
    .from(schema.reviewBondEvents)
    .where(
      and(
        eq(schema.reviewBondEvents.account, normalized),
        eq(schema.reviewBondEvents.kind, "deposited"),
      ),
    );
  const [charges] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${schema.draftReviewCharges.amount}), 0)`,
    })
    .from(schema.draftReviewCharges)
    .where(eq(schema.draftReviewCharges.chargedAddress, normalized));

  const remaining =
    BigInt(deposits?.total ?? "0") - BigInt(charges?.total ?? "0");
  const availableWad = remaining < 0n ? 0n : remaining;
  const rateWad = dependencies.rateWad();

  return {
    availableWad,
    rateWad,
    // A zero rate means reviews are free; report no runs rather than infinity.
    runsRemaining: rateWad === 0n ? 0 : Number(availableWad / rateWad),
    runsUsed: charges?.count ?? 0,
  };
}

/**
 * Prices one review run of a draft and checks the creator's credit covers it.
 * The meter is active whenever a vault address is configured; without one (a
 * local stack booted before the vault deploy, tests) drafts submit unmetered.
 */
export async function quoteReviewRun(
  { draft }: { draft: MarketDraftRow },
  dependencies: ReviewCreditDependencies = defaultDependencies,
): Promise<ReviewCreditQuote> {
  if (dependencies.vaultAddress() === ZERO_ADDRESS) {
    return { kind: "not_metered" };
  }

  const address = draft.intendedCreatorAddress;

  if (!address) {
    return { kind: "missing_wallet" };
  }

  const summary = await reviewCreditSummary(address, dependencies);

  if (summary.availableWad < summary.rateWad) {
    return {
      availableWad: summary.availableWad,
      kind: "insufficient",
      requiredWad: summary.rateWad,
      runsUsed: summary.runsUsed,
    };
  }

  return {
    amountWad: summary.rateWad,
    kind: "chargeable",
    rateWad: summary.rateWad,
  };
}
