/** The instant `seconds` after `date`, leaving `date` untouched. */
export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/**
 * An ISO-8601 UTC timestamp without milliseconds, for text a human reads and a
 * resolver compares against a data source's own timestamps.
 */
export function formatUtc(date: Date): string {
  // Strips the three-digit millisecond field that `toISOString` always emits
  // immediately before the trailing `Z`; anchored so nothing earlier in the
  // timestamp can match.
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
