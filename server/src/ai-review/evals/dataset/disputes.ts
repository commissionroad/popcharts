import type { ReviewEvalCase } from "./dataset-types";

/**
 * Modeled on DOCUMENTED real-world settlement disputes (Polymarket/Kalshi,
 * 2025–26): markets that look well-formed — named topic, date, big source —
 * but hide the exact defect that later blew up a real market. These are the
 * highest-value review cases: a naive reviewer approves all of them. The
 * calibrated verdict is manual_review (fixable wording), with rationales
 * naming the real incident pattern each mirrors.
 */
export const DISPUTE_PATTERN_CASES: ReviewEvalCase[] = [
  {
    id: "dispute-undefined-predicate-suit",
    taxonomy: "vagueness/undefined-predicate",
    expected: "manual_review",
    rationale:
      "Mirrors the Zelenskyy-suit dispute: the predicate ('formal attire') is undefined and the source standard ('credible reporting') is unnamed.",
    metadata: {
      category: "Politics",
      question:
        "Will the President of France wear formal attire at the 2026 G20 summit?",
      description: "Fashion-watch market for the summit.",
      resolutionCriteria:
        "Resolves YES if credible reporting shows the President of France wearing formal attire at any official 2026 G20 session.",
      resolutionSources: ["https://news.google.com"],
    },
  },
  {
    id: "dispute-contested-verb-invade",
    taxonomy: "vagueness/undefined-predicate",
    expected: "manual_review",
    rationale:
      "Mirrors the Venezuela-'invade' dispute: a contested verb with no operational definition (does a raid count? a blockade?).",
    metadata: {
      category: "Politics",
      question: "Will China invade Taiwan before 2028?",
      description: "Geopolitical risk market.",
      resolutionCriteria:
        "Resolves YES if China invades Taiwan before January 1, 2028, per major news outlets.",
      resolutionSources: ["https://apnews.com", "https://www.reuters.com"],
    },
  },
  {
    id: "dispute-event-vs-observation-time",
    taxonomy: "timing/event-vs-observation",
    expected: "manual_review",
    rationale:
      "Mirrors the MicroStrategy May-sale dispute: the event can happen inside the window but be DISCLOSED after it — the criteria never say which clock counts.",
    metadata: {
      category: "Crypto",
      question: "Will MicroStrategy sell any Bitcoin during Q1 2027?",
      description:
        "Tracks whether the company's BTC position decreases during the quarter.",
      resolutionCriteria:
        "Resolves YES if MicroStrategy sells any Bitcoin between January 1 and March 31, 2027, per company filings or announcements.",
      resolutionSources: [
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=MSTR",
      ],
      resolutionUrl:
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=MSTR",
    },
  },
  {
    id: "dispute-initial-print-vs-revision",
    taxonomy: "timing/initial-print-vs-revision",
    expected: "manual_review",
    rationale:
      "Mirrors the Kalshi Oscars-viewership blowup: a figure that gets revised within days, with no initial-print-vs-final rule and a secondary source as the read-out.",
    metadata: {
      category: "Culture",
      question:
        "Will the 2027 Super Bowl draw more than 120 million U.S. viewers?",
      description: "TV ratings market.",
      resolutionCriteria:
        "Resolves YES if the Super Bowl LXI U.S. audience exceeds 120 million viewers, as reported by news coverage of the Nielsen figures.",
      resolutionSources: ["https://www.nytimes.com", "https://variety.com"],
    },
  },
  {
    id: "dispute-no-postponement-default",
    taxonomy: "timing/no-postponement-default",
    expected: "manual_review",
    acceptable: ["approve"],
    rationale:
      "Well-sourced and dated, but no clause for postponement/cancellation — the exact gap the venues' two-day / resolve-No clauses exist to close.",
    metadata: {
      category: "Sports",
      question: "Will the 2027 Monaco Grand Prix be won by a Ferrari driver?",
      description: "Race-winner market for the scheduled May 2027 race.",
      resolutionCriteria:
        "Resolves YES if the official Formula 1 site lists a Ferrari driver as winner of the 2027 Monaco Grand Prix.",
      resolutionSources: ["https://www.formula1.com/en/results"],
      resolutionUrl: "https://www.formula1.com/en/results",
    },
  },
  {
    id: "dispute-ambiguous-performs",
    taxonomy: "vagueness/undefined-predicate",
    expected: "manual_review",
    rationale:
      "Mirrors the Cardi B halftime split-settlement: 'performs' is undefined (cameo? guest verse? recorded segment?), and two venues settled the same footage oppositely.",
    metadata: {
      category: "Culture",
      question:
        "Will Taylor Swift perform at the 2027 Super Bowl halftime show?",
      description: "Halftime lineup market.",
      resolutionCriteria:
        "Resolves YES if Taylor Swift performs at the Super Bowl LXI halftime show, per the broadcast and news coverage.",
      resolutionSources: ["https://www.nfl.com", "https://apnews.com"],
    },
  },
  {
    id: "dispute-control-fully-clause",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale:
      "Control case: the halftime idea written with venue-grade clauses — defined predicate, source hierarchy, no-event default.",
    metadata: {
      category: "Culture",
      question:
        "Will Taylor Swift be an announced headline or guest performer of the 2027 Super Bowl halftime show?",
      description: "Counts official announcements, not rumored appearances.",
      resolutionCriteria:
        "Resolves YES if the NFL's official halftime-show announcement (nfl.com or the NFL's verified accounts) names Taylor Swift as a halftime performer (headliner or announced guest) for Super Bowl LXI, at any time before kickoff. Unannounced surprise appearances do not count. If the halftime show is cancelled, resolves NO.",
      resolutionSources: ["https://www.nfl.com", "https://apnews.com"],
      resolutionUrl: "https://www.nfl.com",
    },
  },
];
