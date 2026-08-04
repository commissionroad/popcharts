/**
 * The vocabulary generated local-dev markets are built from: which sources a
 * market can be generated from, and which way its threshold can point. Both
 * lists are the single source of truth — the CLI validates `--kind` against
 * this one, the option builders enumerate it, and the question parser below
 * reads questions back out of it, so a new kind or direction is added here
 * once.
 */
export const generatedMarketKinds = ["crypto", "weather"] as const;
export const generatedMarketDirections = ["higher", "lower"] as const;

export type GeneratedMarketDirection =
  (typeof generatedMarketDirections)[number];
export type GeneratedMarketKind = (typeof generatedMarketKinds)[number];

/**
 * The other direction. Used to author a deliberately incoherent market: its
 * resolution criteria point the opposite way from its own question, which the
 * market review's coherence check is meant to reject.
 */
export function oppositeGeneratedMarketDirection(
  direction: GeneratedMarketDirection,
): GeneratedMarketDirection {
  return direction === "higher" ? "lower" : "higher";
}

/**
 * How a run should treat the incoherent-market roll: "always"/"never" are the
 * --rejectable/--coherent flags, and "auto" (the default) rolls against a fixed
 * chance so ordinary runs still exercise the review reject path now and then.
 */
export type RejectableMode = "always" | "auto" | "never";

/** Odds an "auto" run authors an incoherent, review-rejectable market. */
export const REJECTABLE_MARKET_CHANCE = 0.25;

/**
 * Decides whether to author an incoherent market from the mode and a [0, 1)
 * sample. The sample is passed in rather than drawn here so the policy stays
 * pure and unit-testable; the caller supplies Math.random().
 */
export function shouldGenerateIncoherentMarket(
  mode: RejectableMode,
  roll: number,
  chance: number = REJECTABLE_MARKET_CHANCE,
): boolean {
  if (mode === "always") {
    return true;
  }
  if (mode === "never") {
    return false;
  }
  return roll < chance;
}

/** The shape `filterUnusedGeneratedMarketOptions` needs of any option. */
export type GeneratedMarketOption = {
  readonly key: string;
};

/** Narrows an arbitrary string — a CLI argument — to a known market kind. */
export function isGeneratedMarketKind(
  value: string,
): value is GeneratedMarketKind {
  return (generatedMarketKinds as readonly string[]).includes(value);
}

/**
 * The subjects a generated question can be about, per kind, supplied by the
 * caller that owns those catalogues so this module never mirrors them.
 */
export type GeneratedMarketQuestionSubjects = {
  readonly crypto: readonly {
    readonly key: string;
    readonly symbol: string;
  }[];
  readonly weather: readonly {
    readonly city: string;
    readonly key: string;
  }[];
};

/**
 * The stable identity of one generated-market option, used to tell which
 * options a chain already has a market for. Kind, subject, and direction
 * together are what makes two generated markets duplicates of each other.
 */
export function generatedMarketOptionKey(
  kind: GeneratedMarketKind,
  subjectKey: string,
  direction: GeneratedMarketDirection,
): string {
  return `${kind}:${subjectKey}:${direction}`;
}

/**
 * Recovers the option key a previously generated question came from, or null
 * for any question this generator did not write. Questions are the only record
 * of which options a chain has used — nothing else survives onchain — so the
 * patterns below must track the question text the market builders produce.
 */
export function extractGeneratedMarketOptionKeyFromQuestion(
  question: string,
  subjects: GeneratedMarketQuestionSubjects,
): string | null {
  // Matches the crypto question's opening — "Will BTC/USD be higher than " —
  // capturing the ticker and the direction. Anchored at the start so a
  // hand-written market that merely quotes the phrase is not claimed.
  const cryptoMatch = question.match(
    /^Will ([A-Z]+)\/USD be (higher|lower) than /,
  );

  if (cryptoMatch) {
    const [, symbol, direction] = cryptoMatch;
    const asset = subjects.crypto.find(
      (candidate) => candidate.symbol === symbol,
    );

    return asset
      ? generatedMarketOptionKey(
          "crypto",
          asset.key,
          direction as GeneratedMarketDirection,
        )
      : null;
  }

  // Matches the weather question's opening — "Will the max San Francisco METAR
  // temperature be lower than " — capturing the city and the direction. The
  // city capture is greedy but bounded by the literal " METAR temperature be "
  // that follows it, so multi-word city names survive.
  const weatherMatch = question.match(
    /^Will the max (.+) METAR temperature be (higher|lower) than /,
  );

  if (weatherMatch) {
    const [, city, direction] = weatherMatch;
    const station = subjects.weather.find(
      (candidate) => candidate.city === city,
    );

    return station
      ? generatedMarketOptionKey(
          "weather",
          station.key,
          direction as GeneratedMarketDirection,
        )
      : null;
  }

  return null;
}

/**
 * Narrows options to those no market has used yet, reporting the counts the
 * caller logs. Once every option is used it returns the full list and sets
 * `exhausted`: a local dev helper must still be able to create a market, so
 * de-duplication degrades to a duplicate rather than to a failure.
 */
export function filterUnusedGeneratedMarketOptions<
  T extends GeneratedMarketOption,
>(
  options: readonly T[],
  usedOptionKeys: ReadonlySet<string>,
): {
  readonly exhausted: boolean;
  readonly options: readonly T[];
  readonly totalCount: number;
  readonly unusedCount: number;
} {
  const unusedOptions = options.filter(
    (option) => !usedOptionKeys.has(option.key),
  );
  const exhausted = unusedOptions.length === 0 && options.length > 0;

  return {
    exhausted,
    options: exhausted ? options : unusedOptions,
    totalCount: options.length,
    unusedCount: unusedOptions.length,
  };
}
