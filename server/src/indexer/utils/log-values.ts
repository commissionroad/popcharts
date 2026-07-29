/**
 * Every field on a viem `Log` is optional — the type has to cover pending logs
 * and events whose ABI decode produced nothing — so a handler must narrow each
 * field it reads off a log before persisting it.
 *
 * `logValueRequirer` binds one handler's log name into that guard, so a decode
 * failure names the stream it came from ("MarketCreated log is missing
 * marketId.") rather than just the field. A generic message would leave a
 * production stack trace pointing at this module for all of them.
 */
export function logValueRequirer(logLabel: string) {
  return function requireValue<T>(
    value: T | null | undefined,
    name: string,
  ): T {
    if (value === null || value === undefined) {
      throw new Error(`${logLabel} is missing ${name}.`);
    }

    return value;
  };
}
