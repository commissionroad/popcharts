import type { ResolutionEvalCase } from "./dataset-types";

/**
 * Clear-NO controls: real 2024–2025 events where the asked outcome
 * unambiguously did NOT happen. Several deliberately pair with a clear-YES
 * case on the same event (Super Bowl LIX, Euro 2024, the 2024 election) so a
 * miss shows whether the resolver knows the event or just pattern-matches
 * "famous event → yes".
 */
export const CLEAR_NO_CASES: ResolutionEvalCase[] = [
  {
    id: "no-chiefs-super-bowl-lix-threepeat",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "The Chiefs lost Super Bowl LIX 22-40 to the Eagles; no three-peat.",
    metadata: {
      category: "Sports",
      question: "Did the Kansas City Chiefs win Super Bowl LIX?",
      description:
        "A Chiefs win would have been the NFL's first Super Bowl three-peat.",
      resolutionCriteria:
        "Resolves YES if the NFL's official record (NFL.com) shows the Kansas City Chiefs as the winner of Super Bowl LIX (February 9, 2025), including any overtime; otherwise NO.",
      resolutionSources: [
        "https://www.nfl.com/super-bowl/",
        "https://apnews.com/hub/super-bowl",
      ],
      resolutionUrl: "https://www.nfl.com/super-bowl/",
      observationWindowStart: "2025-02-09T00:00:00Z",
      observationWindowEnd: "2025-02-10T23:59:59Z",
    },
  },
  {
    id: "no-harris-2024-election",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "Kamala Harris lost the 2024 U.S. presidential election to Donald Trump.",
    metadata: {
      category: "Politics",
      question: "Did Kamala Harris win the 2024 U.S. presidential election?",
      description:
        "Decided by the certified result of the November 5, 2024 U.S. presidential election.",
      resolutionCriteria:
        "Resolves YES if Kamala Harris is the certified winner of the November 5, 2024 U.S. presidential election, per the electoral vote count certified by Congress (as reported by the Associated Press and archives.gov); otherwise NO.",
      resolutionSources: [
        "https://apnews.com/hub/election-2024",
        "https://www.archives.gov/electoral-college",
      ],
      resolutionUrl: "https://apnews.com/hub/election-2024",
      observationWindowStart: "2024-11-05T00:00:00Z",
      observationWindowEnd: "2025-01-20T23:59:59Z",
    },
  },
  {
    id: "no-yankees-2024-world-series",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "The Dodgers beat the Yankees in five games in the 2024 World Series.",
    metadata: {
      category: "Sports",
      question: "Did the New York Yankees win the 2024 World Series?",
      description: "The 2024 World Series concluded on October 30, 2024.",
      resolutionCriteria:
        "Resolves YES if MLB's official record (mlb.com) shows the New York Yankees as the winner of the 2024 World Series; otherwise NO.",
      resolutionSources: [
        "https://www.mlb.com/postseason",
        "https://apnews.com/hub/world-series",
      ],
      resolutionUrl: "https://www.mlb.com/postseason",
      observationWindowStart: "2024-10-25T00:00:00Z",
      observationWindowEnd: "2024-11-05T23:59:59Z",
    },
  },
  {
    id: "no-us-recession-2024",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "No 2024 quarter printed negative real GDP growth in the BEA's initial estimates; the U.S. did not meet the stated recession definition.",
    metadata: {
      category: "Econ",
      question:
        "Did the United States record two consecutive quarters of negative real GDP growth during 2024?",
      description:
        "Uses the technical two-negative-quarters definition, not NBER dating.",
      resolutionCriteria:
        "Resolves YES if the BEA's advance (initial) estimates of quarter-over-quarter annualized real GDP growth published at bea.gov show negative readings for two consecutive quarters within calendar year 2024; otherwise NO. Later revisions do not change the outcome; the first official print per quarter is final.",
      resolutionSources: [
        "https://www.bea.gov/data/gdp/gross-domestic-product",
      ],
      resolutionUrl: "https://www.bea.gov/data/gdp/gross-domestic-product",
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2025-01-31T23:59:59Z",
    },
  },
  {
    id: "no-ethereum-10k-2024",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "Ether's 2024 high was roughly $4,100 in December 2024 — nowhere near $10,000.",
    metadata: {
      category: "Crypto",
      question: "Did Ether trade at or above $10,000 at any point during 2024?",
      description:
        "Touch market against major spot exchange prices during calendar year 2024.",
      resolutionCriteria:
        "Resolves YES if the ETH-USD spot price on Coinbase Exchange printed at or above 10000.00 USD at any time between 2024-01-01 00:00 UTC and 2025-01-01 00:00 UTC, using CoinGecko's Ethereum page or Coinbase's own price history as the read-out; otherwise NO.",
      resolutionSources: [
        "https://www.coingecko.com/en/coins/ethereum",
        "https://www.coinbase.com/price/ethereum",
      ],
      resolutionUrl: "https://www.coingecko.com/en/coins/ethereum",
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "no-england-euro-2024",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "England lost the Euro 2024 final 1-2 to Spain — the look-alike pair of the Spain clear-YES case.",
    metadata: {
      category: "Sports",
      question: "Did England win UEFA Euro 2024?",
      description:
        "Decided by the Euro 2024 final played July 14, 2024 in Berlin.",
      resolutionCriteria:
        "Resolves YES if UEFA's official record (uefa.com) shows England as the winner of the UEFA Euro 2024 final (including extra time and penalties if needed); otherwise NO.",
      resolutionSources: [
        "https://www.uefa.com/euro2024/",
        "https://apnews.com/hub/euro-2024",
      ],
      resolutionUrl: "https://www.uefa.com/euro2024/",
      observationWindowStart: "2024-07-14T00:00:00Z",
      observationWindowEnd: "2024-07-15T23:59:59Z",
    },
  },
  {
    id: "no-pacers-2025-nba-finals",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "The Oklahoma City Thunder beat the Indiana Pacers in seven games in the 2025 NBA Finals.",
    metadata: {
      category: "Sports",
      question: "Did the Indiana Pacers win the 2025 NBA Finals?",
      description: "The 2025 NBA Finals concluded on June 22, 2025.",
      resolutionCriteria:
        "Resolves YES if NBA.com's official record shows the Indiana Pacers as the winner of the 2025 NBA Finals; otherwise NO.",
      resolutionSources: [
        "https://www.nba.com/playoffs",
        "https://apnews.com/hub/nba-finals",
      ],
      resolutionUrl: "https://www.nba.com/playoffs",
      observationWindowStart: "2025-06-05T00:00:00Z",
      observationWindowEnd: "2025-06-30T23:59:59Z",
    },
  },
  {
    id: "no-fomc-hike-2024",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "The FOMC held rates through mid-2024 and then cut three times; it never raised the target range in 2024.",
    metadata: {
      category: "Econ",
      question:
        "Did the Federal Reserve raise its target range at any 2024 FOMC meeting?",
      description:
        "Covers all scheduled and unscheduled FOMC decisions in calendar year 2024.",
      resolutionCriteria:
        "Resolves YES if any FOMC statement published on federalreserve.gov during calendar year 2024 sets a federal funds target range whose upper bound is higher than the upper bound in force immediately before that meeting; otherwise NO.",
      resolutionSources: [
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      ],
      resolutionUrl:
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "no-france-top-golds-paris-2024",
    taxonomy: "resolved/clear-no",
    expected: "no",
    rationale:
      "Host nation France finished well behind the USA and China (40 golds each) with 16 golds at Paris 2024.",
    metadata: {
      category: "Sports",
      question:
        "Did France top the gold-medal count at the Paris 2024 Summer Olympics?",
      description:
        "Topping the count means strictly more gold medals than every other nation.",
      resolutionCriteria:
        "Resolves YES if the final official Paris 2024 medal table published by the IOC (olympics.com) shows France with strictly more gold medals than any other nation; otherwise NO. Post-Games medal reallocations after 2024-12-31 are ignored.",
      resolutionSources: [
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      ],
      resolutionUrl:
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      observationWindowStart: "2024-07-26T00:00:00Z",
      observationWindowEnd: "2024-08-11T23:59:59Z",
    },
  },
];
