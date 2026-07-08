/**
 * Structured context attached to a logged error: the operation that failed and
 * any identifiers that help us find it later (market id, wallet address, etc.).
 * Never put secrets here — context is logged verbatim.
 */
export type ErrorLogContext = Record<string, unknown>;

/**
 * A pluggable destination for logged errors beyond the console. Wire a real
 * telemetry service (Sentry, Logtail, a `/api/telemetry` route, ...) by calling
 * `setErrorTransport`; the default is `null`, so the app ships with
 * console-only logging and no external dependency.
 */
export type ErrorTransport = (entry: {
  context: ErrorLogContext;
  error: unknown;
}) => void;

let transport: ErrorTransport | null = null;

/**
 * Installs (or, with `null`, removes) the transport that receives every logged
 * error in addition to the console. Call once at app startup to forward errors
 * to a logging service.
 */
export function setErrorTransport(next: ErrorTransport | null) {
  transport = next;
}

/**
 * Records a caught error. Always writes the raw error and its context to the
 * console so failures are visible in development and captured by the runtime
 * console in production, then forwards to the configured transport. A throwing
 * transport is swallowed: logging must never break the surface it is reporting
 * on.
 *
 * This is the capture half of the "log the real error, show the user friendly
 * copy" split — see `presentError` in `error-handling.ts`.
 */
export function logError(error: unknown, context: ErrorLogContext = {}): void {
  // Deliberate: this is the app's single sanctioned error-logging seam.
  console.error("[popcharts] error", error, context);

  if (transport) {
    try {
      transport({ context, error });
    } catch {
      // A logging sink must never take down the app it is observing.
    }
  }
}
