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

  if (hardFlags.length > 0) {
    return {
      hardFlags: unique(hardFlags),
      reasons: unique(reasons),
      scores,
      sourceChecks: [],
      verdict: "reject",
    };
  }

  const softReasons = [...reasons];
  if (!hasClearBinaryQuestion(metadata.question)) {
    softReasons.push("Question should be phrased as a clear YES/NO market.");
  }

  return {
    hardFlags: [],
    reasons: unique(softReasons),
    scores,
    sourceChecks: [],
    verdict: softReasons.length > 0 ? "manual_review" : "approve",
  };
}

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

function hasResolutionSources(metadata: MarketReviewMetadata) {
  return Boolean(metadata.resolutionUrl || metadata.resolutionSources?.length);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
