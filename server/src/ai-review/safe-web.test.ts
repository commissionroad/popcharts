import { describe, expect, it } from "bun:test";

import {
  isPrivateIpv4,
  isPrivateIpv6,
  parseDuckDuckGoLiteResults,
  resolveSafeUrl,
} from "./safe-web";

describe("safe web helpers", () => {
  it("blocks private IP addresses", () => {
    expect(isPrivateIpv4("127.0.0.1")).toBe(true);
    expect(isPrivateIpv4("10.1.2.3")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv6("::1")).toBe(true);
  });

  it("rejects localhost URLs", async () => {
    await expect(resolveSafeUrl("http://localhost:3000")).rejects.toThrow(
      "Local hostnames",
    );
  });

  it("parses DuckDuckGo Lite result anchors", () => {
    const results = parseDuckDuckGoLiteResults(`
      <a rel="nofollow" href="/l/?uddg=https%3A%2F%2Fwww.reuters.com%2Fworld%2F">Reuters story</a>
      <a rel="nofollow" href="https://example.com/report">Example report</a>
    `);

    expect(results).toEqual([
      {
        title: "Reuters story",
        url: "https://www.reuters.com/world/",
      },
      {
        title: "Example report",
        url: "https://example.com/report",
      },
    ]);
  });
});
