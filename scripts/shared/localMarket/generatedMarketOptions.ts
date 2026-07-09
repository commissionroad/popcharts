export const generatedMarketDirections = ["higher", "lower"] as const;

export type GeneratedMarketDirection =
  (typeof generatedMarketDirections)[number];
export type GeneratedMarketKind = "crypto" | "weather";

export type GeneratedMarketOption = {
  readonly key: string;
};

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

export function generatedMarketOptionKey(
  kind: GeneratedMarketKind,
  subjectKey: string,
  direction: GeneratedMarketDirection,
): string {
  return `${kind}:${subjectKey}:${direction}`;
}

export function extractGeneratedMarketOptionKeyFromQuestion(
  question: string,
  subjects: GeneratedMarketQuestionSubjects,
): string | null {
  const cryptoMatch = question.match(
    /^Will ([A-Z]+)\/USD be (higher|lower) than /,
  );

  if (cryptoMatch) {
    const [, symbol, direction] = cryptoMatch;
    const asset = subjects.crypto.find((candidate) => candidate.symbol === symbol);

    return asset
      ? generatedMarketOptionKey(
          "crypto",
          asset.key,
          direction as GeneratedMarketDirection,
        )
      : null;
  }

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
  const unusedOptions = options.filter((option) => !usedOptionKeys.has(option.key));
  const exhausted = unusedOptions.length === 0 && options.length > 0;

  return {
    exhausted,
    options: exhausted ? options : unusedOptions,
    totalCount: options.length,
    unusedCount: unusedOptions.length,
  };
}
