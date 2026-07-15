import type { ReviewEvalCase } from "./dataset-types";

/**
 * Resolvable markets modeled on the discipline the major venues enforce:
 * every question pins WHAT is measured (exact metric and threshold), WHERE
 * it will be read (a named large public source, with a fallback), and WHEN
 * it is read (a date, a timezone, and what happens on postponement or
 * revision). These should approve; a few carry manual_review as acceptable
 * where a cautious reviewer could reasonably want human eyes.
 */
export const GOOD_CASES: ReviewEvalCase[] = [
  {
    id: "good-election-certified-senate",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale:
      "Named race, named certifying source, explicit date and fallback.",
    metadata: {
      category: "Politics",
      question:
        "Will the Republican candidate win the 2026 U.S. Senate race in Ohio?",
      description:
        "Resolves from the officially certified result of the November 3, 2026 general election for U.S. Senate in Ohio.",
      resolutionCriteria:
        "Resolves YES if the Republican nominee is the certified winner per the Ohio Secretary of State's official results page; the Associated Press race call is used if certification is not published by December 1, 2026 (23:59 ET). A court-ordered recount delays resolution until the recount result is certified.",
      resolutionSources: [
        "https://www.ohiosos.gov/elections/election-results-and-data/",
        "https://apnews.com/hub/election-results",
      ],
      resolutionUrl:
        "https://www.ohiosos.gov/elections/election-results-and-data/",
    },
  },
  {
    id: "good-sports-final-nba",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale: "Final score from the league's official site, tie impossible.",
    metadata: {
      category: "Sports",
      question:
        "Will the Boston Celtics beat the Denver Nuggets in their regular-season game on January 12, 2027?",
      description: "Single regular-season NBA game as scheduled by the league.",
      resolutionCriteria:
        "Resolves YES if NBA.com's official box score shows the Celtics with more points at the final whistle (including overtime). If the game is postponed, the rescheduled game counts as long as it is completed by February 12, 2027; otherwise resolves NO.",
      resolutionSources: ["https://www.nba.com/games"],
      resolutionUrl: "https://www.nba.com/games",
    },
  },
  {
    id: "good-crypto-price-timestamp",
    taxonomy: "good/measured-value",
    expected: "approve",
    rationale:
      "Exact metric, named exchange feed, pinned timestamp and timezone.",
    metadata: {
      category: "Crypto",
      question:
        "Will Bitcoin trade at or above $150,000 on Coinbase at 12:00 UTC on December 31, 2026?",
      description:
        "Snapshot price question against a single named exchange feed.",
      resolutionCriteria:
        "Resolves YES if the BTC-USD spot price printed by Coinbase Exchange at 12:00:00 UTC on 2026-12-31 is >= 150000.00 USD, using CoinGecko's Coinbase market page as the read-out; if Coinbase is halted at that minute, the first trade after trading resumes on the same day is used, and if none occurs the market resolves NO.",
      resolutionSources: [
        "https://www.coingecko.com/en/coins/bitcoin",
        "https://www.coinbase.com/price/bitcoin",
      ],
      resolutionUrl: "https://www.coingecko.com/en/coins/bitcoin",
    },
  },
  {
    id: "good-econ-cpi-print",
    taxonomy: "good/measured-value",
    expected: "approve",
    rationale:
      "Official statistical release, exact series and threshold, revision clause.",
    metadata: {
      category: "Econ",
      question:
        "Will U.S. year-over-year CPI inflation for December 2026 come in at or below 3.0%?",
      description:
        "Based on the Bureau of Labor Statistics' scheduled January 2027 CPI release.",
      resolutionCriteria:
        "Resolves YES if the BLS CPI-U 12-month percent change (not seasonally adjusted) for December 2026, as published in the initial January 2027 news release at bls.gov, is <= 3.0%. Later revisions or re-benchmarks do not change the outcome; the first official print is final.",
      resolutionSources: ["https://www.bls.gov/cpi/"],
      resolutionUrl: "https://www.bls.gov/cpi/",
    },
  },
  {
    id: "good-weather-station-threshold",
    taxonomy: "good/measured-value",
    expected: "approve",
    rationale:
      "Named station, exact measurement, date window, official source.",
    metadata: {
      category: "Weather",
      question:
        "Will Central Park (NYC) record 90°F or higher on any day between August 1 and August 7, 2026?",
      description:
        "Daily maximum temperature at the NWS Central Park observation station.",
      resolutionCriteria:
        "Resolves YES if the National Weather Service climate report (NOWData, station: NY City Central Park) shows a daily maximum temperature >= 90°F for any date from 2026-08-01 through 2026-08-07 (local time). The NWS preliminary daily climate report counts; corrections published after August 14, 2026 are ignored.",
      resolutionSources: ["https://www.weather.gov/wrh/climate?wfo=okx"],
      resolutionUrl: "https://www.weather.gov/wrh/climate?wfo=okx",
    },
  },
  {
    id: "good-awards-oscars",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale: "Single official announcement, named ceremony and date.",
    metadata: {
      category: "Culture",
      question:
        "Will a film distributed by A24 win Best Picture at the 2027 Academy Awards?",
      description:
        "Decided at the Academy Awards ceremony scheduled for March 2027.",
      resolutionCriteria:
        "Resolves YES if the Best Picture winner announced at the 99th Academy Awards, per the Academy's official site (oscars.org) or the live televised announcement, is a film whose U.S. distributor of record is A24. If the ceremony is postponed, resolution waits for the rescheduled ceremony up to June 30, 2027; otherwise resolves NO.",
      resolutionSources: ["https://www.oscars.org", "https://apnews.com"],
      resolutionUrl: "https://www.oscars.org",
    },
  },
  {
    id: "good-legislation-enacted",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale: "Public legal act with an authoritative register and deadline.",
    metadata: {
      category: "Politics",
      question:
        "Will a U.S. federal bill raising the minimum wage above $15/hour be signed into law before July 1, 2027?",
      description:
        "Tracks enactment (signature or veto override), not passage of a single chamber.",
      resolutionCriteria:
        "Resolves YES if, before 2027-07-01 00:00 ET, congress.gov shows a public law whose enacted text sets a federal minimum wage above $15.00/hour (any phase-in schedule counts if the final rate exceeds $15.00). Executive orders and state laws do not count.",
      resolutionSources: ["https://www.congress.gov"],
      resolutionUrl: "https://www.congress.gov",
    },
  },
  {
    id: "good-box-office-threshold",
    taxonomy: "good/measured-value",
    expected: "approve",
    rationale: "Quantified threshold, standard industry tracker, cutoff date.",
    metadata: {
      category: "Culture",
      question:
        "Will the next Avatar film gross $1 billion worldwide within 30 days of its wide U.S. release?",
      description:
        "Worldwide cumulative gross per Box Office Mojo's title page.",
      resolutionCriteria:
        "Resolves YES if Box Office Mojo's worldwide cumulative gross for the film reaches >= $1,000,000,000 within 30 calendar days of its wide U.S. release date (per the same page). The figure shown at 23:59 ET on day 30 is final; later restatements are ignored. If the release slips past 2027-06-30, resolves NO.",
      resolutionSources: ["https://www.boxofficemojo.com"],
      resolutionUrl: "https://www.boxofficemojo.com",
    },
  },
  {
    id: "good-space-launch-window",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale:
      "Observable public event, official confirmations, bounded window.",
    metadata: {
      category: "Tech",
      question:
        "Will NASA's Artemis III mission launch (liftoff) before January 1, 2028?",
      description:
        "Liftoff means the vehicle leaves the pad on an orbital launch attempt, regardless of mission outcome.",
      resolutionCriteria:
        "Resolves YES if NASA's official site or its @NASA press releases confirm Artemis III liftoff occurring before 2028-01-01 00:00 UTC. Scrubs and wet dress rehearsals do not count; a launch that ends in failure after liftoff still counts as YES.",
      resolutionSources: ["https://www.nasa.gov", "https://apnews.com"],
      resolutionUrl: "https://www.nasa.gov",
    },
  },
  {
    id: "good-fed-rate-decision",
    taxonomy: "good/official-result",
    expected: "approve",
    rationale: "Scheduled official decision with authoritative publication.",
    metadata: {
      category: "Econ",
      question:
        "Will the Federal Reserve cut its target range at the March 2027 FOMC meeting?",
      description:
        "Compares the target range announced after the March 2027 meeting to the range in force before it.",
      resolutionCriteria:
        "Resolves YES if the FOMC statement published on federalreserve.gov after the scheduled March 2027 meeting sets a federal funds target range whose upper bound is lower than the upper bound in force immediately before the meeting. An emergency inter-meeting cut before the March meeting does not by itself resolve this market.",
      resolutionSources: [
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
      ],
      resolutionUrl:
        "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
    },
  },
  {
    id: "good-borderline-app-store-rank",
    taxonomy: "good/measured-value",
    expected: "approve",
    acceptable: ["manual_review"],
    rationale:
      "Measurable and public but the read-out is a fast-moving chart with no archival page — a cautious reviewer may park it.",
    metadata: {
      category: "Tech",
      question:
        "Will ChatGPT be the #1 free iPhone app on the U.S. App Store's Top Free chart at 12:00 ET on March 1, 2027?",
      description:
        "Snapshot of Apple's U.S. Top Free iPhone chart at a pinned time.",
      resolutionCriteria:
        "Resolves YES if the U.S. App Store Top Free iPhone chart shows ChatGPT at rank #1 at 12:00 ET on 2027-03-01, as evidenced by the chart page or an archive.org capture within ±1 hour of the timestamp; if no capture exists, the earliest capture that day decides.",
      resolutionSources: [
        "https://apps.apple.com/us/charts/iphone",
        "https://web.archive.org",
      ],
      resolutionUrl: "https://apps.apple.com/us/charts/iphone",
    },
  },
  {
    id: "good-borderline-wikipedia-fallback",
    taxonomy: "good/official-result",
    expected: "approve",
    acceptable: ["manual_review"],
    rationale:
      "Clear public event; the named source hierarchy leans on an encyclopedia rather than a primary source, which a careful reviewer may flag.",
    metadata: {
      category: "Culture",
      question:
        "Will the 2027 Eurovision Song Contest be won by an entry from a Nordic country?",
      description: "Nordic = Denmark, Finland, Iceland, Norway, or Sweden.",
      resolutionCriteria:
        "Resolves YES if the winner announced at the 2027 Eurovision grand final represents Denmark, Finland, Iceland, Norway, or Sweden, per eurovision.tv, with Wikipedia's contest page as fallback if the official page is unavailable seven days after the final.",
      resolutionSources: [
        "https://eurovision.tv",
        "https://en.wikipedia.org/wiki/Eurovision_Song_Contest_2027",
      ],
      resolutionUrl: "https://eurovision.tv",
    },
  },
];
