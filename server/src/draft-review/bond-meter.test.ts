import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";

import { submitMarketDraft } from "src/api/services/market-drafts";
import type { db as productionDb } from "src/db/client";
import { eq, schema, setDbForTesting } from "src/db/client";
import type { MarketDraftRow } from "src/db/schema/market-drafts";
import { createPgliteDb } from "src/test-support/pglite-db";

import {
  quoteSubmissionCharge,
  readBondResolverPrivateKey,
  REVIEW_BOND_PRICING,
  settleOutstandingCharges,
  unsettledChargesWad,
  type BondMeterDependencies,
} from "./bond-meter";

let dbc: typeof productionDb;
let reset: () => Promise<void>;
let teardownDb: () => Promise<void>;

const OWNER = "did:privy:meter-test-owner";
const WALLET = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const VAULT = "0x00000000000000000000000000000000000000bd";
const WAD = 10n ** 18n;

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
  availableWad = 5n * WAD,
  depositedWad = 5n * WAD,
  fail = false,
  vault = VAULT,
}: {
  availableWad?: bigint;
  depositedWad?: bigint;
  fail?: boolean;
  vault?: string;
} = {}): BondMeterDependencies {
  return {
    readBond: async () => {
      if (fail) {
        throw new Error("chain unreachable");
      }

      return { availableWad, depositedWad };
    },
    vaultAddress: () => vault as `0x${string}`,
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

async function seedCharge({
  amount,
  draftId,
  settled = false,
}: {
  amount: bigint;
  draftId: number;
  settled?: boolean;
}) {
  await dbc.insert(schema.draftReviewCharges).values({
    amount,
    chargedAddress: WALLET,
    draftId,
    kind: "submission",
    ...(settled ? { settledAt: new Date() } : {}),
  });
}

describe("quoteSubmissionCharge", () => {
  it("does not meter when no vault is configured", async () => {
    const draft = await seedDraft();

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps({ vault: "0x0000000000000000000000000000000000000000" }),
    );

    expect(quote).toEqual({ kind: "not_metered" });
  });

  it("requires a wallet on the draft", async () => {
    const draft = await seedDraft({ intendedCreatorAddress: null });

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps(),
    );

    expect(quote).toEqual({ kind: "missing_wallet" });
  });

  it("prices the run ladder: $1 first, bundled to five, $0.20 after", async () => {
    const draft = await seedDraft();

    expect(
      await quoteSubmissionCharge({ draft, priorReviewRuns: 0 }, meterDeps()),
    ).toEqual({
      amountWad: REVIEW_BOND_PRICING.submissionChargeWad,
      chargeKind: "submission",
      kind: "chargeable",
    });
    expect(
      await quoteSubmissionCharge({ draft, priorReviewRuns: 3 }, meterDeps()),
    ).toEqual({ amountWad: 0n, chargeKind: null, kind: "chargeable" });
    expect(
      await quoteSubmissionCharge({ draft, priorReviewRuns: 5 }, meterDeps()),
    ).toEqual({
      amountWad: REVIEW_BOND_PRICING.extraReviewChargeWad,
      chargeKind: "extra_review",
      kind: "chargeable",
    });
  });

  it("refuses below the $5 standing bond even when the charge is covered", async () => {
    const draft = await seedDraft();

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps({ availableWad: 2n * WAD, depositedWad: 2n * WAD }),
    );

    expect(quote).toEqual({
      availableWad: 2n * WAD,
      kind: "insufficient",
      minimumStandingBondWad: REVIEW_BOND_PRICING.minimumStandingBondWad,
      requiredWad: REVIEW_BOND_PRICING.submissionChargeWad,
      standingBondWad: 2n * WAD,
    });
  });

  it("discounts unsettled meter charges from the bonded balance", async () => {
    const draft = await seedDraft();

    // $5 bonded on-chain, but $4.50 already consumed and unsettled: a $1
    // submission must be refused — the same dollar cannot be spent twice.
    await seedCharge({ amount: 45n * (WAD / 10n), draftId: draft.id });

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps(),
    );

    expect(quote).toEqual({
      availableWad: WAD / 2n,
      kind: "insufficient",
      minimumStandingBondWad: REVIEW_BOND_PRICING.minimumStandingBondWad,
      requiredWad: REVIEW_BOND_PRICING.submissionChargeWad,
      standingBondWad: 5n * WAD,
    });
  });

  it("ignores settled charges in the discount", async () => {
    const draft = await seedDraft();

    await seedCharge({
      amount: 45n * (WAD / 10n),
      draftId: draft.id,
      settled: true,
    });

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps(),
    );

    expect(quote.kind).toBe("chargeable");
  });

  it("fails closed when the chain cannot be read", async () => {
    const draft = await seedDraft();

    const quote = await quoteSubmissionCharge(
      { draft, priorReviewRuns: 0 },
      meterDeps({ fail: true }),
    );

    expect(quote).toEqual({ kind: "unavailable" });
  });
});

describe("submitMarketDraft metering", () => {
  it("charges the first submission and enqueues its job atomically", async () => {
    const draft = await seedDraft();
    const settled: string[] = [];

    const result = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      {
        quoteCharge: (input) => quoteSubmissionCharge(input, meterDeps()),
        settleCharges: (address) => {
          settled.push(address);
        },
      },
    );

    expect(result.kind).toBe("submitted");

    const charges = await dbc
      .select()
      .from(schema.draftReviewCharges)
      .where(eq(schema.draftReviewCharges.draftId, draft.id));

    expect(charges).toHaveLength(1);
    expect(charges[0]?.kind).toBe("submission");
    expect(charges[0]?.amount).toBe(REVIEW_BOND_PRICING.submissionChargeWad);
    expect(charges[0]?.chargedAddress).toBe(WALLET);
    expect(charges[0]?.settledAt).toBeNull();
    expect(settled).toEqual([WALLET]);
  });

  it("refuses an underfunded submission with the shortfall figures", async () => {
    const draft = await seedDraft();

    const result = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      {
        quoteCharge: (input) =>
          quoteSubmissionCharge(
            input,
            meterDeps({ availableWad: 0n, depositedWad: 0n }),
          ),
        settleCharges: () => undefined,
      },
    );

    expect(result.kind).toBe("insufficient_bond");

    const jobs = await dbc
      .select()
      .from(schema.marketDraftReviewJobs)
      .where(eq(schema.marketDraftReviewJobs.draftId, draft.id));

    expect(jobs).toHaveLength(0);
  });

  it("refuses when the bond service is unreachable", async () => {
    const draft = await seedDraft();

    const result = await submitMarketDraft(
      { draftId: draft.id, owner: OWNER },
      {
        quoteCharge: (input) =>
          quoteSubmissionCharge(input, meterDeps({ fail: true })),
        settleCharges: () => undefined,
      },
    );

    expect(result.kind).toBe("bond_unavailable");
  });
});

describe("settleOutstandingCharges", () => {
  it("skips below the settlement threshold", async () => {
    const draft = await seedDraft();

    await seedCharge({ amount: WAD / 5n, draftId: draft.id });

    const outcome = await settleOutstandingCharges(WALLET, {
      settleOnChain: async () => {
        throw new Error("must not settle below threshold");
      },
    });

    expect(outcome).toBe("skipped");
  });

  it("settles the lifetime total and stamps the covered rows", async () => {
    const draft = await seedDraft();

    await seedCharge({ amount: WAD, draftId: draft.id });
    await seedCharge({ amount: WAD / 5n, draftId: draft.id, settled: true });

    const calls: Array<{ address: string; consumedTotal: bigint }> = [];
    const outcome = await settleOutstandingCharges(WALLET, {
      settleOnChain: async (address, consumedTotal) => {
        calls.push({ address, consumedTotal });
      },
    });

    expect(outcome).toBe("settled");
    // The resolver attests the LIFETIME total: settled + newly covered rows.
    expect(calls).toEqual([
      { address: WALLET, consumedTotal: WAD + WAD / 5n },
    ]);
    expect(await unsettledChargesWad(WALLET)).toBe(0n);
  });

  it("leaves rows unsettled when the settlement transaction fails", async () => {
    const draft = await seedDraft();

    await seedCharge({ amount: WAD, draftId: draft.id });

    const outcome = await settleOutstandingCharges(WALLET, {
      settleOnChain: async () => {
        throw new Error("resolver offline");
      },
    });

    expect(outcome).toBe("failed");
    expect(await unsettledChargesWad(WALLET)).toBe(WAD);
  });
});

describe("readBondResolverPrivateKey", () => {
  it("prefers the dedicated env key and validates its shape", () => {
    const key = `0x${"11".repeat(32)}`;

    expect(
      readBondResolverPrivateKey(
        { POPCHARTS_BOND_RESOLVER_PRIVATE_KEY: key },
        "arcTestnet",
      ),
    ).toBe(key as `0x${string}`);
    expect(() =>
      readBondResolverPrivateKey(
        { POPCHARTS_BOND_RESOLVER_PRIVATE_KEY: "not-a-key" },
        "arcTestnet",
      ),
    ).toThrow("32-byte hex key");
    expect(() => readBondResolverPrivateKey({}, "arcTestnet")).toThrow(
      "required",
    );
  });

  it("falls back to the shared local dev key on the local network", () => {
    expect(readBondResolverPrivateKey({}, "local")).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
