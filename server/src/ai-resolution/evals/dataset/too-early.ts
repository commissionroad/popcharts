import type { ResolutionEvalCase } from "./dataset-types";

/**
 * `too_early` cases: well-formed markets on events that genuinely have NOT
 * concluded (2027+). The correct behavior is to re-queue, not to guess an
 * outcome and not to abstain — the question is answerable, just not yet.
 * Observation windows end in the future so the trusted timestamps corroborate
 * what the text says.
 */
export const TOO_EARLY_CASES: ResolutionEvalCase[] = [
  {
    id: "early-us-election-2028",
    taxonomy: "timing/too-early",
    expected: "too_early",
    rationale:
      "The 2028 U.S. presidential election has not happened; nothing to resolve yet.",
    metadata: {
      category: "Politics",
      question:
        "Will the Democratic nominee win the 2028 U.S. presidential election?",
      description:
        "Decided by the certified result of the November 7, 2028 U.S. presidential election.",
      resolutionCriteria:
        "Resolves YES if the Democratic Party's nominee is the certified winner of the November 7, 2028 U.S. presidential election, per the electoral vote count certified by Congress (as reported by the Associated Press and archives.gov); otherwise NO.",
      resolutionSources: [
        "https://apnews.com/hub/election-2028",
        "https://www.archives.gov/electoral-college",
      ],
      resolutionUrl: "https://www.archives.gov/electoral-college",
      observationWindowStart: "2028-11-07T00:00:00Z",
      observationWindowEnd: "2029-01-20T23:59:59Z",
    },
  },
  {
    id: "early-bitcoin-500k-before-2030",
    taxonomy: "timing/too-early",
    expected: "too_early",
    rationale:
      "The touch window runs to 2030 and the threshold has not been hit; the market can still resolve YES, so NO now would be premature.",
    metadata: {
      category: "Crypto",
      question: "Will Bitcoin trade at or above $500,000 before 2030?",
      description:
        "Touch market: any qualifying print before the deadline resolves YES immediately.",
      resolutionCriteria:
        "Resolves YES if the BTC-USD spot price on Coinbase Exchange prints at or above 500000.00 USD at any time before 2030-01-01 00:00 UTC, using CoinGecko's Bitcoin page or Coinbase's own price history as the read-out. If no such print occurs by the deadline, resolves NO.",
      resolutionSources: [
        "https://www.coingecko.com/en/coins/bitcoin",
        "https://www.coinbase.com/price/bitcoin",
      ],
      resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
      observationWindowStart: "2025-01-01T00:00:00Z",
      observationWindowEnd: "2029-12-31T23:59:59Z",
    },
  },
  {
    id: "early-la-2028-opening-ceremony",
    taxonomy: "timing/too-early",
    expected: "too_early",
    rationale:
      "The Los Angeles 2028 Games have not started; the opening ceremony date cannot be observed yet.",
    metadata: {
      category: "Sports",
      question:
        "Will the Los Angeles 2028 Summer Olympics opening ceremony take place on July 14, 2028?",
      description:
        "Tracks whether the opening ceremony occurs on its currently scheduled date.",
      resolutionCriteria:
        "Resolves YES if the LA28 opening ceremony takes place (begins) on July 14, 2028 local time in Los Angeles, per olympics.com or the LA28 organizing committee's official announcements; resolves NO if it takes place on any other date.",
      resolutionSources: ["https://www.olympics.com", "https://la28.org"],
      resolutionUrl: "https://la28.org",
      observationWindowStart: "2028-07-01T00:00:00Z",
      observationWindowEnd: "2028-07-31T23:59:59Z",
    },
  },
  {
    id: "early-world-cup-2030-winner",
    taxonomy: "timing/too-early",
    expected: "too_early",
    rationale:
      "The 2030 FIFA World Cup is years away; no result exists to read.",
    metadata: {
      category: "Sports",
      question:
        "Will a South American national team win the 2030 FIFA World Cup?",
      description:
        "South American means a CONMEBOL member association's senior men's team.",
      resolutionCriteria:
        "Resolves YES if FIFA's official record (fifa.com) shows a CONMEBOL member association's team as the winner of the 2030 FIFA World Cup final; otherwise NO.",
      resolutionSources: ["https://www.fifa.com"],
      resolutionUrl: "https://www.fifa.com",
      observationWindowStart: "2030-06-01T00:00:00Z",
      observationWindowEnd: "2030-08-31T23:59:59Z",
    },
  },
  {
    id: "early-artemis-crewed-landing-2030",
    taxonomy: "timing/too-early",
    expected: "too_early",
    rationale:
      "No crewed Artemis lunar landing has occurred; the deadline is years out, so the market must wait.",
    metadata: {
      category: "Tech",
      question:
        "Will NASA land astronauts on the lunar surface before January 1, 2030?",
      description:
        "Counts a crewed Artemis-program touchdown on the Moon's surface, regardless of mission number.",
      resolutionCriteria:
        "Resolves YES if NASA's official site or its press releases confirm astronauts touching down on the lunar surface before 2030-01-01 00:00 UTC, corroborated by major wire coverage (AP or Reuters). If no crewed landing occurs by the deadline, resolves NO.",
      resolutionSources: ["https://www.nasa.gov", "https://apnews.com"],
      resolutionUrl: "https://www.nasa.gov",
      observationWindowStart: "2026-01-01T00:00:00Z",
      observationWindowEnd: "2029-12-31T23:59:59Z",
    },
  },
];
