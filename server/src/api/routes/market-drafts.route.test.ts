import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";

import { markMarketDraftPublished } from "src/api/services/market-drafts";
import { config } from "src/config";
import type { db as productionDb } from "src/db/client";
import { eq, schema, setDbForTesting } from "src/db/client";
import { processDraftReviewJobsOnce } from "src/draft-review/runner";

import { createPgliteDb } from "src/test-support/pglite-db";

let app: (typeof import("src/api"))["app"];
let dbc: typeof productionDb;
let reset: () => Promise<void>;
let teardownDb: () => Promise<void>;
let privateKey: CryptoKey;

// These route tests run in the production auth posture: a Privy-style ES256
// token minted with a test keypair, verified for real by the auth seam
// (ADR 0022 decision 8) — no dev-header shortcut.
const PRIVY_APP_ID = "route-test-privy-app";
const OWNER = "did:privy:route-test-owner";
const OTHER_OWNER = "did:privy:route-test-other";

beforeAll(async () => {
  const keys = await generateKeyPair("ES256");
  privateKey = keys.privateKey as CryptoKey;
  process.env.PRIVY_APP_ID = PRIVY_APP_ID;
  process.env.PRIVY_VERIFICATION_KEY = await exportSPKI(keys.publicKey);

  ({ dbc, reset, teardown: teardownDb } = await createPgliteDb());
  setDbForTesting(dbc);
  ({ app } = await import("src/api"));
}, 15_000);

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  delete process.env.PRIVY_APP_ID;
  delete process.env.PRIVY_VERIFICATION_KEY;
  setDbForTesting(null);
  await teardownDb();
});

async function mintToken(subject: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256" })
    .setIssuer("privy.io")
    .setAudience(PRIVY_APP_ID)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

async function request(
  path: string,
  {
    body,
    method = "GET",
    owner = OWNER,
  }: { body?: unknown; method?: string; owner?: string | null } = {},
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      headers: {
        "content-type": "application/json",
        ...(owner ? { authorization: `Bearer ${await mintToken(owner)}` } : {}),
      },
      method,
    }),
  );
}

async function createDraft(content: Record<string, unknown> = {}) {
  const response = await request("/drafts", { body: content, method: "POST" });

  expect(response.status).toBe(201);

  return (await response.json()) as { id: number; status: string };
}

const REVIEWABLE_CONTENT = {
  category: "Crypto",
  question: "Will bitcoin close above $100k on 2027-01-01?",
  resolutionCriteria:
    "Resolves YES if the BTC/USD daily close on 2027-01-01 exceeds 100000 per CoinGecko.",
  resolutionSources: "https://www.coingecko.com\nhttps://www.coindesk.com",
};

describe("draft auth", () => {
  it("rejects requests without an owner header", async () => {
    const response = await request("/drafts", { owner: null });

    expect(response.status).toBe(401);
  });

  it("scopes reads to the owner", async () => {
    const draft = await createDraft({ question: "Mine" });
    const foreign = await request(`/drafts/${draft.id}`, {
      owner: OTHER_OWNER,
    });

    expect(foreign.status).toBe(404);

    const own = await request(`/drafts/${draft.id}`);

    expect(own.status).toBe(200);
  });
});

describe("draft CRUD arc", () => {
  it("creates, lists, updates, and soft-deletes a draft", async () => {
    const draft = await createDraft({ question: "First question" });

    expect(draft.status).toBe("editing");

    const listResponse = await request("/drafts");
    const list = (await listResponse.json()) as Array<{ id: number }>;

    expect(list.map((d) => d.id)).toEqual([draft.id]);

    const patchResponse = await request(`/drafts/${draft.id}`, {
      body: { question: "Refined question" },
      method: "PATCH",
    });
    const patched = (await patchResponse.json()) as { question: string };

    expect(patched.question).toBe("Refined question");

    const deleteResponse = await request(`/drafts/${draft.id}`, {
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(200);

    const afterDelete = await request("/drafts");

    expect(await afterDelete.json()).toEqual([]);
  });

  it("marks a draft as a template via patch", async () => {
    const draft = await createDraft({ question: "Template me" });
    const response = await request(`/drafts/${draft.id}`, {
      body: { isTemplate: true },
      method: "PATCH",
    });
    const updated = (await response.json()) as { isTemplate: boolean };

    expect(updated.isTemplate).toBe(true);
  });
});

describe("submit and review arc", () => {
  it("refuses submission of an incomplete draft with field errors", async () => {
    const draft = await createDraft({ question: "Only a question" });
    const response = await request(`/drafts/${draft.id}/submit`, {
      method: "POST",
    });

    expect(response.status).toBe(422);

    const body = (await response.json()) as {
      errors: Record<string, string>;
    };

    expect(body.errors.resolutionCriteria).toBe("Add resolution criteria.");
  });

  it("runs the full approve arc: submit, review, feedback, approved", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);
    const submitResponse = await request(`/drafts/${draft.id}/submit`, {
      method: "POST",
    });

    expect(submitResponse.status).toBe(202);
    expect(((await submitResponse.json()) as { status: string }).status).toBe(
      "in_review",
    );

    const outcomes = await processDraftReviewJobsOnce();

    expect(outcomes).toEqual([
      {
        draftId: draft.id,
        jobId: expect.any(Number),
        outcome: "succeeded",
        verdict: "approve",
      },
    ]);

    const reviewed = (await (await request(`/drafts/${draft.id}`)).json()) as {
      latestReview: {
        feedback: { items: unknown[]; summary: string };
        verdict: string;
      };
      status: string;
    };

    expect(reviewed.status).toBe("approved");
    expect(reviewed.latestReview.verdict).toBe("approve");
    expect(reviewed.latestReview.feedback.summary).toBe(
      "Approved — this market is ready to publish.",
    );
  });

  it("rejects a policy-violating draft with actionable blockers", async () => {
    const draft = await createDraft({
      ...REVIEWABLE_CONTENT,
      question: "Will my roommate get married by 2027?",
    });

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const reviewed = (await (await request(`/drafts/${draft.id}`)).json()) as {
      latestReview: {
        feedback: {
          items: Array<{ howToFix: string; severity: string; title: string }>;
        };
      };
      status: string;
    };

    expect(reviewed.status).toBe("rejected");

    const blocker = reviewed.latestReview.feedback.items.find(
      (item) => item.severity === "blocker",
    );

    expect(blocker?.title).toBe("Make it publicly checkable");
    expect(blocker?.howToFix).toContain("public");
  });

  it("requests changes for a vague question and approves after a fix", async () => {
    const draft = await createDraft({
      ...REVIEWABLE_CONTENT,
      question: "Bitcoin to the moon during 2027",
    });

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const flagged = (await (await request(`/drafts/${draft.id}`)).json()) as {
      latestReview: { feedback: { items: Array<{ title: string }> } };
      status: string;
    };

    expect(flagged.status).toBe("changes_requested");
    expect(
      flagged.latestReview.feedback.items.some(
        (item) => item.title === "Phrase it as a yes/no question",
      ),
    ).toBe(true);

    // The fix loop: edit returns the draft to editing, resubmit re-reviews.
    const patchResponse = await request(`/drafts/${draft.id}`, {
      body: { question: "Will bitcoin close above $100k on 2027-01-01?" },
      method: "PATCH",
    });

    expect(((await patchResponse.json()) as { status: string }).status).toBe(
      "editing",
    );

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const approved = (await (await request(`/drafts/${draft.id}`)).json()) as {
      status: string;
    };

    expect(approved.status).toBe("approved");
  });

  it("locks in-review drafts against edits and duplicate submits", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });

    const patchResponse = await request(`/drafts/${draft.id}`, {
      body: { question: "Changed mid-review" },
      method: "PATCH",
    });

    expect(patchResponse.status).toBe(409);

    const resubmit = await request(`/drafts/${draft.id}/submit`, {
      method: "POST",
    });

    expect(resubmit.status).toBe(409);
  });
});

describe("clone arc", () => {
  it("clones one of the owner's drafts verbatim", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);
    const response = await request("/drafts/clone", {
      body: { asTemplate: true, fromDraftId: draft.id },
      method: "POST",
    });

    expect(response.status).toBe(201);

    const clone = (await response.json()) as {
      id: number;
      isTemplate: boolean;
      question: string;
      status: string;
    };

    expect(clone.id).not.toBe(draft.id);
    expect(clone.isTemplate).toBe(true);
    expect(clone.question).toBe(REVIEWABLE_CONTENT.question);
    expect(clone.status).toBe("editing");
  });

  it("clones an indexed market by id", async () => {
    await seedIndexedMarket();

    const response = await request("/drafts/clone", {
      body: { fromMarket: { chainId: 31337, marketId: "7" } },
      method: "POST",
    });

    expect(response.status).toBe(201);

    const clone = (await response.json()) as {
      liquidityParameter: number;
      openingProbability: number;
      question: string;
      resolutionSources: string;
    };

    expect(clone.question).toBe("Will the seeded market resolve YES?");
    expect(clone.liquidityParameter).toBe(5000);
    expect(clone.openingProbability).toBe(60);
    expect(clone.resolutionSources).toBe("https://example.com/source");
  });

  it("404s when the market is unknown", async () => {
    const response = await request("/drafts/clone", {
      body: { fromMarket: { chainId: 31337, marketId: "999" } },
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});

describe("publish arc", () => {
  it("mints publish params only for approved drafts", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);
    const early = await request(`/drafts/${draft.id}/publish-params`, {
      method: "POST",
    });

    expect(early.status).toBe(409);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const response = await request(`/drafts/${draft.id}/publish-params`, {
      method: "POST",
    });

    expect(response.status).toBe(200);

    const params = (await response.json()) as {
      graduationDeadline: string;
      graduationThreshold: string;
      liquidityParameter: string;
      metadata: string;
      metadataHash: string;
      resolutionTime: string;
      yesNotBefore: string;
    };

    expect(params.liquidityParameter).toBe("5000000000000000000000");
    expect(params.graduationThreshold).toBe("2500000000000000000000");
    expect(params.yesNotBefore).toBe(params.resolutionTime);
    expect(
      BigInt(params.resolutionTime) - BigInt(params.graduationDeadline),
    ).toBe(BigInt(7 * 24 * 60 * 60 - 60 * 60));
    expect(params.metadata).toContain("Will bitcoin close above");

    const parsed = JSON.parse(params.metadata) as { question: string };

    expect(parsed.question).toBe(REVIEWABLE_CONTENT.question);
  });

  it("attaches a creator-bound authorization when the stack can sign", async () => {
    // The hermetic env has no contracts and no authorizer key; arm both for
    // this test the way the review-bond tests patch the vault address.
    const originalManager = config.contracts.pregradManager;
    const originalCollateral = config.contracts.collateral;
    config.contracts.pregradManager =
      "0x00000000000000000000000000000000000000e1";
    config.contracts.collateral = "0x00000000000000000000000000000000000000dd";
    process.env.POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY =
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

    try {
      const draft = await createDraft(REVIEWABLE_CONTENT);
      await request(`/drafts/${draft.id}/submit`, { method: "POST" });
      await processDraftReviewJobsOnce();

      // Without a creator wallet there is nothing to bind: params only.
      const unbound = await request(`/drafts/${draft.id}/publish-params`, {
        method: "POST",
      });
      expect(unbound.status).toBe(200);
      expect(
        ((await unbound.json()) as { authorization?: unknown }).authorization,
      ).toBeUndefined();

      const creatorAddress = "0x00000000000000000000000000000000000000ab";
      const response = await request(
        `/drafts/${draft.id}/publish-params?creatorAddress=${creatorAddress}`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);

      const minted = (await response.json()) as {
        collateral: string;
        authorization?: { expiry: string; nonce: string; signature: string };
      };

      expect(minted.collateral).toBe(config.contracts.collateral);
      expect(minted.authorization).toBeDefined();
      expect(minted.authorization!.signature).toMatch(/^0x[0-9a-f]+$/);
      expect(BigInt(minted.authorization!.nonce)).toBeGreaterThan(0n);
      // 15-minute window anchored at mint time; recovery-level verification
      // lives in publish-authorization.test.ts and the protocol package's
      // on-chain vector test.
      expect(
        BigInt(minted.authorization!.expiry) -
          BigInt(Math.floor(Date.now() / 1000)),
      ).toBeLessThanOrEqual(900n + 60n);
    } finally {
      delete process.env.POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY;
      config.contracts.pregradManager = originalManager;
      config.contracts.collateral = originalCollateral;
    }
  });

  it("refuses to record a publish it cannot verify on-chain", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    // The test RPC is dead, so the receipt can never be read: the route must
    // fail closed rather than link (and bridge-approve) a claimed market.
    const response = await request(`/drafts/${draft.id}/published`, {
      body: {
        chainId: config.chainId,
        marketId: "12",
        transactionHash: `0x${"ab".repeat(32)}`,
      },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      "The publish transaction could not be read from the chain.",
    );

    const after = (await (await request(`/drafts/${draft.id}`)).json()) as {
      status: string;
    };

    expect(after.status).toBe("approved");
  });

  it("rejects a publish for a chain this API does not serve", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const response = await request(`/drafts/${draft.id}/published`, {
      body: {
        chainId: config.chainId + 1,
        marketId: "12",
        transactionHash: `0x${"ab".repeat(32)}`,
      },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.text()).toBe(
      `This API serves chain ${config.chainId}, not ${config.chainId + 1}.`,
    );
  });

  it("records the publish once the receipt verifies", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    // Service-level with an injected verifier: the route always uses the real
    // chain reader, which the dead-RPC test above pins.
    const result = await markMarketDraftPublished(
      {
        chainId: config.chainId,
        draftId: draft.id,
        marketId: 12n,
        owner: OWNER,
        transactionHash: `0x${"ab".repeat(32)}`,
      },
      { verifyReceipt: async () => ({ kind: "verified" }) },
    );

    expect(result.kind).toBe("published");

    if (result.kind !== "published") {
      throw new Error("Expected a published result.");
    }

    // No bridge any more (ADR 0022 P5): markets are born Active on-chain,
    // so recording the publish touches nothing but the draft row.
    expect(result.draft.status).toBe("published");
    expect(result.draft.publishedMarketId).toBe("12");

    const resubmit = await request(`/drafts/${draft.id}/submit`, {
      method: "POST",
    });

    expect(resubmit.status).toBe(409);
  });

  it("drops a receipt whose content is not the reviewed snapshot", async () => {
    const draft = await createDraft(REVIEWABLE_CONTENT);

    await request(`/drafts/${draft.id}/submit`, { method: "POST" });
    await processDraftReviewJobsOnce();

    const result = await markMarketDraftPublished(
      {
        chainId: config.chainId,
        draftId: draft.id,
        marketId: 12n,
        owner: OWNER,
        transactionHash: `0x${"ab".repeat(32)}`,
      },
      {
        verifyReceipt: async ({ metadataHash }) => ({
          kind: "failed",
          message: `The published market's content is not this draft's reviewed content. (${metadataHash.slice(0, 6)})`,
        }),
      },
    );

    expect(result.kind).toBe("verification_failed");
  });
});

async function seedIndexedMarket() {
  const [contract] = await dbc
    .insert(schema.contracts)
    .values({
      address: "0x0000000000000000000000000000000000000011",
      chainId: 31337,
      name: "DraftCloneTest",
    })
    .returning();
  const metadataHash = `0x${"11".repeat(32)}`;

  await dbc.insert(schema.marketMetadata).values({
    category: "Crypto",
    chainId: 31337,
    description: "Seeded for clone tests.",
    metadataCreatedAt: new Date("2026-07-01T00:00:00Z").toISOString(),
    metadataHash,
    question: "Will the seeded market resolve YES?",
    resolutionCriteria: "Resolves YES per the seeded source.",
    resolutionSources: ["https://example.com/source"],
  });
  const created = new Date("2026-07-01T00:00:00Z");

  await dbc.insert(schema.markets).values({
    chainId: 31337,
    collateral: "0x0000000000000000000000000000000000000001",
    contractId: contract!.id,
    createdBlockNumber: 1n,
    createdBlockTimestamp: created,
    createdLogIndex: 0,
    createdTransactionHash: `0x${"22".repeat(32)}`,
    creator: OWNER,
    graduationThreshold: 2_500n * 10n ** 18n,
    graduationTime: new Date(created.getTime() + 6 * 60 * 60 * 1000),
    liquidityParameter: 5_000n * 10n ** 18n,
    marketId: 7n,
    metadataHash,
    openingProbabilityWad: (10n ** 18n * 60n) / 100n,
    resolutionTime: new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000),
    status: "bootstrap",
  });

  const markets = await dbc
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.marketId, 7n));

  expect(markets).toHaveLength(1);
}
