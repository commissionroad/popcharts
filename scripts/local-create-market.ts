#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MARKET_COUNT_SELECTOR,
  formatChainId,
  isUint256Word,
} from "./shared/chain/pregradManagerProbe.ts";
import { parseSmokeMarket } from "./shared/deployments/smokeMarket.ts";
import { localChainEnvFile } from "./shared/env/localDevEnvFiles.ts";
import { readEnvFile } from "./shared/env/readEnvFile.ts";
import { resolveIndexerApiBaseUrl } from "./shared/env/resolveIndexerApiBaseUrl.ts";
import { BASE_CHAIN_PORT } from "./shared/localStack/ports.ts";
import {
  pruneDeadDescriptors,
  type StackDescriptor,
} from "./shared/localStack/registry.ts";
import { promptForStack } from "./shared/localStack/promptForStack.ts";
import {
  resolveTargetStack,
  TargetStackResolutionError,
} from "./shared/localStack/resolveTargetStack.ts";
import {
  extractGeneratedMarketOptionKeyFromQuestion,
  filterUnusedGeneratedMarketOptions,
  generatedMarketDirections,
  generatedMarketOptionKey,
  type GeneratedMarketDirection,
} from "./shared/localMarket/generatedMarketOptions.ts";
import { protocolDir, repoRoot } from "./shared/paths.ts";

/**
 * Creates one local market against the currently running local dev chain.
 * Generates a near-term crypto or weather market from live public sources,
 * creates it onchain through the protocol helper, then saves the matching
 * metadata to the local API so the app can render the market it created.
 */

const defaultEnvFile = localChainEnvFile;
const generatedMarketKinds = ["crypto", "weather"] as const;
const sourceTimeoutMs = 8_000;
const localMarketGraduationSeconds = 60 * 60;
const localMarketResolutionSeconds = 2 * 60 * 60;
const sourceUserAgent =
  "popcharts-local-create-market (local development helper)";
const spotPriceSourceUrl =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd";
const forecastPointSourceUrl = "https://api.weather.gov/points/";
const observationSourceUrl = "https://aviationweather.gov/api/data/metar";

type GeneratedMarketKind = (typeof generatedMarketKinds)[number];

type DigitalAsset = {
  readonly id: string;
  readonly symbol: string;
};

type WeatherStation = {
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string;
  readonly stationId: string;
};

type CryptoMarketOption = {
  readonly asset: DigitalAsset;
  readonly direction: GeneratedMarketDirection;
  readonly key: string;
  readonly kind: "crypto";
};

type WeatherMarketOption = {
  readonly direction: GeneratedMarketDirection;
  readonly key: string;
  readonly kind: "weather";
  readonly station: WeatherStation;
};

type GeneratedMarketOption = CryptoMarketOption | WeatherMarketOption;

type MarketMetadata = {
  readonly category: string;
  readonly createdAt: string;
  readonly description: string;
  readonly question: string;
  readonly resolutionCriteria: string;
  readonly resolutionSources?: readonly string[];
  readonly resolutionUrl?: string;
  readonly version: number;
};

type GeneratedMarket = {
  readonly graduationSeconds: number;
  readonly kind: GeneratedMarketKind;
  readonly metadata: MarketMetadata;
  readonly resolutionSeconds: number;
};

/** Parsed command-line options for the local market creation helper. */
export type CliOptions = {
  apiBaseUrl: string | undefined;
  envFile: string | undefined;
  help: boolean;
  kind: GeneratedMarketKind | "random";
  preview: boolean;
  stack: string | undefined;
};

type RpcResponse = {
  error?: { message: string };
  result?: unknown;
};

const digitalAssets: readonly DigitalAsset[] = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
];

const weatherStations: readonly WeatherStation[] = [
  {
    city: "NYC",
    latitude: 40.7128,
    longitude: -74.006,
    name: "New York City",
    stationId: "KNYC",
  },
  {
    city: "Miami",
    latitude: 25.7617,
    longitude: -80.1918,
    name: "Miami",
    stationId: "KMIA",
  },
  {
    city: "Los Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
    name: "Los Angeles",
    stationId: "KLAX",
  },
  {
    city: "San Francisco",
    latitude: 37.7749,
    longitude: -122.4194,
    name: "San Francisco",
    stationId: "KSFO",
  },
];
const hardhatLocalChainId = "0x7a69";
const hardhatLocalChainNumber = 31337;

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    if (error instanceof TargetStackResolutionError) {
      console.error(error.message);
    } else {
      console.error(
        `\n[local-create-market] ${error instanceof Error ? error.message : error}`,
      );
    }
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const options = parseArgs(rawArgs);

  if (options.help) {
    printUsage();
    return;
  }

  if (options.preview) {
    const generatedMarket = await buildGeneratedMarket(options.kind, new Set());
    console.log(
      JSON.stringify(
        {
          graduationSeconds: generatedMarket.graduationSeconds,
          kind: generatedMarket.kind,
          metadata: generatedMarket.metadata,
          resolutionSeconds: generatedMarket.resolutionSeconds,
        },
        null,
        2,
      ),
    );
    return;
  }

  const bypassRegistry =
    options.envFile !== undefined || options.apiBaseUrl !== undefined;
  const target = bypassRegistry
    ? undefined
    : await resolveRegisteredStack(options);
  const envFile =
    target?.envFilePath ??
    options.envFile ??
    resolvePath(process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ?? defaultEnvFile);
  const envFileExists = existsSync(envFile);
  const fileEnv = envFileExists ? readEnvFile(envFile) : {};
  const commandEnv: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };
  const rpcFallbackUrl = `http://127.0.0.1:${target?.chainPort ?? BASE_CHAIN_PORT}`;

  validateLocalEnv(commandEnv, envFile, envFileExists);
  await validateLocalDeployment(commandEnv, envFile, rpcFallbackUrl);
  ensureDependenciesInstalled();

  const apiBaseUrl = resolveIndexerApiBaseUrl(
    target ? `http://127.0.0.1:${target.apiPort}` : options.apiBaseUrl,
    commandEnv,
  );
  const usedOptionKeys = await readExistingGeneratedMarketOptions({
    apiBaseUrl,
    chainId: hardhatLocalChainNumber,
  });
  const generatedMarket = await buildGeneratedMarket(
    options.kind,
    usedOptionKeys,
  );

  commandEnv.LOCAL_MARKET_METADATA = serializeMetadata(
    generatedMarket.metadata,
  );
  commandEnv.LOCAL_MARKET_GRADUATION_SECONDS = String(
    generatedMarket.graduationSeconds,
  );
  commandEnv.LOCAL_MARKET_RESOLUTION_SECONDS = String(
    generatedMarket.resolutionSeconds,
  );

  if (envFileExists) {
    console.log(`[local-create-market] loading ${envFile}`);
  }

  console.log(`[local-create-market] generated ${generatedMarket.kind} market`);
  console.log(
    `[local-create-market] question: ${generatedMarket.metadata.question}`,
  );
  console.log(
    `[local-create-market] resolution source: ${
      generatedMarket.metadata.resolutionUrl ?? "none"
    }`,
  );

  const output = await run(
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    {
      env: commandEnv,
    },
  );
  const market = parseSmokeMarket(output.stdout);

  try {
    await persistMarketMetadata({
      apiBaseUrl,
      chainId: market.chainId,
      metadata: generatedMarket.metadata,
      metadataHash: market.metadataHash,
    });
    console.log(`[local-create-market] metadata saved to ${apiBaseUrl}`);
  } catch (error) {
    console.warn(
      `[local-create-market] metadata sync failed: ${getErrorMessage(error)}`,
    );
  }
}

async function resolveRegisteredStack(
  options: CliOptions,
): Promise<StackDescriptor> {
  const live = await pruneDeadDescriptors();
  return resolveTargetStack({
    liveStacks: live,
    token: options.stack ?? process.env.POPCHARTS_STACK,
    chooseStack: process.stdin.isTTY ? promptForStack : undefined,
  });
}

async function validateLocalDeployment(
  env: NodeJS.ProcessEnv,
  envFile: string,
  rpcFallbackUrl: string,
): Promise<void> {
  const rpcUrl = env.RPC_HTTP_URL ?? rpcFallbackUrl;
  const managerAddress = env.PREGRAD_MANAGER_ADDRESS;
  const chainId = await rpc(rpcUrl, "eth_chainId", [], envFile);

  if (chainId !== hardhatLocalChainId) {
    throw new Error(
      `RPC_HTTP_URL=${rpcUrl} reported chain ID ${formatChainId(
        chainId,
      )}, but local-create-market expects Hardhat localhost chain 31337. ` +
        staleStackRecovery(envFile, rpcUrl),
    );
  }

  const managerCode = await rpc(
    rpcUrl,
    "eth_getCode",
    [managerAddress, "latest"],
    envFile,
  );

  if (!managerCode || managerCode === "0x") {
    throw new Error(
      `No contract code exists at PREGRAD_MANAGER_ADDRESS=${managerAddress} ` +
        `on ${rpcUrl}. ` +
        staleStackRecovery(envFile, rpcUrl),
    );
  }

  const probe = await rpcResult(
    rpcUrl,
    "eth_call",
    [
      {
        data: MARKET_COUNT_SELECTOR,
        to: managerAddress,
      },
      "latest",
    ],
    envFile,
  );

  if (probe.error) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} on ${rpcUrl} does not ` +
        "look like the current local PregradManager deployment " +
        `(marketCount() failed: ${probe.error.message}). ` +
        staleStackRecovery(envFile, rpcUrl),
    );
  }

  if (!isUint256Word(probe.result)) {
    throw new Error(
      `PREGRAD_MANAGER_ADDRESS=${managerAddress} on ${rpcUrl} returned an ` +
        `unexpected marketCount() value (${probe.result}). ` +
        staleStackRecovery(envFile, rpcUrl),
    );
  }
}

/** Parses local-create-market command-line arguments. */
export function parseArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const options: CliOptions = {
    apiBaseUrl: undefined,
    envFile: undefined,
    help: false,
    kind: "random",
    preview: false,
    stack: env.POPCHARTS_STACK,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--preview") {
      options.preview = true;
    } else if (arg === "--local-chain-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--local-chain-env requires a path.");
      }
      options.envFile = resolvePath(value);
      index += 1;
    } else if (arg.startsWith("--local-chain-env=")) {
      options.envFile = resolvePath(arg.slice("--local-chain-env=".length));
    } else if (arg === "--api-url") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--api-url requires a URL.");
      }
      options.apiBaseUrl = value;
      index += 1;
    } else if (arg.startsWith("--api-url=")) {
      options.apiBaseUrl = arg.slice("--api-url=".length);
    } else if (arg === "--stack") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--stack requires a slot or instance id.");
      }
      options.stack = value;
      index += 1;
    } else if (arg.startsWith("--stack=")) {
      options.stack = arg.slice("--stack=".length);
    } else if (arg === "--kind") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--kind requires crypto, weather, or random.");
      }
      options.kind = parseKind(value);
      index += 1;
    } else if (arg.startsWith("--kind=")) {
      options.kind = parseKind(arg.slice("--kind=".length));
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`Usage: pnpm run local:create-market -- [options]

Create one local market against the currently running local development chain.
By default, the helper randomly generates a near-term crypto or weather market
from live public sources, creates it onchain, then saves matching metadata to
the local API.

Options:
  --api-url <url>          Save generated metadata to this API base URL.
                            Defaults to POPCHARTS_INDEXER_API_URL, then
                            http://127.0.0.1:$LOCAL_API_PORT.
  --kind <kind>            Generate crypto, weather, or random.
                            Defaults to random.
  --local-chain-env <path>  Load a generated local-chain env file.
                            Explicit use bypasses stack registry resolution.
  --stack <slot|id>         Choose a running stack by slot or instance id.
                            Defaults to POPCHARTS_STACK; with multiple stacks,
                            interactive terminals prompt when neither is set.
  --preview                 Print generated metadata JSON without creating a market.
  -h, --help                Show this help.

Start the local stack first with 'just local-dev-control' or 'just local-dev'.`);
}

function parseKind(value: string): GeneratedMarketKind | "random" {
  if (value === "random" || isGeneratedMarketKind(value)) {
    return value;
  }

  throw new Error("--kind must be crypto, weather, or random.");
}

function isGeneratedMarketKind(value: string): value is GeneratedMarketKind {
  return (generatedMarketKinds as readonly string[]).includes(value);
}

async function buildGeneratedMarket(
  kind: GeneratedMarketKind | "random",
  usedOptionKeys: ReadonlySet<string>,
): Promise<GeneratedMarket> {
  const allOptions = buildGeneratedMarketOptions(kind);
  const filteredOptions = filterUnusedGeneratedMarketOptions(
    allOptions,
    usedOptionKeys,
  );
  const errors: string[] = [];

  if (filteredOptions.exhausted) {
    console.log(
      `[local-create-market] all ${filteredOptions.totalCount} ` +
        `${formatOptionScope(kind)} option(s) already exist; allowing a duplicate`,
    );
  } else if (filteredOptions.unusedCount < filteredOptions.totalCount) {
    console.log(
      `[local-create-market] choosing from ${filteredOptions.unusedCount}/` +
        `${filteredOptions.totalCount} unused ${formatOptionScope(kind)} option(s)`,
    );
  }

  for (const option of shuffle([...filteredOptions.options])) {
    try {
      if (option.kind === "crypto") {
        return await buildCryptoMarket(option);
      }

      if (option.kind === "weather") {
        return await buildWeatherMarket(option);
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
): readonly GeneratedMarketOption[] {
  const options: GeneratedMarketOption[] = [];

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
          key: generatedMarketOptionKey("weather", station.stationId, direction),
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

async function buildCryptoMarket(
  option: CryptoMarketOption,
): Promise<GeneratedMarket> {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const { asset, direction } = option;
  const prices = await fetchJson(spotPriceSourceUrl);
  const price = readSpotPrice(prices, asset.id);
  const threshold = formatUsd(price);
  const metadata: MarketMetadata = {
    category: "Crypto",
    createdAt: now.toISOString(),
    description:
      `Auto-generated local-dev market using the live ${asset.symbol}/USD ` +
      `spot price as its threshold.`,
    question:
      `Will ${asset.symbol}/USD be ${direction} than ${threshold} at ` +
      `${formatUtc(resolutionAt)}?`,
    resolutionCriteria:
      `Resolve YES if the linked spot-price source reports ${asset.symbol}/USD ` +
      `strictly ${direction} than ${threshold} at or immediately after ` +
      `${formatUtc(resolutionAt)}. If no reading is available at that moment, ` +
      `use the first reading from the same source within 15 minutes after the ` +
      `resolution time. Ties resolve NO.`,
    resolutionUrl: spotPriceSourceUrl,
    version: 1,
  };

  return {
    graduationSeconds: localMarketGraduationSeconds,
    kind: "crypto",
    metadata,
    resolutionSeconds: localMarketResolutionSeconds,
  };
}

async function buildWeatherMarket(
  option: WeatherMarketOption,
): Promise<GeneratedMarket> {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const { direction, station } = option;
  const forecast = await fetchForecastWindow(station, now, resolutionAt);
  const threshold = Math.round(forecast.highFahrenheit);
  const observationUrl = buildObservationUrl(station.stationId);
  const metadata: MarketMetadata = {
    category: "Weather",
    createdAt: now.toISOString(),
    description:
      `Auto-generated local-dev market using the max hourly forecast for ` +
      `${station.name} over the next two hours as its threshold. Forecast ` +
      `source: ${forecast.sourceUrl}`,
    question:
      `Will the max ${station.city} METAR temperature be ${direction} than ` +
      `${threshold}°F by ${formatUtc(resolutionAt)}?`,
    resolutionCriteria:
      `Resolve YES if any decoded ${station.stationId} METAR observation with ` +
      `an observation time after ${formatUtc(now)} and at or before ` +
      `${formatUtc(resolutionAt)} reports a temperature strictly ${direction} ` +
      `than ${threshold}°F. Convert decoded Celsius METAR temperatures to ` +
      `Fahrenheit before comparison. If the window has no valid reports, use ` +
      `the first valid report from the same source within 30 minutes after the ` +
      `resolution time. Ties resolve NO.`,
    resolutionUrl: observationUrl,
    version: 1,
  };

  return {
    graduationSeconds: localMarketGraduationSeconds,
    kind: "weather",
    metadata,
    resolutionSeconds: localMarketResolutionSeconds,
  };
}

async function readExistingGeneratedMarketOptions({
  apiBaseUrl,
  chainId,
}: {
  readonly apiBaseUrl: string;
  readonly chainId: number;
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
        `[local-create-market] found ${optionKeys.size} generated option(s) ` +
          "already represented in existing markets",
      );
    }

    return optionKeys;
  } catch (error) {
    console.warn(
      `[local-create-market] could not check existing markets for duplicates: ` +
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
  const url = new URL("markets", ensureTrailingSlash(apiBaseUrl));
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

async function fetchForecastWindow(
  station: WeatherStation,
  start: Date,
  end: Date,
): Promise<{ highFahrenheit: number; sourceUrl: string }> {
  const pointUrl = new URL(
    `${station.latitude.toFixed(4)},${station.longitude.toFixed(4)}`,
    forecastPointSourceUrl,
  );
  const point = await fetchJson(pointUrl, { weather: true });
  const forecastUrl = readString(point, ["properties", "forecastHourly"]);
  const forecast = await fetchJson(forecastUrl, { weather: true });
  const periods = readArray(forecast, ["properties", "periods"]);
  const matchingPeriods = periods.filter((period) =>
    forecastPeriodOverlaps(period, start, end),
  );
  const temperatures = matchingPeriods.map(readForecastTemperature);
  const validTemperatures = temperatures.filter(
    (value): value is number => value !== null,
  );

  if (validTemperatures.length === 0) {
    throw new Error(
      `No hourly forecast temperatures found for ${station.name}.`,
    );
  }

  return {
    highFahrenheit: Math.max(...validTemperatures),
    sourceUrl: forecastUrl,
  };
}

function forecastPeriodOverlaps(
  value: unknown,
  start: Date,
  end: Date,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const startTime = parseDate(value.startTime);
  const endTime = parseDate(value.endTime);

  if (!startTime || !endTime) {
    return false;
  }

  return (
    startTime.getTime() < end.getTime() && endTime.getTime() > start.getTime()
  );
}

function readForecastTemperature(value: unknown): number | null {
  if (!isRecord(value) || typeof value.temperature !== "number") {
    return null;
  }

  if (value.temperatureUnit === "F") {
    return value.temperature;
  }

  if (value.temperatureUnit === "C") {
    return celsiusToFahrenheit(value.temperature);
  }

  return null;
}

function serializeMetadata(metadata: MarketMetadata): string {
  // Key order is stable so the serialized metadata (and therefore its hash)
  // is reproducible for the same generated market.
  const ordered: Record<string, unknown> = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionSources?.length) {
    ordered.resolutionSources = metadata.resolutionSources;
  }
  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

async function persistMarketMetadata(args: {
  readonly apiBaseUrl: string;
  readonly chainId: number;
  readonly metadata: MarketMetadata;
  readonly metadataHash: string;
}): Promise<void> {
  const { apiBaseUrl, chainId, metadata, metadataHash } = args;
  const response = await fetch(
    new URL(`markets/${chainId}/metadata`, ensureTrailingSlash(apiBaseUrl)),
    {
      body: JSON.stringify({
        category: metadata.category,
        createdAt: metadata.createdAt,
        description: metadata.description,
        metadataHash,
        question: metadata.question,
        resolutionCriteria: metadata.resolutionCriteria,
        ...(metadata.resolutionSources?.length
          ? { resolutionSources: metadata.resolutionSources }
          : {}),
        ...(metadata.resolutionUrl
          ? { resolutionUrl: metadata.resolutionUrl }
          : {}),
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(sourceTimeoutMs),
    },
  );

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  throw new Error(
    `POST ${response.url} returned ${response.status}${
      body ? `: ${body.slice(0, 240)}` : ""
    }`,
  );
}

async function fetchJson(
  url: string | URL,
  options: { readonly weather?: boolean } = {},
): Promise<unknown> {
  const headers = {
    accept: options.weather
      ? "application/geo+json, application/json"
      : "application/json",
    ...(options.weather ? { "user-agent": sourceUserAgent } : {}),
  };
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(sourceTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`GET ${response.url} returned ${response.status}.`);
  }

  return response.json();
}

function readSpotPrice(value: unknown, assetId: string): number {
  if (!isRecord(value) || !isRecord(value[assetId])) {
    throw new Error(`Spot price response did not include ${assetId}.`);
  }

  const price = (value[assetId] as Record<string, unknown>).usd;

  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Spot price for ${assetId} was not a positive number.`);
  }

  return price;
}

function buildObservationUrl(stationId: string): string {
  const url = new URL(observationSourceUrl);
  url.searchParams.set("ids", stationId);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", "4");
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function readString(value: unknown, path: readonly string[]): string {
  const current = readPath(value, path);

  if (typeof current !== "string" || current.trim().length === 0) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}

function readArray(value: unknown, path: readonly string[]): unknown[] {
  const current = readPath(value, path);

  if (!Array.isArray(current)) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}

function readPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, value);
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}

function formatUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[otherIndex]] = [values[otherIndex], values[index]];
  }

  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

function ensureDependenciesInstalled(): void {
  if (existsSync(resolve(protocolDir, "node_modules"))) {
    return;
  }

  throw new Error(
    "Missing protocol/node_modules. Run 'just setup' before 'just local-create-market'.",
  );
}

function validateLocalEnv(
  env: NodeJS.ProcessEnv,
  envFile: string,
  envFileExists: boolean,
): void {
  const missing: string[] = [];

  if (!env.PREGRAD_MANAGER_ADDRESS) {
    missing.push("PREGRAD_MANAGER_ADDRESS");
  }

  if (!env.LOCAL_COLLATERAL_ADDRESS && !env.COLLATERAL_ADDRESS) {
    missing.push("LOCAL_COLLATERAL_ADDRESS");
  }

  if (missing.length === 0) {
    return;
  }

  const source = envFileExists
    ? `${envFile} is missing ${missing.join(", ")}`
    : `Missing ${envFile}`;

  throw new Error(
    `${source}. Start the local stack with 'just local-dev-control' or ` +
      "'just local-dev', wait for contract deployment to complete, then run " +
      "'just local-create-market' again.",
  );
}

function resolvePath(path: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function rpc(
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
  envFile: string = defaultEnvFile,
): Promise<unknown> {
  const response = await rpcResult(rpcUrl, method, params, envFile);

  if (response.error) {
    throw new Error(
      `RPC ${method} failed on ${rpcUrl}: ${response.error.message}`,
    );
  }

  return response.result;
}

async function rpcResult(
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
  envFile: string = defaultEnvFile,
): Promise<RpcResponse> {
  let httpResponse: Response;

  try {
    httpResponse = await fetch(rpcUrl, {
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method,
        params,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
  } catch (error) {
    throw new Error(
      `Cannot reach local RPC at ${rpcUrl}. ${staleStackRecovery(
        envFile,
        rpcUrl,
      )} (${getErrorMessage(error)})`,
    );
  }

  if (!httpResponse.ok) {
    throw new Error(
      `RPC ${method} failed on ${rpcUrl}: HTTP ${httpResponse.status}.`,
    );
  }

  return (await httpResponse.json()) as RpcResponse;
}

function staleStackRecovery(envFile: string, rpcUrl: string): string {
  return (
    `${envFile} and the running RPC are probably out of sync. ` +
    `Stop the stale Hardhat node on ${rpcUrl}, then run ` +
    "'just local-dev-control' or 'just local-dev' from this checkout and " +
    "wait for contract deployment to complete. To find the process, run " +
    "'lsof -nP -iTCP:8545 -sTCP:LISTEN'."
  );
}

// The protocol helper's output streams through unprefixed (the developer is
// watching one command, not a multi-service stack) while stdout is captured
// for the LOCAL_CHAIN_SMOKE_MARKET marker.
async function run(
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ stderr: string; stdout: string }> {
  const child = spawn(command, [...args], {
    cwd: repoRoot,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });

  const code = await new Promise<number>((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}.`,
    );
  }

  return { stderr, stdout };
}
