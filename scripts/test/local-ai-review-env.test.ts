import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { buildAiReviewEnv } from "../shared/aiReview/buildAiReviewEnv.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

const resources = deriveStackResources(0);

const OVERRIDES = [
  "LOCAL_AI_REVIEW_TIMEOUT_MS",
  "LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES",
  "LOCAL_AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS",
  "LOCAL_AI_REVIEW_RUNNER_LEASE_MS",
] as const;

afterEach(() => {
  for (const name of OVERRIDES) {
    delete process.env[name];
  }
});

describe("local AI review provider", () => {
  it("defaults to the same provider as the service-side fallback", () => {
    // scripts/ deliberately never imports server/src, so this default and the
    // one in server/src/ai-review/config.ts cannot share a constant. Pinning
    // it here at least makes a one-sided edit fail a test rather than silently
    // pointing the local stack at a different provider than a deployment.
    assert.equal(
      buildAiReviewEnv({}, resources).AI_REVIEW_PROVIDER,
      "codex-cli",
    );
  });

  it("lets LOCAL_AI_REVIEW_PROVIDER select an alternative", () => {
    process.env.LOCAL_AI_REVIEW_PROVIDER = "ollama";

    assert.equal(buildAiReviewEnv({}, resources).AI_REVIEW_PROVIDER, "ollama");
  });
});

describe("local AI review timing", () => {
  it("keeps the service model budget fail-closed", () => {
    const service = buildAiReviewEnv({}, resources);

    assert.equal(service.AI_REVIEW_TIMEOUT_MS, "300000");
    assert.equal(service.AI_REVIEW_FALLBACK_APPROVE, "false");
    assert.equal(service.AI_REVIEW_RETRY_PROVIDER_FAILURES, "true");
  });

  it("honors explicit local timing overrides", () => {
    process.env.LOCAL_AI_REVIEW_TIMEOUT_MS = "120000";
    process.env.LOCAL_AI_REVIEW_RETRY_PROVIDER_FAILURES = "false";

    const service = buildAiReviewEnv({}, resources);

    assert.equal(service.AI_REVIEW_TIMEOUT_MS, "120000");
    assert.equal(service.AI_REVIEW_RETRY_PROVIDER_FAILURES, "false");
  });
});
