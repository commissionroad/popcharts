export type GetErrorMessageOptions = {
  /** Message returned when the value is not an `Error` (or when the matcher says so). */
  fallback: string;
  /**
   * Optional hook for domain-specific handling of an `Error`. Return a string
   * to use it as the message; return `undefined` to fall through to
   * `error.message`.
   */
  matcher?: (error: Error) => string | undefined;
};

/**
 * Extracts a user-facing message from an unknown thrown value. Non-`Error`
 * values yield the fallback; `Error` values yield `error.message` verbatim
 * (including an empty string) unless the matcher overrides it. Callers that
 * want to treat an empty message as missing express that via the matcher.
 */
export function getErrorMessage(
  error: unknown,
  { fallback, matcher }: GetErrorMessageOptions
): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const matched = matcher?.(error);

  if (matched !== undefined) {
    return matched;
  }

  return error.message;
}
