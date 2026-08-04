import { describe, expect, it } from "bun:test";

import { inaccessibleDomains } from "./http";

/** The message the API actually returns; captured from a real 400. */
const REAL_ERROR = JSON.stringify({
  error: {
    message:
      "The following domains are not accessible to our user agent: ['apnews.com']. Read more: https://support.anthropic.com/en/articles/8896518",
    type: "invalid_request_error",
  },
  type: "error",
});

describe("inaccessibleDomains", () => {
  it("extracts the domain the API refused to fetch", () => {
    expect(inaccessibleDomains(REAL_ERROR)).toEqual(["apnews.com"]);
  });

  it("extracts several domains", () => {
    expect(
      inaccessibleDomains(
        "The following domains are not accessible to our user agent: ['apnews.com', 'reuters.com']",
      ),
    ).toEqual(["apnews.com", "reuters.com"]);
  });

  it("accepts double quotes as well as single", () => {
    expect(
      inaccessibleDomains(
        'The following domains are not accessible to our user agent: ["apnews.com"]',
      ),
    ).toEqual(["apnews.com"]);
  });

  it("returns none for an unrelated error, so the original surfaces", () => {
    expect(
      inaccessibleDomains(
        '{"error":{"message":"credit balance is too low","type":"invalid_request_error"}}',
      ),
    ).toEqual([]);
    expect(inaccessibleDomains("")).toEqual([]);
  });

  it("returns none when the sentence appears without a bracketed list", () => {
    // A reworded message must degrade to "no retry" rather than to a wrong
    // retry that silently drops the wrong domains.
    expect(
      inaccessibleDomains("Some domains are not accessible to our user agent."),
    ).toEqual([]);
  });
});
