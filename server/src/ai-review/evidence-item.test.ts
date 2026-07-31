import { describe, expect, it } from "bun:test";

import { evidenceItemFromUrl } from "./evidence-item";

function item(url: string) {
  return evidenceItemFromUrl({
    kind: "fetched_page",
    summary: "Tool result.",
    url,
  });
}

describe("evidenceItemFromUrl", () => {
  it("classifies a public source and strips the fragment", () => {
    expect(item("https://www.federalreserve.gov/x.htm#section")).toEqual({
      domain: "www.federalreserve.gov",
      kind: "fetched_page",
      sourceTier: "primary",
      summary: "Tool result.",
      title: undefined,
      url: "https://www.federalreserve.gov/x.htm",
    });
  });

  it("rejects non-http schemes and unparseable values", () => {
    expect(item("file:///etc/passwd")).toBeNull();
    expect(item("data:text/html,hi")).toBeNull();
    expect(item("not a url")).toBeNull();
    expect(
      evidenceItemFromUrl({ kind: "fetched_page", summary: "x" }),
    ).toBeNull();
  });

  it("rejects internal targets a native web tool could still reach", () => {
    // The CLI providers' WebFetch runs on the review host and has no SSRF
    // gate, so this is the last place a cloud-metadata or intranet response
    // can be kept out of the stored evidence trail.
    expect(item("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(item("http://127.0.0.1:8080/admin")).toBeNull();
    expect(item("http://10.0.0.5/internal")).toBeNull();
    expect(item("http://192.168.1.1/")).toBeNull();
    expect(item("http://[::1]:3000/")).toBeNull();
    expect(item("http://localhost:5433/")).toBeNull();
    expect(item("http://db.internal/")).toBeNull();
  });

  it("keeps public hostnames that merely look like private IPv6 prefixes", () => {
    // isPrivateIpv6 matches the string prefixes "fc" and "fd", so a check that
    // skips the isIP guard silently drops these primary sources.
    expect(item("https://www.fcc.gov/rules")?.domain).toBe("www.fcc.gov");
    expect(item("https://www.fda.gov/recalls")?.domain).toBe("www.fda.gov");
    expect(item("https://fcc.gov/")?.sourceTier).toBe("primary");
  });
});
