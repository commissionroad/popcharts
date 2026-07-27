import { addSeconds, formatUtc } from "../time/utcTime.ts";
import { fetchForecastWindow } from "./forecastWindow.ts";
import {
  localMarketGraduationSeconds,
  localMarketResolutionSeconds,
  type GeneratedMarket,
  type MarketMetadata,
} from "./generatedMarket.ts";
import type { GeneratedMarketDirection } from "./generatedMarketOptions.ts";

/**
 * A weather station a generated market can be written about: the coordinates
 * its forecast is read at, and the METAR station its resolution is read from.
 */
export type WeatherStation = {
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string;
  readonly stationId: string;
};

/** One weather market the generator may build: a station and a direction. */
export type WeatherMarketOption = {
  readonly direction: GeneratedMarketDirection;
  readonly key: string;
  readonly kind: "weather";
  readonly station: WeatherStation;
};

/**
 * The stations generated weather markets are written about. `city` is what the
 * question says and is how a generated question is recognized again later, so
 * it stays stable once markets exist that quote it.
 */
export const weatherStations: readonly WeatherStation[] = [
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

const observationSourceUrl = "https://aviationweather.gov/api/data/metar";

/**
 * Builds a weather market whose threshold is the station's own forecast high
 * over the market's window, so the generated market is a genuine coin flip
 * against the observations that will settle it. Forecast and resolution come
 * from different sources deliberately: the forecast sets the threshold, decoded
 * METAR observations resolve it. Throws when the forecast has no usable
 * temperature for the window, so the caller can try another option.
 */
export async function buildWeatherMarket(
  option: WeatherMarketOption,
): Promise<GeneratedMarket> {
  const now = new Date();
  const resolutionAt = addSeconds(now, localMarketResolutionSeconds);
  const { direction, station } = option;
  const forecast = await fetchForecastWindow({
    end: resolutionAt,
    location: station,
    start: now,
  });
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

function buildObservationUrl(stationId: string): string {
  const url = new URL(observationSourceUrl);
  url.searchParams.set("ids", stationId);
  url.searchParams.set("format", "json");
  url.searchParams.set("hours", "4");
  return url.toString();
}
