import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { AiReviewConfig } from "./config";
import { sourceTierForDomain } from "./scoring";
import type { EvidenceItem } from "./types";

const SEARCH_URL = "https://lite.duckduckgo.com/lite/";
const TEXT_CONTENT_TYPES = [
  "application/json",
  "application/xhtml+xml",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/xml",
];

type SearchResult = {
  title: string;
  url: string;
};

export async function safeFetchEvidence(
  value: string,
  config: Pick<
    AiReviewConfig,
    "maxFetchBytes" | "requestTimeoutMs" | "userAgent"
  >,
  kind: EvidenceItem["kind"] = "fetched_page",
): Promise<EvidenceItem> {
  let finalUrl = await resolveSafeUrl(value);
  let response = await fetchWithTimeout(finalUrl, config);

  for (let redirectDepth = 0; isRedirect(response); redirectDepth += 1) {
    if (redirectDepth >= 3) {
      throw new Error("Too many redirects while fetching review evidence.");
    }

    const location = response.headers.get("location");
    if (!location) {
      break;
    }

    finalUrl = await resolveSafeUrl(new URL(location, finalUrl).toString());
    response = await fetchWithTimeout(finalUrl, config);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    return unreachableEvidence(
      finalUrl,
      kind,
      `HTTP ${response.status} while fetching URL.`,
    );
  }

  if (!isAllowedContentType(contentType)) {
    return unreachableEvidence(
      finalUrl,
      kind,
      `Unsupported content type: ${contentType || "unknown"}.`,
    );
  }

  const text = trimToMaxBytes(await response.text(), config.maxFetchBytes);
  const title = extractTitle(text);
  const summary = summarizeFetchedText(text);
  const domain = finalUrl.hostname.toLowerCase();

  return {
    domain,
    kind,
    sourceTier: sourceTierForDomain(domain),
    summary,
    title,
    url: finalUrl.toString(),
  };
}

export async function searchWebEvidence({
  config,
  fetchResults,
  maxResults,
  query,
}: {
  config: Pick<
    AiReviewConfig,
    "maxFetchBytes" | "requestTimeoutMs" | "userAgent"
  >;
  fetchResults: boolean;
  maxResults: number;
  query: string;
}): Promise<EvidenceItem[]> {
  const results = await searchDuckDuckGoLite(query, config);
  const limited = results.slice(0, maxResults);

  if (!fetchResults) {
    return limited.map((result) => {
      const url = new URL(result.url);
      const domain = url.hostname.toLowerCase();

      return {
        domain,
        kind: "search_result",
        sourceTier: sourceTierForDomain(domain),
        summary: `Search result for "${query}".`,
        title: result.title,
        url: result.url,
      };
    });
  }

  const evidence: EvidenceItem[] = [];
  for (const result of limited) {
    try {
      evidence.push(await safeFetchEvidence(result.url, config));
    } catch (error) {
      evidence.push(
        unreachableEvidenceFromString(
          result.url,
          `Could not fetch search result: ${errorMessage(error)}.`,
        ),
      );
    }
  }

  return evidence;
}

export async function resolveSafeUrl(value: string) {
  const url = normalizeHttpUrl(value);
  await assertPublicHostname(url.hostname);

  if (url.username || url.password) {
    throw new Error("URLs with credentials are not allowed.");
  }

  return url;
}

export function buildSearchQueries({
  question,
  resolutionCriteria,
  resolutionSources = [],
}: {
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
}) {
  const baseQuery = [question, resolutionCriteria, ...resolutionSources]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return [truncateQuery(baseQuery)];
}

export async function searchDuckDuckGoLite(
  query: string,
  config: Pick<AiReviewConfig, "requestTimeoutMs" | "userAgent">,
): Promise<SearchResult[]> {
  const searchUrl = new URL(SEARCH_URL);
  searchUrl.searchParams.set("q", query);

  const response = await fetchWithTimeout(searchUrl, config);
  if (!response.ok) {
    throw new Error(`Search failed with HTTP ${response.status}.`);
  }

  return parseDuckDuckGoLiteResults(await response.text());
}

export function parseDuckDuckGoLiteResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const anchors = html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi);

  for (const anchor of anchors) {
    const attrs = anchor[1] ?? "";
    const rawHref = extractAttribute(attrs, "href");
    const rawTitle = anchor[2] ?? "";
    if (!rawHref) {
      continue;
    }

    const url = normalizeSearchResultUrl(decodeHtml(rawHref));
    const title = normalizeWhitespace(stripHtml(decodeHtml(rawTitle)));

    if (!url || !title || title.toLowerCase() === "next page") {
      continue;
    }

    results.push({ title, url });
  }

  return dedupeResults(results).slice(0, 10);
}

export function isPrivateIpv4(value: string) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPrivateIpv6(value: string) {
  const normalized = value.toLowerCase();

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:172.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function assertPublicHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    throw new Error("Local hostnames are not allowed.");
  }

  if (isUnsafeIpAddress(normalized)) {
    throw new Error("Private or local IP addresses are not allowed.");
  }

  if (isIP(normalized) !== 0) {
    return;
  }

  const addresses = await lookup(normalized, { all: true });
  if (addresses.length === 0) {
    throw new Error("Hostname did not resolve.");
  }

  for (const address of addresses) {
    if (isUnsafeIpAddress(address.address)) {
      throw new Error("Hostname resolves to a private or local address.");
    }
  }
}

async function fetchWithTimeout(
  url: URL,
  config: Pick<AiReviewConfig, "requestTimeoutMs" | "userAgent">,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    return await fetch(url, {
      headers: {
        accept: "text/html, text/plain, application/json;q=0.9, */*;q=0.1",
        "user-agent": config.userAgent,
      },
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHttpUrl(value: string) {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  url.hash = "";
  return url;
}

function isAllowedContentType(value: string) {
  const normalized = value.split(";")[0]?.trim().toLowerCase() ?? "";

  return TEXT_CONTENT_TYPES.includes(normalized);
}

function isRedirect(response: Response) {
  return response.status >= 300 && response.status < 400;
}

function summarizeFetchedText(value: string) {
  const withoutHtml = stripHtml(value);
  const decoded = decodeHtml(withoutHtml);

  return normalizeWhitespace(stripHtml(decoded)).slice(0, 4_000);
}

function trimToMaxBytes(value: string, maxBytes: number) {
  return Buffer.from(value).subarray(0, maxBytes).toString("utf8");
}

function extractTitle(value: string) {
  const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? normalizeWhitespace(stripHtml(title)) : undefined;
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function extractAttribute(attrs: string, name: string) {
  return attrs.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function normalizeSearchResultUrl(value: string) {
  try {
    const url = new URL(value, SEARCH_URL);
    const redirected = url.searchParams.get("uddg");
    const candidate = redirected ? decodeURIComponent(redirected) : url.href;
    const parsed = new URL(candidate);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    if (parsed.hostname.endsWith("duckduckgo.com")) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function dedupeResults(results: SearchResult[]) {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    if (seen.has(result.url)) {
      continue;
    }

    seen.add(result.url);
    deduped.push(result);
  }

  return deduped;
}

function truncateQuery(value: string) {
  return value.length <= 240 ? value : value.slice(0, 240);
}

function isUnsafeIpAddress(value: string) {
  const ipVersion = isIP(value);

  if (ipVersion === 4) {
    return isPrivateIpv4(value);
  }

  if (ipVersion === 6) {
    return isPrivateIpv6(value);
  }

  return false;
}

function unreachableEvidence(
  url: URL,
  kind: EvidenceItem["kind"],
  summary: string,
): EvidenceItem {
  return {
    domain: url.hostname.toLowerCase(),
    kind,
    sourceTier: "unreachable",
    summary,
    url: url.toString(),
  };
}

function unreachableEvidenceFromString(urlValue: string, summary: string) {
  try {
    const url = new URL(urlValue);
    return unreachableEvidence(url, "fetched_page", summary);
  } catch {
    return {
      domain: "invalid-url",
      kind: "fetched_page",
      sourceTier: "unreachable",
      summary,
      url: urlValue,
    } satisfies EvidenceItem;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}
