/**
 * Converts an on-chain unix-seconds timestamp (uint64/uint256 in a log or a
 * view return) into the millisecond `Date` the schema's timestamp columns
 * store. The one place the seconds→milliseconds unit conversion lives, so a
 * handler can never quietly drop the factor.
 */
export function unixSecondsToDate(value: bigint): Date {
  return new Date(Number(value) * 1000);
}
