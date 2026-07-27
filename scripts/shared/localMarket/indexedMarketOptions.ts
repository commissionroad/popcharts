import { getErrorMessage } from "../errors/getErrorMessage.ts";
import { isRecord } from "../json/readJsonPath.ts";
import { sourceTimeoutMs } from "../net/fetchJson.ts";
import { resolveApiUrl } from "../net/resolveApiUrl.ts";
import { digitalAssets } from "./cryptoMarket.ts";
import { extractGeneratedMarketOptionKeyFromQuestion } from "./generatedMarketOptions.ts";
import { weatherStations } from "./weatherMarket.ts";

/**
 * The generated-market options a chain already has markets for, recovered from
 * the indexed questions themselves. Returns an empty set — never throws — when
 * the API cannot be reached: de-duplication is a nicety, and a developer asking
 * for a market gets one even with the indexer down. `logLabel` is the calling
 * script's own name, so this module never states which script it serves.
 */
export async function readExistingGeneratedMarketOptions({
  apiBaseUrl,
  chainId,
  logLabel,
}: {
  readonly apiBaseUrl: string;
  readonly chainId: number;
  readonly logLabel: string;
}): Promise<ReadonlySet<string>> {
  try {
    const markets = await fetchIndexedMarkets({ apiBaseUrl, chainId });
    const optionKeys = new Set<string>();
    const subjects = {
      crypto: digitalAssets.map((asset) => ({
        key: asset.id,
        symbol: asset.symbol,
      })),
      weather: weatherStations.map((station) => ({
        city: station.city,
        key: station.stationId,
      })),
    };

    for (const market of markets) {
      const question = readIndexedMarketQuestion(market);
      const optionKey = question
        ? extractGeneratedMarketOptionKeyFromQuestion(question, subjects)
        : null;

      if (optionKey) {
        optionKeys.add(optionKey);
      }
    }

    if (optionKeys.size > 0) {
      console.log(
        `[${logLabel}] found ${optionKeys.size} generated option(s) ` +
          "already represented in existing markets",
      );
    }

    return optionKeys;
  } catch (error) {
    console.warn(
      `[${logLabel}] could not check existing markets for duplicates: ` +
        getErrorMessage(error),
    );
    return new Set();
  }
}

async function fetchIndexedMarkets({
  apiBaseUrl,
  chainId,
}: {
  readonly apiBaseUrl: string;
  readonly chainId: number;
}): Promise<readonly unknown[]> {
  const url = resolveApiUrl({ baseUrl: apiBaseUrl, path: "markets" });
  url.searchParams.set("chainId", String(chainId));

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(sourceTimeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `GET ${response.url} returned ${response.status}${
        body ? `: ${body.slice(0, 240)}` : ""
      }`,
    );
  }

  const body = await response.json();

  if (!Array.isArray(body)) {
    throw new Error(`GET ${response.url} did not return a market list.`);
  }

  return body;
}

function readIndexedMarketQuestion(market: unknown): string | null {
  if (!isRecord(market) || !isRecord(market.metadata)) {
    return null;
  }

  return typeof market.metadata.question === "string"
    ? market.metadata.question
    : null;
}
