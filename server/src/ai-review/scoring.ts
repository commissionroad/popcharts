import type { ReviewScores, SourceTier } from "./types";

const PRIMARY_HOST_HINTS = [
  ".gov",
  ".mil",
  ".edu",
  "sec.gov",
  "federalreserve.gov",
  "courtlistener.com",
  "congress.gov",
  "who.int",
  "un.org",
  "nasa.gov",
];

const MAJOR_NEWS_HOSTS = [
  "apnews.com",
  "bbc.com",
  "bloomberg.com",
  "cnbc.com",
  "cnn.com",
  "ft.com",
  "nytimes.com",
  "reuters.com",
  "theguardian.com",
  "wsj.com",
  "washingtonpost.com",
];

const UGC_HOSTS = [
  "facebook.com",
  "instagram.com",
  "medium.com",
  "reddit.com",
  "substack.com",
  "tiktok.com",
  "x.com",
  "youtube.com",
];

const SUSPICIOUS_HOSTS = [
  "bit.ly",
  "pastebin.com",
  "t.co",
  "telegram.me",
  "theonion.com",
  "tinyurl.com",
];

export const DEFAULT_SCORES: ReviewScores = {
  contentSafety: 5,
  corroboration: 0,
  disputeRisk: 3,
  objectivity: 3,
  promptInjectionRisk: 0,
  publicKnowability: 2,
  sourceQuality: 0,
};

export function clampScore(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(5, Math.round(value)));
}

export function normalizeScores(
  value: Partial<Record<keyof ReviewScores, unknown>>,
): ReviewScores {
  return {
    contentSafety: clampScore(value.contentSafety, DEFAULT_SCORES.contentSafety),
    corroboration: clampScore(value.corroboration, DEFAULT_SCORES.corroboration),
    disputeRisk: clampScore(value.disputeRisk, DEFAULT_SCORES.disputeRisk),
    objectivity: clampScore(value.objectivity, DEFAULT_SCORES.objectivity),
    promptInjectionRisk: clampScore(
      value.promptInjectionRisk,
      DEFAULT_SCORES.promptInjectionRisk,
    ),
    publicKnowability: clampScore(
      value.publicKnowability,
      DEFAULT_SCORES.publicKnowability,
    ),
    sourceQuality: clampScore(value.sourceQuality, DEFAULT_SCORES.sourceQuality),
  };
}

export function sourceTierForDomain(domain: string): SourceTier {
  const normalized = domain.toLowerCase();

  if (PRIMARY_HOST_HINTS.some((hint) => normalized.endsWith(hint))) {
    return "primary";
  }

  if (MAJOR_NEWS_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`))) {
    return "major_news";
  }

  if (UGC_HOSTS.some((host) => normalized === host || normalized.endsWith(`.${host}`))) {
    return "ugc";
  }

  if (
    SUSPICIOUS_HOSTS.some(
      (host) => normalized === host || normalized.endsWith(`.${host}`),
    )
  ) {
    return "suspicious";
  }

  return "unknown";
}
