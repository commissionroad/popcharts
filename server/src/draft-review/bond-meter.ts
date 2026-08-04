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
  /** Review runs charged to this wallet under the prepaid-credit model. */
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

/** A drizzle handle: the shared client or an open transaction. */
type DbHandle = Pick<typeof db, "select">;

/**
 * Serializes same-wallet credit operations for the duration of the current
 * transaction via a Postgres advisory lock keyed on the wallet address. The
 * quote-then-charge sequence is not otherwise atomic: two drafts submitting
 * for the same wallet would each read the same balance, each pass, and
 * together overspend it. `hashtextextended` collides only across unrelated
 * wallets, where a spurious wait is harmless.
 */
export async function lockWalletCredit(
  tx: Pick<typeof db, "execute">,
  address: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${address.toLowerCase()}, 42))`,
  );
}

/**
 * A wallet's remaining review credit: indexed deposits into the *configured*
 * vault minus every review run metered against the wallet.
 *
 * Both halves come from the database — deliberately, and never from a direct
 * chain read. Deposits are indexed from the vault's events; charges are written
 * synchronously as runs are metered. That ordering is what makes the gate safe:
 * indexer lag can only make a balance look *too low*, never too high, so the
 * gate fails closed by construction rather than by error handling. The cost is
 * that a creator who has just deposited can be briefly refused, which is why
 * the deposit handler signals the change feed.
 *
 * Two scoping rules keep old ledgers from leaking into the new one:
 * - Deposits count only when their event row belongs to the configured
 *   vault's contract on the configured chain — a redeploy (or another
 *   network's rows in a shared DB) contributes nothing.
 * - Charges count only the prepaid-model `review_run` kind. Legacy
 *   `submission` / `extra_review` rows were priced against the refundable
 *   bond and settled on-chain under the withdrawn design; debiting them
 *   again here would double-charge history the old system already collected.
 *
 * Clamped at zero: charges can only be written against a balance that covered
 * them, so a negative result would mean a deposit row vanished, and refusing
 * the next run is the safe reading of that.
 */
export async function reviewCreditSummary(
  address: string,
  dependencies: ReviewCreditDependencies = defaultDependencies,
  dbc: DbHandle = db,
): Promise<ReviewCreditSummary> {
  const normalized = address.toLowerCase();
  const vault = dependencies.vaultAddress().toLowerCase();
  const [deposits] = await dbc
    .select({
      total: sql<string>`coalesce(sum(${schema.reviewBondEvents.amount}), 0)`,
    })
    .from(schema.reviewBondEvents)
    .innerJoin(
      schema.contracts,
      eq(schema.reviewBondEvents.contractId, schema.contracts.id),
    )
    .where(
      and(
        eq(schema.reviewBondEvents.account, normalized),
        eq(schema.reviewBondEvents.kind, "deposited"),
        eq(schema.reviewBondEvents.chainId, config.chainId),
        sql`lower(${schema.contracts.address}) = ${vault}`,
      ),
    );
  const [charges] = await dbc
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${schema.draftReviewCharges.amount}), 0)`,
    })
    .from(schema.draftReviewCharges)
    .where(
      and(
        eq(schema.draftReviewCharges.chargedAddress, normalized),
        eq(schema.draftReviewCharges.kind, "review_run"),
      ),
    );

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
 *
 * Callers charging on the result must run quote and charge inside one
 * transaction under {@link lockWalletCredit} — the submit path does — or two
 * concurrent submissions can both pass on the same remaining run.
 */
export async function quoteReviewRun(
  { dbc = db, draft }: { dbc?: DbHandle; draft: MarketDraftRow },
  dependencies: ReviewCreditDependencies = defaultDependencies,
): Promise<ReviewCreditQuote> {
  if (dependencies.vaultAddress() === ZERO_ADDRESS) {
    return { kind: "not_metered" };
  }

  const address = draft.intendedCreatorAddress;

  if (!address) {
    return { kind: "missing_wallet" };
  }

  const summary = await reviewCreditSummary(address, dependencies, dbc);

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
