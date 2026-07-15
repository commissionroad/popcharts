import type { ReviewEvalCase } from "./dataset-types";

/**
 * Temporal failure modes: markets that name no WHEN, a WHEN that cannot be
 * read at resolution time, a WHEN that has already passed, or a WHEN so
 * ambiguous that two honest resolvers would read different clocks. Most of
 * these are fixable by the creator, so the calibrated verdict is usually
 * manual_review rather than reject; the rationale notes the distinction.
 */
export const TIMING_CASES: ReviewEvalCase[] = [
  {
    id: "timing-no-deadline",
    taxonomy: "timing/no-deadline",
    expected: "manual_review",
    rationale:
      "No WHEN at all — an open-ended 'ever' market can never resolve NO.",
    metadata: {
      category: "Tech",
      question: "Will Apple release a foldable iPhone?",
      description: "Resolves when Apple ships a foldable iPhone.",
      resolutionCriteria:
        "Resolves YES when Apple officially announces and ships a foldable iPhone.",
      resolutionSources: ["https://www.apple.com/newsroom/"],
    },
  },
  {
    id: "timing-ambiguous-season",
    taxonomy: "timing/ambiguous-deadline",
    expected: "manual_review",
    rationale:
      "'By next summer' has no year, no hemisphere, no timezone — two resolvers read different deadlines.",
    metadata: {
      category: "Crypto",
      question: "Will Ethereum flip $10,000 by next summer?",
      description: "Price talk market.",
      resolutionCriteria:
        "Resolves YES if ETH trades above $10,000 by next summer.",
      resolutionSources: ["https://www.coingecko.com/en/coins/ethereum"],
    },
  },
  {
    id: "timing-no-timezone-daily-close",
    taxonomy: "timing/ambiguous-deadline",
    expected: "manual_review",
    acceptable: ["approve"],
    rationale:
      "Names a date and source but 'daily close' without timezone/venue makes the read-out ambiguous across UTC/ET candles.",
    metadata: {
      category: "Crypto",
      question: "Will Solana close above $500 on March 15, 2027?",
      description: "Single-day price threshold.",
      resolutionCriteria:
        "Resolves YES if Solana's daily close on March 15, 2027 is above $500 per CoinGecko.",
      resolutionSources: ["https://www.coingecko.com/en/coins/solana"],
      resolutionUrl: "https://www.coingecko.com/en/coins/solana",
    },
  },
  {
    id: "timing-source-publishes-late",
    taxonomy: "timing/source-lag-race",
    expected: "manual_review",
    rationale:
      "The named source publishes final figures months after the stated resolution moment — the WHEN of the market and the WHEN of the source race each other.",
    metadata: {
      category: "Econ",
      question:
        "Will U.S. GDP grow by more than 2.5% in 2026 (final annual figure)?",
      description:
        "Resolves at year end using the final annual GDP growth figure.",
      resolutionCriteria:
        "Resolves YES on December 31, 2026 if the final BEA annual GDP growth figure for 2026 exceeds 2.5%. (Note: BEA's 'third' annual estimate is not published until late March 2027, and comprehensive revisions come later.)",
      resolutionSources: [
        "https://www.bea.gov/data/gdp/gross-domestic-product",
      ],
      resolutionUrl: "https://www.bea.gov/data/gdp/gross-domestic-product",
    },
  },
  {
    id: "timing-already-determined",
    taxonomy: "timing/already-determined",
    expected: "manual_review",
    acceptable: ["reject"],
    rationale:
      "The outcome is already public history at creation time — a lookup, not a prediction, and an insider-timing vector.",
    metadata: {
      category: "Sports",
      question: "Did the Kansas City Chiefs win Super Bowl LVIII?",
      description: "Settles a bar bet.",
      resolutionCriteria:
        "Resolves YES if the Chiefs won Super Bowl LVIII per NFL.com.",
      resolutionSources: ["https://www.nfl.com"],
      resolutionUrl: "https://www.nfl.com",
    },
  },
  {
    id: "timing-event-after-resolution-window",
    taxonomy: "timing/resolution-before-event",
    expected: "manual_review",
    rationale:
      "The stated decision moment lands before the event can possibly conclude — YES is decidable early but NO never safely is.",
    metadata: {
      category: "Politics",
      question:
        "Will the winner of the November 7, 2028 U.S. presidential election be certified by November 10, 2028?",
      description:
        "Asks about certification within three days of election day.",
      resolutionCriteria:
        "Resolves YES if all fifty states have certified their presidential results by November 10, 2028 per each Secretary of State site; certification statutorily takes weeks in most states.",
      resolutionSources: ["https://www.nass.org"],
    },
  },
  {
    id: "timing-rolling-window",
    taxonomy: "timing/ambiguous-deadline",
    expected: "manual_review",
    rationale:
      "'In the next 30 days' with no anchor date — the window moves depending on when it is read.",
    metadata: {
      category: "Crypto",
      question: "Will Bitcoin drop 20% in the next 30 days?",
      description: "Volatility bet.",
      resolutionCriteria:
        "Resolves YES if BTC falls 20% or more from its current price within the next 30 days, per CoinGecko.",
      resolutionSources: ["https://www.coingecko.com/en/coins/bitcoin"],
    },
  },
];
