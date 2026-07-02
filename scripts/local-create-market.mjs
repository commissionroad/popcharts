#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolDir = resolve(repoRoot, "protocol");
const defaultEnvFile = resolve(repoRoot, "server", ".env.local-chain");
const generatedMarketKinds = ["crypto", "weather"];
const sourceTimeoutMs = 8_000;
const localMarketGraduationSeconds = 60 * 60;
const localMarketResolutionSeconds = 2 * 60 * 60;
const defaultApiPort = "3001";
const sourceUserAgent =
  "popcharts-local-create-market (local development helper)";
const spotPriceSourceUrl =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd";
const forecastPointSourceUrl = "https://api.weather.gov/points/";
const observationSourceUrl = "https://aviationweather.gov/api/data/metar";

const digitalAssets = [
  { id: "bitcoin", symbol: "BTC" },
  { id: "ethereum", symbol: "ETH" },
  { id: "solana", symbol: "SOL" },
];

const weatherStations = [
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

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

main().catch((error) => {
  console.error(`\n[local-create-market] ${error.message}`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(rawArgs);

  if (options.help) {
    printUsage();
    return;
  }

  if (options.preview) {
    if (options.metadataUri) {
      throw new Error("--preview cannot be combined with --metadata-uri.");
    }

    const generatedMarket = await buildGeneratedMarket(options.kind);
    console.log(
      JSON.stringify(
        {
          graduationSeconds: generatedMarket.graduationSeconds,
          kind: generatedMarket.kind,
          metadata: generatedMarket.metadata,
          metadataHash: generatedMarket.metadataHash,
          resolutionSeconds: generatedMarket.resolutionSeconds,
        },
        null,
        2,
      ),
    );
    return;
  }

  const envFile =
    options.envFile ??
    resolvePath(process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ?? defaultEnvFile);
  const envFileExists = existsSync(envFile);
  const fileEnv = envFileExists ? readEnvFile(envFile) : {};
  const commandEnv = { ...process.env, ...fileEnv };

  if (options.metadataUri) {
    commandEnv.LOCAL_MARKET_METADATA = options.metadataUri;
  }

  validateLocalEnv(commandEnv, envFile, envFileExists);
  ensureDependenciesInstalled();

  const generatedMarket = options.metadataUri
    ? null
    : await buildGeneratedMarket(options.kind);

  if (generatedMarket) {
    commandEnv.LOCAL_MARKET_METADATA_HASH = generatedMarket.metadataHash;
    commandEnv.LOCAL_MARKET_GRADUATION_SECONDS = String(
      generatedMarket.graduationSeconds,
    );
    commandEnv.LOCAL_MARKET_RESOLUTION_SECONDS = String(
      generatedMarket.resolutionSeconds,
    );
  }

  if (envFileExists) {
    console.log(`[local-create-market] loading ${envFile}`);
  }

  if (generatedMarket) {
    console.log(
      `[local-create-market] generated ${generatedMarket.kind} market`,
    );
    console.log(
      `[local-create-market] question: ${generatedMarket.metadata.question}`,
    );
    console.log(
      `[local-create-market] resolution source: ${
        generatedMarket.metadata.resolutionUrl ?? "none"
      }`,
    );
  }

  const output = await run(
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    {
      env: commandEnv,
    },
  );
  const market = parseLabeledJson(output.stdout, "LOCAL_CHAIN_SMOKE_MARKET");

  if (generatedMarket) {
    const apiBaseUrl = readApiBaseUrl(options, commandEnv);

    try {
      await persistMarketMetadata({
        apiBaseUrl,
        chainId: market.chainId,
        metadata: generatedMarket.metadata,
        metadataHash: generatedMarket.metadataHash,
      });
      console.log(`[local-create-market] metadata saved to ${apiBaseUrl}`);
    } catch (error) {
      console.warn(
        `[local-create-market] metadata sync failed: ${getErrorMessage(error)}`,
      );
    }
  }
}

function parseArgs(args) {
  const options = {
    apiBaseUrl: undefined,
    envFile: undefined,
    help: false,
    kind: "random",
    metadataUri: undefined,
    preview: false,
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
    } else if (arg === "--kind") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--kind requires crypto, weather, or random.");
      }
      options.kind = parseKind(value);
      index += 1;
    } else if (arg.startsWith("--kind=")) {
      options.kind = parseKind(arg.slice("--kind=".length));
    } else if (arg === "--metadata-uri") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--metadata-uri requires a value.");
      }
      options.metadataUri = value;
      index += 1;
    } else if (arg.startsWith("--metadata-uri=")) {
      options.metadataUri = arg.slice("--metadata-uri=".length);
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

function printUsage() {
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
                            Defaults to server/.env.local-chain.
  --metadata-uri <uri>      Override the metadata URI hashed into the market event.
                            Skips live metadata generation and API sync.
  --preview                 Print generated metadata JSON without creating a market.
  -h, --help                Show this help.

Start the local stack first with 'just local-dev-control' or 'just local-dev'.`);
}

function parseKind(value) {
  if (value === "random" || generatedMarketKinds.includes(value)) {
    return value;
  }

  throw new Error("--kind must be crypto, weather, or random.");
}

async function buildGeneratedMarket(kind) {
  const kinds = kind === "random" ? shuffle([...generatedMarketKinds]) : [kind];
  const errors = [];

  for (const nextKind of kinds) {
    try {
      if (nextKind === "crypto") {
        return await buildCryptoMarket();
      }

      if (nextKind === "weather") {
        return await buildWeatherMarket();
      }
    } catch (error) {
      errors.push(`${nextKind}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(
    `Could not generate a live local market. ${errors.join("; ")}`,
  );
}

async function buildCryptoMarket() {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const direction = choose(["higher", "lower"]);
  const asset = choose(digitalAssets);
  const prices = await fetchJson(spotPriceSourceUrl);
  const price = readSpotPrice(prices, asset.id);
  const threshold = formatUsd(price);
  const metadata = {
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

  return withMetadataHash({
    graduationSeconds: localMarketGraduationSeconds,
    kind: "crypto",
    metadata,
    resolutionSeconds: localMarketResolutionSeconds,
  });
}

async function buildWeatherMarket() {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const direction = choose(["higher", "lower"]);
  const station = choose(weatherStations);
  const forecast = await fetchForecastWindow(station, now, resolutionAt);
  const threshold = Math.round(forecast.highFahrenheit);
  const observationUrl = buildObservationUrl(station.stationId);
  const metadata = {
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

  return withMetadataHash({
    graduationSeconds: localMarketGraduationSeconds,
    kind: "weather",
    metadata,
    resolutionSeconds: localMarketResolutionSeconds,
  });
}

async function fetchForecastWindow(station, start, end) {
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
  const validTemperatures = temperatures.filter((value) => value !== null);

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

function forecastPeriodOverlaps(value, start, end) {
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

function readForecastTemperature(value) {
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

function withMetadataHash(generatedMarket) {
  return {
    ...generatedMarket,
    metadataHash: hashMetadata(generatedMarket.metadata),
  };
}

function hashMetadata(metadata) {
  return `0x${createHash("sha256").update(serializeMetadata(metadata)).digest("hex")}`;
}

function serializeMetadata(metadata) {
  const ordered = {
    version: metadata.version,
    question: metadata.question,
    description: metadata.description,
    category: metadata.category,
    resolutionCriteria: metadata.resolutionCriteria,
  };

  if (metadata.resolutionUrl) {
    ordered.resolutionUrl = metadata.resolutionUrl;
  }

  ordered.createdAt = metadata.createdAt;

  return JSON.stringify(ordered);
}

async function persistMarketMetadata({
  apiBaseUrl,
  chainId,
  metadata,
  metadataHash,
}) {
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

async function fetchJson(url, options = {}) {
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

function readSpotPrice(value, assetId) {
  if (!isRecord(value) || !isRecord(value[assetId])) {
    throw new Error(`Spot price response did not include ${assetId}.`);
  }

  const price = value[assetId].usd;

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Spot price for ${assetId} was not a positive number.`);
  }

  return price;
}

function readApiBaseUrl(options, env) {
  return (
    options.apiBaseUrl ??
    env.POPCHARTS_INDEXER_API_URL ??
    env.NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL ??
    `http://127.0.0.1:${env.LOCAL_API_PORT ?? env.PORT ?? defaultApiPort}`
  );
}

function parseLabeledJson(text, label) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`${label}=`)) {
      continue;
    }

    return JSON.parse(line.slice(label.length + 1));
  }

  throw new Error(`${label} was not emitted by the protocol helper.`);
}

function buildObservationUrl(stationId) {
  const url = new URL(observationSourceUrl);
  url.searchParams.set("ids", stationId);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", "4");
  return url.toString();
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function readString(value, path) {
  const current = readPath(value, path);

  if (typeof current !== "string" || current.trim().length === 0) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}

function readArray(value, path) {
  const current = readPath(value, path);

  if (!Array.isArray(current)) {
    throw new Error(`${path.join(".")} is missing from source response.`);
  }

  return current;
}

function readPath(value, path) {
  return path.reduce((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[key];
  }, value);
}

function parseDate(value) {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function celsiusToFahrenheit(value) {
  return (value * 9) / 5 + 32;
}

function formatUtc(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function formatUsd(value) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function choose(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function shuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[otherIndex]] = [values[otherIndex], values[index]];
  }

  return values;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Unknown error.";
}

function ensureDependenciesInstalled() {
  if (existsSync(resolve(protocolDir, "node_modules"))) {
    return;
  }

  throw new Error(
    "Missing protocol/node_modules. Run 'just setup' before 'just local-create-market'.",
  );
}

function validateLocalEnv(env, envFile, envFileExists) {
  const missing = [];

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

function readEnvFile(path) {
  const env = {};
  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = value;
  }

  return env;
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });

  const code = await new Promise((resolveCode, reject) => {
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
