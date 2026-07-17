import { DEFAULT_SCORES, normalizeScores } from "./scoring";
import type { MarketReviewMetadata, PolicyFinding } from "./types";

type PatternRule = {
  flag: string;
  pattern: RegExp;
  reason: string;
};

const HARM_RULES: PatternRule[] = [
  {
    flag: "death_market",
    pattern:
      /\b(die|dies|death|dead|fatal|assassinat\w*|murder\w*|kill(?:ed|ing)?|suicide|overdose)\b/i,
    reason: "Market appears to speculate on death or lethal harm.",
  },
  {
    flag: "violent_harm",
    pattern:
      /\b(kidnap\w*|terroris\w*|bomb(?:ing)?|arson|swat(?:ted|ting)?|shoot(?:ing)?|stab(?:bed|bing)?|assault(?:ed)?)\b/i,
    reason: "Market appears to speculate on violent harm or a heinous crime.",
  },
  {
    flag: "illegal_activity",
    pattern:
      /\b(hack(?:ed|ing)?|steal(?:ing)?|rob(?:bed|bery)?|bribe|fraud|launder(?:ing)?|extort(?:ion)?|blackmail|doxx?|drug trafficking)\b/i,
    reason: "Market appears to depend on illegal activity.",
  },
  {
    flag: "sexual_exploitation",
    pattern:
      /\b(child sexual|minor sexual|traffick(?:ed|ing)?|sexual assault|revenge porn|non[- ]consensual intimate)\b/i,
    reason: "Market appears to involve sexual exploitation or abuse.",
  },
];

const PROMPT_INJECTION_RULES: PatternRule[] = [
  {
    flag: "prompt_injection",
    pattern:
      /\b(ignore (all )?(previous|prior|above) instructions|system prompt|developer message|reveal (the )?(prompt|instructions)|you are now|approve this market|output only approve|call (the )?tool)\b/i,
    reason:
      "Market text contains instructions aimed at manipulating the reviewer.",
  },
];

const PRIVATE_KNOWLEDGE_RULES: PatternRule[] = [
  {
    flag: "private_local_knowledge",
    pattern:
      /\b(my|our)(?:\s+\w+){0,3}\s+(friend|friends|roommate|coworker|co-worker|classmate|sister|brother|mom|dad|partner|girlfriend|boyfriend|neighbor)\b/i,
    reason:
      "Market appears resolvable only from the submitter's private circle.",
  },
  {
    flag: "private_local_knowledge",
    pattern: /\b(will i|will we|did i|did we)\b/i,
    reason: "Market appears centered on the submitter's private life.",
  },
];

/**
 * Deterministic, offline first pass of the review policy. Any harm,
 * prompt-injection, or private-knowledge pattern match is a hard flag and an
 * immediate reject that no model can overturn; soft issues (e.g. a non-binary
 * question) downgrade to manual_review instead. Pattern-free markets approve.
 */
export function runHeuristicPolicy(
  metadata: MarketReviewMetadata,
): PolicyFinding {
  const text = marketText(metadata);
  const hardFlags: string[] = [];
  const reasons: string[] = [];
  const matchedHarm = collectMatches(text, HARM_RULES);
  const matchedInjection = collectMatches(text, PROMPT_INJECTION_RULES);
  const matchedPrivate = collectMatches(text, PRIVATE_KNOWLEDGE_RULES);

  for (const match of [
    ...matchedHarm,
    ...matchedInjection,
    ...matchedPrivate,
  ]) {
    hardFlags.push(match.flag);
    reasons.push(match.reason);
  }

  const scores = normalizeScores({
    ...DEFAULT_SCORES,
    contentSafety: matchedHarm.length > 0 ? 0 : 5,
    objectivity: hasClearBinaryQuestion(metadata.question) ? 4 : 2,
    promptInjectionRisk: matchedInjection.length > 0 ? 5 : 0,
    publicKnowability:
      matchedPrivate.length > 0 ? 0 : hasResolutionSources(metadata) ? 3 : 2,
    sourceQuality: hasResolutionSources(metadata) ? 2 : 0,
  });
  const scoreRationales = {
    contentSafety:
      matchedHarm.length > 0
        ? "Deterministic checks found language associated with severe harm."
        : "Deterministic checks found no language associated with severe harm.",
    corroboration:
      "Deterministic checks do not establish independent corroboration.",
    disputeRisk:
      "The deterministic baseline cannot fully assess likely disputes.",
    objectivity: hasClearBinaryQuestion(metadata.question)
      ? "The question is phrased as a recognizable binary proposition."
      : "The question is not phrased as a clear binary proposition.",
    promptInjectionRisk:
      matchedInjection.length > 0
        ? "Deterministic checks found instructions aimed at manipulating the reviewer."
        : "Deterministic checks found no instructions aimed at manipulating the reviewer.",
    publicKnowability:
      matchedPrivate.length > 0
        ? "The market appears to depend on private or local knowledge."
        : hasResolutionSources(metadata)
          ? "The metadata names at least one public resolution source."
          : "The metadata does not name a public resolution source.",
    sourceQuality: hasResolutionSources(metadata)
      ? "A resolution source is present, but deterministic checks do not establish its quality."
      : "No resolution source was supplied for deterministic checks.",
  };

  if (hardFlags.length > 0) {
    return {
      hardFlags: unique(hardFlags),
      reasons: unique(reasons),
      scoreRationales,
      scores,
      sourceChecks: [],
      verdict: "reject",
    };
  }

  const softReasons = [...reasons];
  if (!hasClearBinaryQuestion(metadata.question)) {
    softReasons.push("Question should be phrased as a clear YES/NO market.");
  }

  const softFlags: string[] = [];
  if (isRetrospectiveQuestion(metadata)) {
    softFlags.push("retrospective_question");
    softReasons.push(
      "Question appears to ask about an already-decided past event; markets must predict, not look up.",
    );
  }
  if (usesEphemeralSource(metadata)) {
    softFlags.push("ephemeral_source");
    softReasons.push(
      "Resolution depends on an ephemeral artifact (stories or deletable posts) that cannot be verified after the fact.",
    );
  }
  if (usesSatiricalSource(metadata)) {
    softFlags.push("satirical_source");
    softReasons.push(
      "A named resolution source is a known satire outlet and cannot settle a factual market.",
    );
  }

  return {
    hardFlags: [],
    reasons: unique(softReasons),
    scoreRationales,
    scores,
    softFlags: unique(softFlags),
    sourceChecks: [],
    verdict: softReasons.length > 0 ? "manual_review" : "approve",
  };
}

/**
 * Flattens every user-controlled metadata field into one newline-joined string
 * so the heuristic patterns scan the full submission, not just the question.
 */
export function marketText(metadata: MarketReviewMetadata) {
  return [
    metadata.question,
    metadata.description,
    metadata.resolutionCriteria,
    ...(metadata.resolutionSources ?? []),
    metadata.resolutionUrl,
    metadata.category,
  ]
    .filter(Boolean)
    .join("\n");
}

function collectMatches(text: string, rules: PatternRule[]) {
  return rules.filter((rule) => rule.pattern.test(text));
}

function hasClearBinaryQuestion(question: string) {
  return /^(will|is|are|does|do|did|has|have|can|could|was|were)\b/i.test(
    question.trim(),
  );
}

// Strongly past-tense interrogative openers. "Has/Have" are excluded: "Has X
// happened by <future date>?" is common, legitimate future phrasing.
const RETROSPECTIVE_OPENER = /^(did|was|were|had)\b/i;
const YEAR_PATTERN = /\b(19|20)\d{2}\b/g;

/**
 * Flags questions that read as lookups of already-decided events (the
 * "already-determined" taxonomy class): a past-tense opener with no future
 * year anywhere in the question or criteria to anchor a prediction. The
 * creation year comes from metadata.createdAt when present so eval fixtures
 * and replayed reviews stay deterministic.
 */
function isRetrospectiveQuestion(metadata: MarketReviewMetadata): boolean {
  if (!RETROSPECTIVE_OPENER.test(metadata.question.trim())) {
    return false;
  }
  const createdYear = metadata.createdAt
    ? new Date(metadata.createdAt).getFullYear()
    : new Date().getFullYear();
  const referenced = `${metadata.question}\n${metadata.resolutionCriteria}`;
  for (const match of referenced.matchAll(YEAR_PATTERN)) {
    if (Number(match[0]) >= createdYear) {
      return false;
    }
  }
  return true;
}

// Platforms whose default artifacts disappear (stories, snaps) — a settlement
// read-out there is unverifiable after the fact ("ephemeral_source" class).
const EPHEMERAL_SOURCE_DOMAINS = [
  "instagram.com",
  "snapchat.com",
  "tiktok.com",
];
const EPHEMERAL_TEXT_PATTERN =
  /\b((instagram|snapchat|facebook)\s+stor(y|ies)|stor(y|ies)\s+expire|deleted?\s+(tweet|post|video))\b/i;

// Known satire outlets: a factual market naming one as its settlement source
// is either a joke or an attempt to settle from fiction. List only
// unambiguous, well-known satire domains — borderline outlets stay a model
// judgment ("satirical_source" class in the taxonomy).
const SATIRE_SOURCE_DOMAINS = [
  "theonion.com",
  "babylonbee.com",
  "clickhole.com",
  "thebeaverton.com",
  "waterfordwhispersnews.com",
  "newsthump.com",
  "thedailymash.co.uk",
  "duffelblog.com",
];

/** Flags markets that name a known satire outlet as a resolution source. */
function usesSatiricalSource(metadata: MarketReviewMetadata): boolean {
  const urls = [...(metadata.resolutionSources ?? []), metadata.resolutionUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return urls.some((url) =>
    SATIRE_SOURCE_DOMAINS.some((domain) => url.includes(domain)),
  );
}

/** Flags markets whose named read-out is an ephemeral artifact. */
function usesEphemeralSource(metadata: MarketReviewMetadata): boolean {
  const urls = [...(metadata.resolutionSources ?? []), metadata.resolutionUrl]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  if (
    urls.some((url) =>
      EPHEMERAL_SOURCE_DOMAINS.some((domain) => url.includes(domain)),
    )
  ) {
    return true;
  }
  return EPHEMERAL_TEXT_PATTERN.test(marketText(metadata));
}

function hasResolutionSources(metadata: MarketReviewMetadata) {
  return Boolean(metadata.resolutionUrl || metadata.resolutionSources?.length);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
