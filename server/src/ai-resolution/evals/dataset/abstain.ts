import type { ResolutionEvalCase } from "./dataset-types";

/**
 * Abstain cases: markets whose outcome cannot be verified from any public
 * source — a vague predicate with no arbiter, a dead/fabricated source,
 * private-circle knowledge, an unfalsifiable secret, an ephemeral read-out,
 * or an unidentifiable entity. Guessing YES/NO here is exactly the failure
 * being measured; the calibrated resolver parks these for a human.
 *
 * These would ideally have been caught by review, but resolution must handle
 * them anyway: review approves imperfectly, and criteria can rot between
 * approval and resolution (sources die, accounts get deleted).
 */
export const ABSTAIN_CASES: ResolutionEvalCase[] = [
  {
    id: "abstain-vague-good-year-ai",
    taxonomy: "vagueness/unmeasurable-threshold",
    expected: "abstain",
    rationale:
      "No metric, threshold, or arbiter — 'generally a good year' is not publicly decidable in either direction.",
    metadata: {
      category: "Tech",
      question: "Was 2025 a good year for AI startups?",
      description: "Overall vibe check on the AI startup ecosystem.",
      resolutionCriteria:
        "Resolves YES if 2025 was generally a good year for AI startups, considering funding, product launches, and overall momentum; otherwise NO.",
      resolutionSources: [],
      observationWindowStart: "2025-01-01T00:00:00Z",
      observationWindowEnd: "2025-12-31T23:59:59Z",
    },
  },
  {
    id: "abstain-dead-source-only",
    taxonomy: "sources/unreachable",
    expected: "abstain",
    rationale:
      "The sole authorized settlement source is a fabricated domain that does not exist; the criteria forbid any substitute.",
    metadata: {
      category: "Econ",
      question:
        "Did the Global Trade Confidence Index close 2024 above 62 points?",
      description:
        "Settles exclusively from the named index publisher's site; no other source may be used.",
      resolutionCriteria:
        "Resolves YES if the Global Trade Confidence Index published at https://www.globaltradeconfidenceindex-official.com shows a December 2024 closing value strictly above 62.0. This is the only authorized source; if it does not publish, no substitute source may be consulted.",
      resolutionSources: [
        "https://www.globaltradeconfidenceindex-official.com",
      ],
      resolutionUrl: "https://www.globaltradeconfidenceindex-official.com",
      observationWindowStart: "2024-12-01T00:00:00Z",
      observationWindowEnd: "2025-01-15T23:59:59Z",
    },
  },
  {
    id: "abstain-private-promotion",
    taxonomy: "knowability/private-local",
    expected: "abstain",
    rationale:
      "A private individual's job change is not documented by any public source a resolver can check.",
    metadata: {
      category: "Other",
      question:
        "Did the market creator's brother get promoted to team lead before January 1, 2025?",
      description:
        "The creator will confirm the promotion once it is announced internally at the company.",
      resolutionCriteria:
        "Resolves YES if the creator's brother was promoted to a team lead position at his employer before 2025-01-01, as confirmed by the creator; otherwise NO.",
      resolutionSources: [],
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "abstain-secret-training-run",
    taxonomy: "knowability/never-verifiable",
    expected: "abstain",
    rationale:
      "A secret, by definition, has no public evidence either way; neither YES nor NO is verifiable.",
    metadata: {
      category: "Tech",
      question:
        "Was OpenAI secretly training a model on classified government data during 2024?",
      description:
        "Concerns non-public activity that no official source would ever confirm.",
      resolutionCriteria:
        "Resolves YES if OpenAI conducted a training run using classified U.S. government data at any point in 2024, whether or not this was ever publicly disclosed; otherwise NO.",
      resolutionSources: ["https://openai.com/news/"],
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "abstain-deleted-story-readout",
    taxonomy: "sources/ephemeral",
    expected: "abstain",
    rationale:
      "The read-out was a 24-hour Instagram story with no archive requirement — unverifiable after the fact.",
    metadata: {
      category: "Culture",
      question:
        "Did the influencer @wanderlust.dailyx post an Instagram story from Tokyo on December 25, 2024?",
      description:
        "Settles from the account's Instagram stories, which expire after 24 hours.",
      resolutionCriteria:
        "Resolves YES if the Instagram account @wanderlust.dailyx posted at least one story geotagged or visibly located in Tokyo on 2024-12-25 (JST). Stories are the only accepted evidence; screenshots from third parties do not count.",
      resolutionSources: ["https://www.instagram.com"],
      observationWindowStart: "2024-12-25T00:00:00Z",
      observationWindowEnd: "2024-12-26T23:59:59Z",
    },
  },
  {
    id: "abstain-undefined-entity-united",
    taxonomy: "vagueness/undefined-entity",
    expected: "abstain",
    rationale:
      "'United' is not identified (Manchester? Newcastle? D.C.? Airlines?) and no fixture, league, or source pins it — there is no specific event to look up.",
    metadata: {
      category: "Sports",
      question: "Did United win their match on March 5, 2025?",
      description: "Standard match-winner market.",
      resolutionCriteria:
        "Resolves YES if United won their match played on March 5, 2025; resolves NO if they lost or drew.",
      resolutionSources: [],
      observationWindowStart: "2025-03-05T00:00:00Z",
      observationWindowEnd: "2025-03-06T23:59:59Z",
    },
  },
];
