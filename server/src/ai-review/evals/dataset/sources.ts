import type { ReviewEvalCase } from "./dataset-types";

/**
 * WHERE failures: the question may be crisp and timed, but the named
 * source cannot settle it — it is missing, fabricated, creator-controlled,
 * satirical, ephemeral, or simply will not contain the answer. Includes a
 * control case with a correct source for contrast.
 */
export const SOURCE_CASES: ReviewEvalCase[] = [
  {
    id: "source-none-named",
    taxonomy: "sources/no-source-named",
    expected: "manual_review",
    rationale:
      "Resolvable in principle, but the creator names no WHERE at all.",
    metadata: {
      category: "Politics",
      question:
        "Will voter turnout in the 2026 U.S. midterms exceed 50% of eligible voters?",
      description: "Turnout market.",
      resolutionCriteria:
        "Resolves YES if national turnout among eligible voters exceeds 50%.",
      resolutionSources: [],
    },
  },
  {
    id: "source-fabricated-url",
    taxonomy: "sources/unreachable",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "The only named source is a domain that does not exist — nothing can be verified against it.",
    metadata: {
      category: "Econ",
      question:
        "Will the average U.S. gas price exceed $5/gallon on Labor Day 2026?",
      description: "Gas price threshold on a holiday.",
      resolutionCriteria:
        "Resolves YES if the national average regular gasoline price on September 7, 2026 exceeds $5.00 per gallon, per gaspricewatchtower-official.net.",
      resolutionSources: ["https://gaspricewatchtower-official.net"],
      resolutionUrl: "https://gaspricewatchtower-official.net",
    },
  },
  {
    id: "source-creator-controlled-blog",
    taxonomy: "sources/creator-controlled",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "Source of truth is the creator's own account — the oracle can be edited by the bettor.",
    metadata: {
      category: "Crypto",
      question:
        "Will the SolanaMoonWatch index flash a BUY signal before October 2026?",
      description: "Tracks my proprietary trading signal.",
      resolutionCriteria:
        "Resolves YES if the pinned tweet on @SolanaMoonWatch (my account) announces a BUY signal before October 1, 2026.",
      resolutionSources: ["https://x.com/SolanaMoonWatch"],
    },
  },
  {
    id: "source-satirical",
    taxonomy: "sources/unreliable-tier",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale: "The named settlement source is a satire site.",
    metadata: {
      category: "Politics",
      question: "Will the President be named 'Person of the Year' for 2026?",
      description: "Annual award market.",
      resolutionCriteria:
        "Resolves YES if The Onion reports the President was named Person of the Year 2026.",
      resolutionSources: ["https://www.theonion.com"],
      resolutionUrl: "https://www.theonion.com",
    },
  },
  {
    id: "source-wont-contain-answer",
    taxonomy: "sources/wrong-source",
    expected: "manual_review",
    rationale:
      "Real, reputable source — that will never publish the metric being asked about (WHERE mismatch).",
    metadata: {
      category: "Tech",
      question:
        "Will OpenAI's annual revenue exceed $20 billion in fiscal 2026?",
      description: "Private-company financials.",
      resolutionCriteria:
        "Resolves YES if OpenAI's fiscal-2026 revenue exceeds $20B, per the company's official blog at openai.com/blog. (OpenAI is private and does not publish audited revenue there.)",
      resolutionSources: ["https://openai.com/blog"],
      resolutionUrl: "https://openai.com/blog",
    },
  },
  {
    id: "source-ephemeral-story",
    taxonomy: "sources/ephemeral",
    expected: "manual_review",
    rationale:
      "The read-out is a disappearing artifact (deleted posts / 24h stories) — unverifiable after the fact.",
    metadata: {
      category: "Culture",
      question:
        "Will MrBeast tease a Moon-related video in an Instagram story before 2027?",
      description: "Creator-watch market.",
      resolutionCriteria:
        "Resolves YES if MrBeast posts an Instagram story mentioning a Moon video before January 1, 2027 (stories expire after 24 hours).",
      resolutionSources: ["https://www.instagram.com/mrbeast/"],
    },
  },
  {
    id: "source-control-primary-with-fallback",
    taxonomy: "good/measured-value",
    expected: "approve",
    rationale:
      "Control case: same gas-price idea as source-fabricated-url, done right — official primary source plus fallback and pinned read time.",
    metadata: {
      category: "Econ",
      question:
        "Will the U.S. average regular gasoline price exceed $5.00/gallon on September 7, 2026?",
      description:
        "Uses the EIA weekly retail price series read at the first release on or after the date.",
      resolutionCriteria:
        "Resolves YES if the EIA's U.S. Regular All Formulations Retail Gasoline Price for the week including 2026-09-07 exceeds $5.00/gallon, per the first eia.gov publication of that week's figure; AAA's national average page on 2026-09-07 (ET) is the fallback if EIA has not published within 10 days.",
      resolutionSources: [
        "https://www.eia.gov/petroleum/gasdiesel/",
        "https://gasprices.aaa.com",
      ],
      resolutionUrl: "https://www.eia.gov/petroleum/gasdiesel/",
    },
  },
];
