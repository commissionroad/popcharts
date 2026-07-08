import type { ErrorLogContext } from "./error-logger";
import { logError } from "./error-logger";

export type GetErrorMessageOptions = {
  /**
   * Message returned when the error is unrecognized. This is the default the
   * user sees, so it must read as finished product copy — never a placeholder
   * or a stack fragment.
   */
  fallback: string;
  /**
   * Optional hook for surface-specific handling of an `Error`. Return a string
   * to use it as the message; return `undefined` to fall through to the shared
   * known-error copy and then the fallback.
   */
  matcher?: (error: Error) => string | undefined;
};

export type PresentErrorOptions = GetErrorMessageOptions & {
  /** Structured context forwarded to the logger (operation, ids, ...). */
  context?: ErrorLogContext;
};

/**
 * An error whose message is deliberately written for end users and is safe to
 * show verbatim — input validation ("Invalid resolutionTime."), business rules
 * ("You already placed this order."), and the like. `getErrorMessage` shows a
 * `DisplayableError`'s message as-is; every other error is treated as untrusted
 * and collapses to the caller's fallback. Throw this (not a plain `Error`) when
 * you want the user to read the exact message.
 */
export class DisplayableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisplayableError";
  }
}

/**
 * Cross-cutting error copy shared by every surface. These map low-level wallet,
 * RPC, and transport failures — which no single feature should have to
 * re-recognize — to friendly explanations. Kept deliberately conservative and
 * high-signal: a miss just yields the caller's fallback, never a raw message.
 */
const KNOWN_ERROR_COPY: { match: string[]; message: string }[] = [
  {
    // viem UserRejectedRequestError and wallet equivalents: the user dismissed
    // the signature or transaction prompt.
    match: [
      "User rejected",
      "User denied",
      "rejected the request",
      "denied transaction",
      "request was rejected",
    ],
    message: "Request cancelled in your wallet.",
  },
  {
    // RPC transaction gas cap / block gas limit: the transaction is too large
    // to be submitted (this is the graduated-market createOrder gas-cap case).
    match: ["gas cap", "exceeds block gas limit", "gas required exceeds"],
    message:
      "This transaction is too large for the network to accept right now. Try a smaller amount.",
  },
  {
    // Not enough native currency to cover gas.
    match: ["insufficient funds"],
    message:
      "Your wallet doesn't have enough funds to cover this transaction's network fee.",
  },
  {
    // Transport/network failures surfaced by viem or fetch.
    match: [
      "fetch failed",
      "Failed to fetch",
      "network request failed",
      "timed out",
      "timeout",
    ],
    message: "Network problem reaching the chain. Check your connection and try again.",
  },
];

function matchKnownErrorCopy(error: Error): string | undefined {
  return KNOWN_ERROR_COPY.find(({ match }) =>
    match.some((needle) => error.message.includes(needle))
  )?.message;
}

/**
 * Derives a user-facing message from an unknown thrown value, safe by default.
 * Resolution order: the surface-specific `matcher`, then a `DisplayableError`'s
 * own message (author-trusted), then the shared known-error copy, then the
 * `fallback`. A raw `error.message` is returned **only** for a
 * `DisplayableError` or when a `matcher` deliberately produces one —
 * unrecognized errors never leak their internals to the user.
 *
 * This is pure (no logging). Prefer `presentError` at catch sites so the real
 * error is also captured; use this directly only when the caller logs
 * separately.
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

  if (error instanceof DisplayableError) {
    return error.message;
  }

  return matchKnownErrorCopy(error) ?? fallback;
}

/**
 * The sanctioned way to turn a caught error into copy for the user: logs the
 * real error (with context) via `logError`, then returns the safe message from
 * `getErrorMessage`. Using this at every catch site keeps "what we capture" and
 * "what the user sees" from drifting apart.
 */
export function presentError(
  error: unknown,
  { context, fallback, matcher }: PresentErrorOptions
): string {
  logError(error, context);

  // Avoid passing `matcher: undefined` explicitly (exactOptionalPropertyTypes).
  return getErrorMessage(error, matcher ? { fallback, matcher } : { fallback });
}
