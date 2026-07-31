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

  it("blocks every spelling of a reserved IPv6 range", () => {
    // Each of these reaches the gate as a hostname `new URL()` produced, so
    // the predicate has to recognize the canonical form, not just the one a
    // person would type.
    expect(isPrivateIpv6("::")).toBe(true);
    expect(isPrivateIpv6("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIpv6("::ffff:7f00:1")).toBe(true); // same address, canonical
    expect(isPrivateIpv6("::ffff:c0a8:101")).toBe(true); // 192.168.1.1
    expect(isPrivateIpv6("fd00::1")).toBe(true); // fc00::/7
    expect(isPrivateIpv6("fe80::1")).toBe(true);
    expect(isPrivateIpv6("fe90::1")).toBe(true); // still fe80::/10
    expect(isPrivateIpv6("febf::1")).toBe(true); // top of fe80::/10
  });

  it("allows public IPv6 addresses and non-addresses", () => {
    expect(isPrivateIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateIpv6("fec0::1")).toBe(false); // outside fe80::/10
    // Hostnames are not addresses; the isIP guard is what keeps the range
    // checks from matching "fcc.gov" and "fda.gov" on their leading bytes.
    expect(isPrivateIpv6("fcc.gov")).toBe(false);
    expect(isPrivateIpv6("fda.gov")).toBe(false);
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
