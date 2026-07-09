import { describe, expect, it } from "bun:test";

import { getAiResolutionRunnerConfig } from "./config";

describe("getAiResolutionRunnerConfig", () => {
  it("uses defaults with an empty env", () => {
    const config = getAiResolutionRunnerConfig({});

    expect(config.serviceUrl).toBe("http://127.0.0.1:3004");
    expect(config.pollMs).toBe(5_000);
    expect(config.leaseMs).toBe(60_000);
    expect(config.maxAttempts).toBe(5);
    expect(config.runnerId).toContain("ai-resolution-runner-");
  });

  it("reads overrides and normalizes the service url", () => {
    const config = getAiResolutionRunnerConfig({
      AI_RESOLUTION_RUNNER_ID: "runner-a",
      AI_RESOLUTION_RUNNER_POLL_MS: "1000",
      AI_RESOLUTION_SERVICE_URL: "http://svc:9000/",
    });

    expect(config.pollMs).toBe(1_000);
    expect(config.runnerId).toBe("runner-a");
    expect(config.serviceUrl).toBe("http://svc:9000");
  });

  it("rejects a non-positive integer knob", () => {
    expect(() =>
      getAiResolutionRunnerConfig({ AI_RESOLUTION_RUNNER_LEASE_MS: "0" }),
    ).toThrow("must be a positive integer");
  });
});
