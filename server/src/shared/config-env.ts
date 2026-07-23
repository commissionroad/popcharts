/**
 * Env-value parsing shared by the AI service and runner configs. Every helper
 * takes the raw env value rather than the variable name, so callers can read
 * from any env record and tests never have to mutate `process.env`.
 *
 * Two families, split on what an invalid value means:
 * - Strict readers (`readPositiveInteger`, `readBoolean`) throw an error
 *   naming the variable — runner knobs, where a malformed value is an
 *   operator mistake that must surface at startup.
 * - `...OrFallback` readers never throw — service knobs, whose documented
 *   contract is to boot on defaults rather than crash on a bad value.
 */

/**
 * Strict positive-integer knob: unset/empty returns the fallback; anything
 * else must parse to a safe integer > 0 or the reader throws an error naming
 * the offending variable.
 */
export function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Strict boolean knob: unset/blank returns the fallback; otherwise accepts
 * only true/1/false/0 (case-insensitive, trimmed) and throws an error naming
 * the offending variable for anything else.
 */
export function readBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string,
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

/**
 * Lenient positive-integer knob: returns the parsed value only when it is a
 * safe integer > 0, and the fallback for anything else (unset, malformed,
 * zero, negative). Never throws.
 */
export function readPositiveIntegerOrFallback(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Lenient non-negative-integer knob: like `readPositiveIntegerOrFallback` but
 * admits 0, for budgets where zero means "disabled". Never throws.
 */
export function readNonNegativeIntegerOrFallback(
  value: string | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Lenient boolean knob: unset/empty returns the fallback; otherwise true only
 * for the exact strings "true" or "1" — any other value reads as false (not
 * the fallback). Never throws.
 */
export function readBooleanOrFallback(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (!value) {
    return fallback;
  }

  return value === "true" || value === "1";
}

/**
 * Lenient string-enum knob: returns the value only when it is one of
 * `allowed`, and the fallback for anything else (unset, empty, unknown).
 * Never throws. Pass the const array that defines the enum's union type so
 * the accepted set has exactly one definition.
 */
export function readEnumOrFallback<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Normalizes a service base URL: unset/blank returns the fallback; otherwise
 * trims whitespace and strips all trailing slashes so callers can append
 * paths without producing `//`.
 */
export function normalizeServiceUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/, "");
}
