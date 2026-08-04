import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { submitMarketDraft } from "src/api/services/market-drafts";
import { config } from "src/config";
import type { db as productionDb } from "src/db/client";
import { eq, schema, setDbForTesting } from "src/db/client";
import type { MarketDraftRow } from "src/db/schema/market-drafts";
import { createPgliteDb } from "src/test-support/pglite-db";

import {
  quoteReviewRun,
  readReviewRunRateWad,
  reviewCreditSummary,
  type ReviewCreditDependencies,
} from "./bond-meter";

let dbc: typeof productionDb;
let reset: () => Promise<void>;
let teardownDb: () => Promise<void>;

const OWNER = "did:privy:meter-test-owner";
const WALLET = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const VAULT = "0x00000000000000000000000000000000000000bd";
const WAD = 10n ** 18n;
/** The testing default: $0.10 per review run. */
const RATE = WAD / 10n;

beforeAll(async () => {
  ({ dbc, reset, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
}, 15_000);

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  setDbForTesting(null);
  await teardownDb();
});

function meterDeps({
  rate = RATE,
  vault = VAULT,
}: {
  rate?: bigint;
  vault?: string;
} = {}): ReviewCreditDependencies {
  return {
    rateWad: () => rate,
    vaultAddress: () => vault,
  };
}

async function seedDraft(
  overrides: Partial<typeof schema.marketDrafts.$inferInsert> = {},
): Promise<MarketDraftRow> {
  const [draft] = await dbc
    .insert(schema.marketDrafts)
    .values({
      category: "Crypto",
      intendedCreatorAddress: WALLET,
      ownerUserId: OWNER,
      question: "Will the meter charge?",
      resolutionCriteria: "Resolves YES per the seeded source.",
      resolutionSources: "https://example.com",
      ...overrides,
    })
    .returning();

  return draft!;
}

/** Indexes a deposit the way the review-bond watcher would. The credit query
 * scopes to the configured chain and vault contract, so the defaults match
 * the meter's view and the overrides seed rows it must ignore. */
async function seedDeposit({
  amount,
  chainId = config.chainId,
  logIndex = 0,
  vault = VAULT,
}: {
  amount: bigint;
  chainId?: number;
  logIndex?: number;
  vault?: string;
}) {
  const [contract] = await dbc
    .insert(schema.contracts)
    .values({ address: vault, chainId, name: "ReviewBondVault" })
    .onConflictDoNothing()
    .returning();
  const contractId =
    contract?.id ??
    (
      await dbc
        .select()
        .from(schema.contracts)
        .where(eq(schema.contracts.address, vault))
    )[0]!.id;

  await dbc.insert(schema.reviewBondEvents).values({
    account: WALLET,
    amount,
    blockNumber: 1n,
    blockTimestamp: new Date(),
    chainId,
    contractId,
    kind: "deposited",
    logIndex,
    payer: WALLET,
    runningTotal: amount,
    transactionHash: `0xdeposit${chainId}${vault}${logIndex}`,
  });
}

async function seedCharge({
  amount,
  draftId,
  kind = "review_run" as const,
}: {
  amount: bigint;
  draftId: number;
  kind?: (typeof schema.draftReviewCharges.$inferInsert)["kind"];
}) {
  await dbc.insert(schema.draftReviewCharges).values({
    amount,
    chargedAddress: WALLET,
    draftId,
    kind,
    rate: amount,
  });
}

describe("readReviewRunRateWad", () => {
  it("defaults to the $0.10 testing rate", () => {
    expect(readReviewRunRateWad({})).toBe(RATE);
  });

  it("reads the env override", () => {
    expect(
      readReviewRunRateWad({ POPCHARTS_REVIEW_RUN_RATE_WAD: "200000000000000000" }),
    ).toBe(2n * (WAD / 10n));
  });

  it("rejects a malformed override instead of silently defaulting", () => {
    expect(() =>
      readReviewRunRateWad({ POPCHARTS_REVIEW_RUN_RATE_WAD: "0.10" }),
    ).toThrow("non-negative integer");
  });
});

describe("reviewCreditSummary", () => {
  it("is indexed deposits minus metered charges, with run counts", async () => {
    const draft = await seedDraft();

    await seedDeposit({ amount: WAD });
    await seedCharge({ amount: RATE, draftId: draft.id });
    await seedCharge({ amount: RATE, draftId: draft.id });

    const summary = await reviewCreditSummary(WALLET, meterDeps());

    expect(summary).toEqual({
      availableWad: WAD - 2n * RATE,
      rateWad: RATE,
      runsRemaining: 8,
      runsUsed: 2,
    });
  });

  it("clamps at zero rather than reporting negative credit", async () => {
    const draft = await seedDraft();

    // No deposit indexed yet (lagging indexer) but a charge already recorded:
    // the summary must floor at zero, never go negative.
    await seedCharge({ amount: RATE, draftId: draft.id });

    const summary = await reviewCreditSummary(WALLET, meterDeps());

    expect(summary.availableWad).toBe(0n);
    expect(summary.runsRemaining).toBe(0);
    expect(summary.runsUsed).toBe(1);
  });

  it("ignores deposits indexed from another chain or another vault", async () => {
    await seedDeposit({ amount: WAD, chainId: 31337 });
    await seedDeposit({
      amount: WAD,
      logIndex: 1,
      vault: "0x00000000000000000000000000000000000000ce",
    });

    const summary = await reviewCreditSummary(WALLET, meterDeps());

    expect(summary.availableWad).toBe(0n);
  });

  it("ignores legacy bundled-schedule charges — the old system settled them", async () => {
    const draft = await seedDraft();

    await seedDeposit({ amount: WAD });
    await seedCharge({ amount: WAD, draftId: draft.id, kind: "submission" });
    await seedCharge({
      amount: 2n * (WAD / 10n),
      draftId: draft.id,
      kind: "extra_review",
    });

    const summary = await reviewCreditSummary(WALLET, meterDeps());

    expect(summary.availableWad).toBe(WAD);
    expect(summary.runsUsed).toBe(0);
  });

  it("reports no runs at a zero rate instead of dividing by zero", async () => {
    await seedDeposit({ amount: WAD });

    const summary = await reviewCreditSummary(WALLET, meterDeps({ rate: 0n }));

    expect(summary.runsRemaining).toBe(0);
  });
});

describe("quoteReviewRun", () => {
  it("does not meter when no vault is configured", async () => {
    const draft = await seedDraft();

    const quote = await quoteReviewRun(
      { draft },
      meterDeps({ vault: "0x0000000000000000000000000000000000000000" }),
    );

    expect(quote).toEqual({ kind: "not_metered" });
  });

  it("requires a wallet on the draft", async () => {
    const draft = await seedDraft({ intendedCreatorAddress: null });

    const quote = await quoteReviewRun({ draft }, meterDeps());

    expect(quote).toEqual({ kind: "missing_wallet" });
  });

  it("charges the flat rate when credit covers it", async () => {
    const draft = await seedDraft();

    await seedDeposit({ amount: WAD });

    const quote = await quoteReviewRun({ draft }, meterDeps());

    expect(quote).toEqual({
      amountWad: RATE,
      kind: "chargeable",
      rateWad: RATE,
    });
  });

  it("refuses when the remaining credit is below one run", async () => {
    const draft = await seedDraft();

    // $1 deposited, $0.95 already spent: $0.05 left cannot cover a $0.10 run.
    await seedDeposit({ amount: WAD });
    await seedCharge({ amount: 95n * (WAD / 100n), draftId: draft.id });

    const quote = await quoteReviewRun({ draft }, meterDeps());

    expect(quote).toEqual({
      availableWad: 5n * (WAD / 100n),
      kind: "insufficient",
      requiredWad: RATE,
      runsUsed: 1,
    });
  });

  it("refuses a fresh wallet with no deposit at all", async () => {
    const draft = await seedDraft();

    const quote = await quoteReviewRun({ draft }, meterDeps());

    expect(quote).toEqual({
      availableWad: 0n,
      kind: "insufficient",
      requiredWad: RATE,
      runsUsed: 0,
    });
  });
});

describe("submitMarketDraft metering", () => {
  it("charges one review run and enqueues its job atomically", async () => {
    const draft = await seedDraft();

    await seedDeposit({ amount: WAD });

    const result = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
    );

    expect(result.kind).toBe("submitted");

    const charges = await dbc
      .select()
      .from(schema.draftReviewCharges)
      .where(eq(schema.draftReviewCharges.draftId, draft.id));

    expect(charges).toHaveLength(1);
    expect(charges[0]?.kind).toBe("review_run");
    expect(charges[0]?.amount).toBe(RATE);
    expect(charges[0]?.rate).toBe(RATE);
    expect(charges[0]?.chargedAddress).toBe(WALLET);
  });

  it("charges every resubmission at the same flat rate", async () => {
    const draft = await seedDraft();

    await seedDeposit({ amount: WAD });

    const first = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
    );

    expect(first.kind).toBe("submitted");

    // The reviewer hands the draft back; the creator resubmits.
    await dbc
      .update(schema.marketDrafts)
      .set({ status: "changes_requested" })
      .where(eq(schema.marketDrafts.id, draft.id));
    const [reread] = await dbc
      .select()
      .from(schema.marketDrafts)
      .where(eq(schema.marketDrafts.id, draft.id));

    const second = await submitMarketDraft(
      { draftId: reread!.id, owner: OWNER },
      { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
    );

    expect(second.kind).toBe("submitted");

    const charges = await dbc
      .select()
      .from(schema.draftReviewCharges)
      .where(eq(schema.draftReviewCharges.draftId, draft.id));

    expect(charges).toHaveLength(2);
    expect(charges.every((c) => c.amount === RATE)).toBe(true);
  });

  it("refuses an underfunded submission without enqueueing a job", async () => {
    const draft = await seedDraft();

    const result = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
    );

    expect(result.kind).toBe("insufficient_bond");

    if (result.kind === "insufficient_bond") {
      expect(result.availableWad).toBe(0n);
      expect(result.requiredWad).toBe(RATE);
      expect(result.runsUsed).toBe(0);
    }

    const jobs = await dbc
      .select()
      .from(schema.marketDraftReviewJobs)
      .where(eq(schema.marketDraftReviewJobs.draftId, draft.id));

    expect(jobs).toHaveLength(0);
  });

  it("spends credit down to refusal across submissions", async () => {
    const draft = await seedDraft();

    // Two runs' worth of credit: two submits pass, the third is refused.
    await seedDeposit({ amount: 2n * RATE });

    for (let run = 0; run < 2; run += 1) {
      const result = await submitMarketDraft(
        { draftId: draft.id, owner: OWNER },
        { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
      );

      expect(result.kind).toBe("submitted");

      await dbc
        .update(schema.marketDrafts)
        .set({ status: "changes_requested" })
        .where(eq(schema.marketDrafts.id, draft.id));
    }

    const third = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      { quoteCharge: (input) => quoteReviewRun(input, meterDeps()) },
    );

    expect(third.kind).toBe("insufficient_bond");

    if (third.kind === "insufficient_bond") {
      expect(third.runsUsed).toBe(2);
    }
  });
});
