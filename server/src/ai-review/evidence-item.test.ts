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

  it("rejects internal IPv6 targets through the bracketed URL form", () => {
    // A URL keeps its IPv6 host in brackets and canonicalizes the address, so
    // what reaches the range check is "[::ffff:7f00:1]" rather than anything a
    // person would have typed. Stripping the brackets is what makes it an
    // address again; safe-web.test.ts covers the ranges themselves.
    expect(new URL("http://[::ffff:127.0.0.1]/").hostname).toBe(
      "[::ffff:7f00:1]",
    );
    expect(item("http://[::ffff:127.0.0.1]/")).toBeNull();
    expect(item("http://[::ffff:7f00:1]/")).toBeNull();
    expect(item("http://[::ffff:192.168.1.1]/")).toBeNull();
    expect(item("http://[::ffff:a00:1]/")).toBeNull();
    // fe80::/10 spans fe80 through febf, not just the fe80: prefix.
    expect(item("http://[fe90::1]/")).toBeNull();
    expect(item("http://[feb0::1]/")).toBeNull();
    expect(item("http://[fd00::1]/")).toBeNull();
    expect(item("http://[::]/")).toBeNull();
  });

  it("keeps public IPv6 literals outside the reserved ranges", () => {
    expect(item("http://[2606:4700:4700::1111]/")?.domain).toBe(
      "[2606:4700:4700::1111]",
    );
    // fec0::/10 is deprecated site-local, outside fe80::/10 and fc00::/7.
    expect(item("http://[fec0::1]/")).not.toBeNull();
  });

  it("keeps public hostnames that open with reserved-range hex", () => {
    // fc00::/7 and fe80::/10 are matched on the address's leading bytes, so a
    // range check reached without first confirming the value is an address
    // would drop these primary sources on their spelling alone.
    expect(item("https://www.fcc.gov/rules")?.domain).toBe("www.fcc.gov");
    expect(item("https://www.fda.gov/recalls")?.domain).toBe("www.fda.gov");
    expect(item("https://fcc.gov/")?.sourceTier).toBe("primary");
  });
});
