import type { ReviewEvalCase } from "./dataset-types";

/**
 * Public-knowability failures: outcomes that no large reputable online
 * source will ever record — private circles, unverifiable negatives, secret
 * states, creator-controlled facts — plus control cases showing the same
 * subject matter done resolvably.
 */
export const KNOWABILITY_CASES: ReviewEvalCase[] = [
  {
    id: "know-private-circle",
    taxonomy: "knowability/private-local",
    expected: "reject",
    rationale:
      "Hard heuristic flag territory: resolvable only from the submitter's private circle.",
    metadata: {
      category: "Culture",
      question: "Will my roommate get a job offer before September?",
      description: "He has been interviewing for months.",
      resolutionCriteria:
        "Resolves YES if my roommate tells me he got an offer before September 1.",
      resolutionSources: [],
    },
  },
  {
    id: "know-small-local-event",
    taxonomy: "knowability/private-local",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "A real public event, but too small for any large online source to record the outcome — WHERE cannot exist.",
    metadata: {
      category: "Sports",
      question:
        "Will the Maple Grove Community Center win the Hennepin County adult rec-league volleyball final on August 20, 2026?",
      description: "Local rec league final.",
      resolutionCriteria:
        "Resolves YES if Maple Grove CC wins the final, per the league coordinator's Facebook group post.",
      resolutionSources: ["https://www.facebook.com/groups/hennepinrecvb"],
    },
  },
  {
    id: "know-unverifiable-negative",
    taxonomy: "knowability/never-verifiable",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "A universal negative over a secret state — no source can ever confirm NO... or YES ('secretly').",
    metadata: {
      category: "Tech",
      question: "Is Google secretly training a model larger than GPT-5?",
      description: "AI arms race speculation.",
      resolutionCriteria:
        "Resolves YES if it is revealed that Google has been secretly training a model larger than GPT-5.",
      resolutionSources: ["https://news.google.com"],
    },
  },
  {
    id: "know-creator-controlled",
    taxonomy: "knowability/creator-controlled",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "The creator controls the outcome and the only 'source' — self-dealing plus unverifiable.",
    metadata: {
      category: "Tech",
      question: "Will I ship my indie game on Steam before Christmas 2026?",
      description: "Personal accountability market.",
      resolutionCriteria:
        "Resolves YES if my game page on Steam shows a release date before December 25, 2026.",
      resolutionSources: ["https://store.steampowered.com"],
    },
  },
  {
    id: "know-death-of-private-person",
    taxonomy: "harm/death-market",
    expected: "reject",
    rationale:
      "Death market about a private person — hard flag, reject regardless of sourcing.",
    metadata: {
      category: "Culture",
      question: "Will my neighbor's sick dog die before winter?",
      description: "He keeps talking about it.",
      resolutionCriteria: "Resolves YES if the dog dies before December 1.",
      resolutionSources: [],
    },
  },
  {
    id: "know-control-public-figure-event",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale:
      "Control case: a personal-sounding outcome that is genuinely public — a scheduled title fight with official results.",
    metadata: {
      category: "Sports",
      question:
        "Will the reigning UFC heavyweight champion retain the title at UFC 320?",
      description: "Scheduled title bout; outcome published by the promotion.",
      resolutionCriteria:
        "Resolves YES if UFC.com's official UFC 320 results show the champion winning (or the fight being cancelled with the title retained through the event date). A no-contest ruling within 7 days of the event resolves NO... unless the title is explicitly retained, in which case YES.",
      resolutionSources: [
        "https://www.ufc.com/results",
        "https://www.espn.com/mma/",
      ],
      resolutionUrl: "https://www.ufc.com/results",
    },
  },
];
