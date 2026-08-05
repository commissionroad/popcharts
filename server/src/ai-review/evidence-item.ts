import { isUnsafeIpAddress } from "./safe-web";
import { sourceTierForDomain } from "./scoring";
import type { EvidenceItem } from "./types";

/**
 * Turning one provider-reported URL into an evidence item. Shared by every
 * provider that reads its model's native tool records — Anthropic's content
 * blocks and the Claude Code CLI's stream transcript — because they differ
 * only in where the URL is read from, not in how it becomes evidence.
 */

/**
 * Builds an evidence item from a URL a provider's own tool records reported,
 * classifying the domain's trust tier. Returns null for anything that is not
 * a public http(s) URL, so a malformed, non-web, or internal-network
 * reference never reaches the evidence trail — and therefore never
 * corroborates a sourceCheck.
 */
export function evidenceItemFromUrl({
  kind,
  summary,
  title,
  url,
}: {
  kind: EvidenceItem["kind"];
  summary: string;
  title?: string;
  url?: string;
}): EvidenceItem | null {
  const parsed = parseHttpUrl(url);
  if (!parsed || isInternalHostname(parsed.hostname)) {
    return null;
  }

  const domain = parsed.hostname.toLowerCase();
  return {
    domain,
    kind,
    sourceTier: sourceTierForDomain(domain),
    summary,
    title,
    url: parsed.toString(),
  } satisfies EvidenceItem;
}

/**
 * Hostnames whose fetched content must never be recorded as evidence.
 *
 * The pre-collected-evidence path fetches through `resolveSafeUrl`, so a
 * private target is rejected before anything is stored. A model's native web
 * tools bypass that gate entirely — the CLI's WebFetch will happily retrieve
 * `http://169.254.169.254/…` from the review host — so this is the last place
 * a cloud-metadata or intranet response can be kept out of the stored trail
 * and out of the review UI.
 *
 * This is a literal-address check, not the full SSRF gate: it needs no DNS
 * lookup and so cannot catch a public hostname that resolves to a private
 * address. Restricting what the CLI is allowed to fetch in the first place is
 * the fix for that, and it belongs at the argv layer, not here.
 */
function isInternalHostname(hostname: string) {
  // A URL's IPv6 host keeps its brackets ("[::1]"), which isIP rejects.
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".local") ||
    isUnsafeIpAddress(normalized)
  );
}

/** The lowercased hostname of an http(s) URL, or undefined for anything else. */
export function domainFromUrl(value?: string) {
  return parseHttpUrl(value)?.hostname.toLowerCase();
}

/**
 * Parses a URL and accepts only http(s), with the fragment stripped so the
 * same page reached via different anchors dedupes to one evidence item.
 */
export function parseHttpUrl(value?: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
