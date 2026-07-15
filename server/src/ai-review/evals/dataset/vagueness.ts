import type { ReviewEvalCase } from "./dataset-types";

/**
 * WHAT failures: the thing being measured is subjective, unquantified,
 * entity-ambiguous, compound, or not binary at all. Distinct from timing
 * (WHEN) and sourcing (WHERE) failures — each case here would still fail
 * with a perfect deadline and a perfect source.
 */
export const VAGUENESS_CASES: ReviewEvalCase[] = [
  {
    id: "vague-unmeasurable-threshold",
    taxonomy: "vagueness/unmeasurable-threshold",
    expected: "manual_review",
    rationale:
      "'Significantly' is not a number; two resolvers disagree by construction.",
    metadata: {
      category: "Econ",
      question:
        "Will U.S. housing prices drop significantly before the end of 2026?",
      description: "Housing market direction.",
      resolutionCriteria:
        "Resolves YES if housing prices fall significantly by December 31, 2026, per the Case-Shiller index.",
      resolutionSources: [
        "https://www.spglobal.com/spdji/en/index-family/indicators/sp-corelogic-case-shiller/",
      ],
    },
  },
  {
    id: "vague-subjective-best",
    taxonomy: "vagueness/subjective",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "'Best' is an opinion with no named arbiter — unresolvable however well-sourced.",
    metadata: {
      category: "Culture",
      question: "Will Dune: Part Three be the best movie of 2027?",
      description: "Film quality bet.",
      resolutionCriteria:
        "Resolves YES if Dune: Part Three is the best movie released in 2027.",
      resolutionSources: ["https://www.imdb.com"],
    },
  },
  {
    id: "vague-subjective-with-arbiter-fix",
    taxonomy: "vagueness/subjective",
    expected: "approve",
    acceptable: ["manual_review"],
    rationale:
      "Control case: the same 'best movie' idea becomes resolvable when delegated to a named arbiter, metric, and timestamp.",
    metadata: {
      category: "Culture",
      question:
        "Will Dune: Part Three hold the highest 2027-release Metascore on Metacritic on January 15, 2028?",
      description:
        "Uses Metacritic's aggregate as the arbiter of 'best', read on a fixed date.",
      resolutionCriteria:
        "Resolves YES if, as of 23:59 ET on 2028-01-15, Dune: Part Three has the highest Metascore among films with a 2027 U.S. release date and at least 25 critic reviews, per metacritic.com (archive.org capture that day is the fallback read-out).",
      resolutionSources: [
        "https://www.metacritic.com",
        "https://web.archive.org",
      ],
      resolutionUrl: "https://www.metacritic.com",
    },
  },
  {
    id: "vague-entity-ambiguous",
    taxonomy: "vagueness/undefined-entity",
    expected: "manual_review",
    rationale:
      "'United' names at least three famous clubs; WHO is undefined even though the metric is crisp.",
    metadata: {
      category: "Sports",
      question: "Will United finish in the top four this season?",
      description: "League position market.",
      resolutionCriteria:
        "Resolves YES if United finish the season in the top four of the league table per the official league site.",
      resolutionSources: ["https://www.premierleague.com"],
    },
  },
  {
    id: "vague-compound-conditions",
    taxonomy: "vagueness/compound",
    expected: "manual_review",
    rationale:
      "Two independent outcomes fused with an unclear conjunction — partial outcomes are undefined.",
    metadata: {
      category: "Crypto",
      question:
        "Will Bitcoin hit $200k and Ethereum hit $20k before July 2027?",
      description: "Double moonshot.",
      resolutionCriteria:
        "Resolves YES if Bitcoin reaches $200,000 and Ethereum reaches $20,000 before July 2027 per CoinGecko; unclear what happens if only one hits.",
      resolutionSources: ["https://www.coingecko.com"],
    },
  },
  {
    id: "vague-non-binary-count",
    taxonomy: "vagueness/non-binary",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "Asks for a number, not a yes/no — cannot map onto a binary market.",
    metadata: {
      category: "Tech",
      question: "How many Cybertrucks will Tesla deliver in 2026?",
      description: "Delivery count market.",
      resolutionCriteria:
        "Resolves to the number of Cybertruck deliveries Tesla reports for 2026 in its quarterly delivery press releases.",
      resolutionSources: ["https://ir.tesla.com"],
      resolutionUrl: "https://ir.tesla.com",
    },
  },
  {
    id: "vague-undefined-outcome-word",
    taxonomy: "vagueness/unmeasurable-threshold",
    expected: "manual_review",
    rationale:
      "'Successful' is undefined for a rocket program — partial success taxonomies differ by observer.",
    metadata: {
      category: "Tech",
      question: "Will SpaceX's Starship program be successful in 2026?",
      description: "General program sentiment.",
      resolutionCriteria:
        "Resolves YES if Starship is successful in 2026, judging from SpaceX announcements and news coverage.",
      resolutionSources: ["https://www.spacex.com", "https://apnews.com"],
    },
  },
];
