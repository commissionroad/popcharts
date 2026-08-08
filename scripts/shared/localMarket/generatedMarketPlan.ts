import { getErrorMessage } from "../errors/getErrorMessage.ts";
import {
  buildCryptoMarket,
  digitalAssets,
  type CryptoMarketOption,
} from "./cryptoMarket.ts";
import type { GeneratedMarket } from "./generatedMarket.ts";
import {
  filterUnusedGeneratedMarketOptions,
  generatedMarketDirections,
  generatedMarketOptionKey,
  shouldGenerateIncoherentMarket,
  type GeneratedMarketKind,
  type RejectableMode,
} from "./generatedMarketOptions.ts";
import {
  buildWeatherMarket,
  weatherStations,
  type WeatherMarketOption,
} from "./weatherMarket.ts";

type GeneratedMarketPlanOption = CryptoMarketOption | WeatherMarketOption;

/**
 * Generates one market of the requested kind from live public sources,
 * preferring options no existing market has used. Every option is tried before
 * giving up, because a single unreachable source must not fail a local run when
 * another option would have worked; the throw at the end reports every source
 * failure at once so the developer sees the real cause. `logLabel` is the
 * calling script's own name, so this module never states which script it serves.
 * `rejectable` controls whether the run authors a deliberately incoherent
 * market (one whose criteria contradict its question) so the review reject path
 * gets exercised: "always"/"never" force it, "auto" rolls the default chance.
 */
export async function buildGeneratedMarket({
  kind,
  logLabel,
  rejectable,
  usedOptionKeys,
}: {
  readonly kind: GeneratedMarketKind | "random";
  readonly logLabel: string;
  readonly rejectable: RejectableMode;
  readonly usedOptionKeys: ReadonlySet<string>;
}): Promise<GeneratedMarket> {
  const incoherent = shouldGenerateIncoherentMarket(rejectable, Math.random());

  if (incoherent) {
    console.log(
      `[${logLabel}] authoring an INTENTIONALLY INCOHERENT market — its ` +
        `resolution criteria contradict its own question. Catching that needs ` +
        `a reviewer that reads for meaning: the local stack's default ` +
        `claude-cli model gate should reject it, while a stack dialed to ` +
        `LOCAL_DRAFT_REVIEW_PROVIDER=heuristic matches patterns and will ` +
        `approve it. Pass --coherent to force a normal market.`,
    );
  }

  const allOptions = buildGeneratedMarketOptions(kind);
  const filteredOptions = filterUnusedGeneratedMarketOptions(
    allOptions,
    usedOptionKeys,
  );
  const errors: string[] = [];

  if (filteredOptions.exhausted) {
    console.log(
      `[${logLabel}] all ${filteredOptions.totalCount} ` +
        `${formatOptionScope(kind)} option(s) already exist; allowing a duplicate`,
    );
  } else if (filteredOptions.unusedCount < filteredOptions.totalCount) {
    console.log(
      `[${logLabel}] choosing from ${filteredOptions.unusedCount}/` +
        `${filteredOptions.totalCount} unused ${formatOptionScope(kind)} option(s)`,
    );
  }

  for (const option of shuffle(filteredOptions.options)) {
    try {
      if (option.kind === "crypto") {
        return await buildCryptoMarket(option, { incoherent });
      }

      if (option.kind === "weather") {
        return await buildWeatherMarket(option, { incoherent });
      }
    } catch (error) {
      errors.push(`${option.key}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(
    `Could not generate a live local market. ${errors.join("; ")}`,
  );
}

function buildGeneratedMarketOptions(
  kind: GeneratedMarketKind | "random",
): readonly GeneratedMarketPlanOption[] {
  const options: GeneratedMarketPlanOption[] = [];

  if (kind === "random" || kind === "crypto") {
    for (const asset of digitalAssets) {
      for (const direction of generatedMarketDirections) {
        options.push({
          asset,
          direction,
          key: generatedMarketOptionKey("crypto", asset.id, direction),
          kind: "crypto",
        });
      }
    }
  }

  if (kind === "random" || kind === "weather") {
    for (const station of weatherStations) {
      for (const direction of generatedMarketDirections) {
        options.push({
          direction,
          key: generatedMarketOptionKey(
            "weather",
            station.stationId,
            direction,
          ),
          kind: "weather",
          station,
        });
      }
    }
  }

  return options;
}

function formatOptionScope(kind: GeneratedMarketKind | "random"): string {
  return kind === "random" ? "generated" : kind;
}

/**
 * A uniformly random ordering of `values`, leaving the input untouched. Each
 * element is sorted by its own random key — not by a random *comparator*, the
 * well-known broken idiom, whose inconsistency skews the result and is
 * implementation-defined.
 */
function shuffle<T>(values: readonly T[]): T[] {
  return values
    .map((value) => ({ order: Math.random(), value }))
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.value);
}
