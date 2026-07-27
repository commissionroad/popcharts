import {
  isRecord,
  readJsonArray,
  readJsonString,
} from "../json/readJsonPath.ts";
import { fetchJson } from "../net/fetchJson.ts";

/** The location a forecast is read at — everything the source needs, no more. */
export type ForecastLocation = {
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string;
};

const forecastPointSourceUrl = "https://api.weather.gov/points/";

/**
 * The highest hourly forecast temperature covering `start`..`end`, in
 * Fahrenheit, along with the forecast URL it came from so a generated market
 * can cite its own threshold's source. Throws when the window has no usable
 * temperature rather than returning a guess: the caller falls back to a
 * different market option.
 */
export async function fetchForecastWindow({
  end,
  location,
  start,
}: {
  readonly end: Date;
  readonly location: ForecastLocation;
  readonly start: Date;
}): Promise<{ highFahrenheit: number; sourceUrl: string }> {
  const pointUrl = new URL(
    `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`,
    forecastPointSourceUrl,
  );
  const point = await fetchJson(pointUrl, { weather: true });
  const forecastUrl = readJsonString(point, ["properties", "forecastHourly"]);
  const forecast = await fetchJson(forecastUrl, { weather: true });
  const periods = readJsonArray(forecast, ["properties", "periods"]);
  const matchingPeriods = periods.filter((period) =>
    forecastPeriodOverlaps({ end, start, value: period }),
  );
  const temperatures = matchingPeriods.map(readForecastTemperature);
  const validTemperatures = temperatures.filter(
    (value): value is number => value !== null,
  );

  if (validTemperatures.length === 0) {
    throw new Error(
      `No hourly forecast temperatures found for ${location.name}.`,
    );
  }

  return {
    highFahrenheit: Math.max(...validTemperatures),
    sourceUrl: forecastUrl,
  };
}

function forecastPeriodOverlaps({
  end,
  start,
  value,
}: {
  readonly end: Date;
  readonly start: Date;
  readonly value: unknown;
}): boolean {
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

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function celsiusToFahrenheit(value: number): number {
  return (value * 9) / 5 + 32;
}
