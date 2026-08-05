import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { buildAiReviewEnv } from "../shared/aiReview/buildAiReviewEnv.ts";
import { deriveStackResources } from "../shared/localStack/ports.ts";

const resources = deriveStackResources(0);

const OVERRIDES = [
  "LOCAL_AI_REVIEW_EVIDENCE_MODE",
  "LOCAL_AI_REVIEW_PROVIDER",
  "LOCAL_AI_REVIEW_SEARCH_PROVIDER",
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
  it("runs the keyless local reviewer, not the deployed one", () => {
    // Local and deployed diverge on purpose. Deployed defaults to the
    // Anthropic API over Tavily-collected evidence, which needs
    // ANTHROPIC_API_KEY and TAVILY_API_KEY; requiring either would put a paid
    // dependency in front of bringing up a local stack. claude-cli browses
    // for itself using the host's logged-in Claude Code, so local needs no
    // keys at all.
    //
    // scripts/ never imports server/src, so neither side can read the other's
    // default. This pins the local half so a one-sided edit fails here rather
    // than silently making `just local-dev` demand an API key.
    const env = buildAiReviewEnv({}, resources);

    assert.equal(env.AI_REVIEW_PROVIDER, "claude-cli");
    assert.equal(env.AI_REVIEW_EVIDENCE_MODE, "native");
    assert.equal(env.AI_REVIEW_SEARCH_PROVIDER, "duckduckgo");
  });

  it("lets the local stack opt into the deployed configuration", () => {
    process.env.LOCAL_AI_REVIEW_PROVIDER = "anthropic";
    process.env.LOCAL_AI_REVIEW_EVIDENCE_MODE = "precollected";
    process.env.LOCAL_AI_REVIEW_SEARCH_PROVIDER = "tavily";

    const env = buildAiReviewEnv({}, resources);

    assert.equal(env.AI_REVIEW_PROVIDER, "anthropic");
    assert.equal(env.AI_REVIEW_EVIDENCE_MODE, "precollected");
    assert.equal(env.AI_REVIEW_SEARCH_PROVIDER, "tavily");
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
