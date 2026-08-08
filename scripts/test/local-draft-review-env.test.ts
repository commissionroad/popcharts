import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { buildLocalServerEnv } from "../shared/env/buildLocalServerEnv.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

const resources = deriveStackResources(0);

const OVERRIDES = [
  "LOCAL_AI_REVIEW_PROVIDER",
  "LOCAL_DRAFT_REVIEW_PROVIDER",
] as const;

afterEach(() => {
  for (const name of OVERRIDES) {
    delete process.env[name];
  }
});

describe("local draft review provider", () => {
  it("gates drafts with the real model by default", () => {
    // The in-code default in server/src/draft-review/runner.ts is the
    // deterministic heuristic (its own test pins that). Local stacks opt
    // into a model at this stack seam instead of in code, so deployed
    // environments — which never run this builder — stay heuristic. This
    // asserts the seam's *output*: a rewrite of the builder that drops the
    // key goes red here even though runner.ts and its tests survive.
    const env = buildLocalServerEnv(resources);

    assert.equal(env.POPCHARTS_DRAFT_REVIEW_PROVIDER, "claude-cli");
  });

  it("lets LOCAL_DRAFT_REVIEW_PROVIDER dial the draft gate alone", () => {
    process.env.LOCAL_DRAFT_REVIEW_PROVIDER = "heuristic";

    const env = buildLocalServerEnv(resources);

    assert.equal(env.POPCHARTS_DRAFT_REVIEW_PROVIDER, "heuristic");
  });

  it("chains from LOCAL_AI_REVIEW_PROVIDER so one dial covers the stack", () => {
    process.env.LOCAL_AI_REVIEW_PROVIDER = "ollama";

    const env = buildLocalServerEnv(resources);

    assert.equal(env.POPCHARTS_DRAFT_REVIEW_PROVIDER, "ollama");
  });

  it("wins over the chained review dial when both are set", () => {
    process.env.LOCAL_AI_REVIEW_PROVIDER = "ollama";
    process.env.LOCAL_DRAFT_REVIEW_PROVIDER = "heuristic";

    const env = buildLocalServerEnv(resources);

    assert.equal(env.POPCHARTS_DRAFT_REVIEW_PROVIDER, "heuristic");
  });
});

describe("local draft review evidence parity", () => {
  it("carries the review-model settings into the API env", () => {
    // The draft loop reads the shared AI_REVIEW_* config in-process. Without
    // these keys the API would inherit the deployed evidence defaults
    // (precollected + tavily) and spend every draft review on no-key
    // evidence collection that returns nothing.
    const env = buildLocalServerEnv(resources);

    assert.equal(env.AI_REVIEW_EVIDENCE_MODE, "native");
    assert.equal(env.AI_REVIEW_SEARCH_PROVIDER, "duckduckgo");
    assert.equal(env.AI_REVIEW_RETRY_PROVIDER_FAILURES, "true");
    assert.equal(env.AI_REVIEW_TIMEOUT_MS, "300000");
  });
});
