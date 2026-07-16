import type { ResolutionEvalCase } from "./dataset-types";

/**
 * Clear-YES controls: real 2024–2025 events with unambiguous, heavily
 * documented public outcomes. Criteria follow the WHAT/WHERE/WHEN discipline
 * with real named sources, so a resolver with either pre-trained knowledge or
 * web search should return `yes` with high confidence.
 */
export const CLEAR_YES_CASES: ResolutionEvalCase[] = [
  {
    id: "yes-us-election-2024-trump",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "Trump won the 2024 U.S. presidential election; certified by Congress on January 6, 2025 and inaugurated January 20, 2025.",
    metadata: {
      category: "Politics",
      question: "Did Donald Trump win the 2024 U.S. presidential election?",
      description:
        "Decided by the certified result of the November 5, 2024 U.S. presidential election.",
      resolutionCriteria:
        "Resolves YES if Donald Trump is the certified winner of the November 5, 2024 U.S. presidential election, per the electoral vote count certified by Congress (as reported by the Associated Press and archives.gov); otherwise NO. Inauguration of the winner is the hard fallback confirmation.",
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
    id: "yes-bitcoin-100k-2024",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "Bitcoin first traded above $100,000 on December 5, 2024 (UTC), widely reported and visible on every major price tracker.",
    metadata: {
      category: "Crypto",
      question:
        "Did Bitcoin trade at or above $100,000 at any point before January 1, 2025?",
      description:
        "Touch market against major spot exchange prices during calendar year 2024.",
      resolutionCriteria:
        "Resolves YES if the BTC-USD spot price on Coinbase Exchange printed at or above 100000.00 USD at any time before 2025-01-01 00:00 UTC, using CoinGecko's Bitcoin page or Coinbase's own price history as the read-out; otherwise NO.",
      resolutionSources: [
        "https://www.coingecko.com/en/coins/bitcoin",
        "https://www.coinbase.com/price/bitcoin",
      ],
      resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "yes-eagles-super-bowl-lix",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "The Philadelphia Eagles beat the Kansas City Chiefs 40-22 in Super Bowl LIX on February 9, 2025.",
    metadata: {
      category: "Sports",
      question: "Did the Philadelphia Eagles win Super Bowl LIX?",
      description:
        "Super Bowl LIX was played on February 9, 2025 in New Orleans.",
      resolutionCriteria:
        "Resolves YES if the NFL's official record (NFL.com) shows the Philadelphia Eagles as the winner of Super Bowl LIX (February 9, 2025), including any overtime; otherwise NO.",
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
    id: "yes-usa-most-total-medals-paris-2024",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "The United States won 126 total medals at Paris 2024, the most of any nation by a wide margin.",
    metadata: {
      category: "Sports",
      question:
        "Did the United States win the most total medals at the Paris 2024 Summer Olympics?",
      description:
        "Total medals means gold + silver + bronze in the final official medal table.",
      resolutionCriteria:
        "Resolves YES if the final official Paris 2024 medal table published by the IOC (olympics.com) shows the United States with strictly more total medals (gold + silver + bronze) than any other nation; otherwise NO. Post-Games medal reallocations after 2024-12-31 are ignored.",
      resolutionSources: [
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      ],
      resolutionUrl:
        "https://www.olympics.com/en/olympic-games/paris-2024/medals",
      observationWindowStart: "2024-07-26T00:00:00Z",
      observationWindowEnd: "2024-08-11T23:59:59Z",
    },
  },
  {
    id: "yes-anora-best-picture-2025",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "Anora won Best Picture at the 97th Academy Awards on March 2, 2025.",
    metadata: {
      category: "Culture",
      question:
        "Did the film Anora win Best Picture at the 97th Academy Awards?",
      description:
        "The 97th Academy Awards ceremony was held on March 2, 2025.",
      resolutionCriteria:
        "Resolves YES if the Best Picture winner announced at the 97th Academy Awards (March 2, 2025), per the Academy's official site (oscars.org) or the live televised announcement, is Anora; otherwise NO.",
      resolutionSources: ["https://www.oscars.org", "https://apnews.com"],
      resolutionUrl: "https://www.oscars.org",
      observationWindowStart: "2025-03-02T00:00:00Z",
      observationWindowEnd: "2025-03-03T23:59:59Z",
    },
  },
  {
    id: "yes-fomc-september-2024-cut",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "The FOMC cut the federal funds target range by 50 basis points at its September 17-18, 2024 meeting — its first cut of the cycle.",
    metadata: {
      category: "Econ",
      question:
        "Did the Federal Reserve cut its target range at the September 2024 FOMC meeting?",
      description:
        "Compares the target range announced after the September 2024 meeting to the range in force before it.",
      resolutionCriteria:
        "Resolves YES if the FOMC statement published on federalreserve.gov after the scheduled September 17-18, 2024 meeting sets a federal funds target range whose upper bound is lower than the upper bound in force immediately before the meeting; otherwise NO.",
      resolutionSources: [
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      ],
      resolutionUrl:
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      observationWindowStart: "2024-09-17T00:00:00Z",
      observationWindowEnd: "2024-09-19T23:59:59Z",
    },
  },
  {
    id: "yes-starship-booster-catch-2024",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "SpaceX caught the Super Heavy booster with the launch tower arms on Starship Flight 5, October 13, 2024 — a globally covered first.",
    metadata: {
      category: "Tech",
      question:
        "Did SpaceX catch a Super Heavy booster with the launch tower arms during 2024?",
      description:
        "Counts a returning Super Heavy booster captured mid-air by the launch tower's mechanical arms at Starbase.",
      resolutionCriteria:
        "Resolves YES if SpaceX (spacex.com or its official launch webcast) confirms a Super Heavy booster was caught by the launch tower arms on any Starship flight before 2025-01-01 00:00 UTC, corroborated by major wire coverage (AP or Reuters); otherwise NO.",
      resolutionSources: ["https://www.spacex.com", "https://apnews.com"],
      resolutionUrl: "https://www.spacex.com",
      observationWindowStart: "2024-01-01T00:00:00Z",
      observationWindowEnd: "2024-12-31T23:59:59Z",
    },
  },
  {
    id: "yes-labour-majority-uk-2024",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "Labour won a large majority in the July 4, 2024 UK general election and Keir Starmer became Prime Minister.",
    metadata: {
      category: "Politics",
      question:
        "Did the Labour Party win a majority of seats in the July 2024 UK general election?",
      description:
        "Majority means more than 325 of the 650 House of Commons seats.",
      resolutionCriteria:
        "Resolves YES if the official results of the July 4, 2024 UK general election, per the BBC's results service or the House of Commons Library, show the Labour Party winning strictly more than 325 seats; otherwise NO.",
      resolutionSources: [
        "https://www.bbc.com/news/election/2024/uk/results",
        "https://commonslibrary.parliament.uk",
      ],
      resolutionUrl: "https://www.bbc.com/news/election/2024/uk/results",
      observationWindowStart: "2024-07-04T00:00:00Z",
      observationWindowEnd: "2024-07-06T23:59:59Z",
    },
  },
  {
    id: "yes-spain-euro-2024",
    taxonomy: "resolved/clear-yes",
    expected: "yes",
    rationale:
      "Spain beat England 2-1 in the UEFA Euro 2024 final on July 14, 2024 in Berlin.",
    metadata: {
      category: "Sports",
      question: "Did Spain win UEFA Euro 2024?",
      description:
        "Decided by the Euro 2024 final played July 14, 2024 in Berlin.",
      resolutionCriteria:
        "Resolves YES if UEFA's official record (uefa.com) shows Spain as the winner of the UEFA Euro 2024 final (including extra time and penalties if needed); otherwise NO.",
      resolutionSources: [
        "https://www.uefa.com/euro2024/",
        "https://apnews.com/hub/euro-2024",
      ],
      resolutionUrl: "https://www.uefa.com/euro2024/",
      observationWindowStart: "2024-07-14T00:00:00Z",
      observationWindowEnd: "2024-07-15T23:59:59Z",
    },
  },
];
