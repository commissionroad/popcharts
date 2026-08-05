import { describe, expect, it } from "bun:test";

import { validateEvidenceConfig } from "./evidence";

const TAVILY = {
  internetAccess: "search",
  searchProvider: "tavily",
  tavilyApiKey: undefined,
} as const;

describe("validateEvidenceConfig", () => {
  it("fails readiness when Tavily is selected without a key", () => {
    // Without this the service starts happily and reviews everything with no
    // evidence, which reads as a cautious model rather than a broken deploy.
    const { errors } = validateEvidenceConfig({
      config: TAVILY,
      usesPreCollectedEvidence: true,
    });

    expect(errors).toEqual([
      "TAVILY_API_KEY is required when AI_REVIEW_SEARCH_PROVIDER=tavily.",
    ]);
  });

  it("passes once the key is present", () => {
    expect(
      validateEvidenceConfig({
        config: { ...TAVILY, tavilyApiKey: "tvly-test" },
        usesPreCollectedEvidence: true,
      }).errors,
    ).toEqual([]);
  });

  it("stays silent for a provider that collects no evidence", () => {
    // claude-cli browses for itself, so a missing Tavily key is irrelevant —
    // this is exactly the local-dev configuration.
    expect(
      validateEvidenceConfig({
        config: TAVILY,
        usesPreCollectedEvidence: false,
      }).errors,
    ).toEqual([]);
  });

  it("stays silent when the service may not reach the internet at all", () => {
    expect(
      validateEvidenceConfig({
        config: { ...TAVILY, internetAccess: "off" },
        usesPreCollectedEvidence: true,
      }).errors,
    ).toEqual([]);
  });

  it("needs no key for the built-in search", () => {
    expect(
      validateEvidenceConfig({
        config: { ...TAVILY, searchProvider: "duckduckgo" },
        usesPreCollectedEvidence: true,
      }).errors,
    ).toEqual([]);
  });
});
