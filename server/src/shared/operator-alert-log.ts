/**
 * The log-record contract between a service that raises an operator-severity
 * event and the CloudWatch metric filter that pages on it (repo ADR 0024
 * phase 5). This module is the single definition of the marker terms both
 * sides key on: `infra/` imports it by relative path rather than mirroring the
 * literals, because `infra/` is a separate pnpm workspace with its own
 * lockfile and cannot depend on the server package. Keep it dependency-free
 * and free of `src/*` path aliases so both loaders (bun in `server/`, tsx in
 * `infra/`) can read it.
 */

/**
 * Leading token on every operator-alert record. Deliberately unlike anything
 * the services log routinely, so a metric filter keyed on it cannot be tripped
 * by ordinary chatter that happens to mention the same event name.
 */
export const OPERATOR_ALERT_MARKER = "POPCHARTS_OPERATOR_ALERT";

/**
 * Second token on the record: which operator page this is. One alarm per tag,
 * so a new tag is a new alarm rather than a wider one.
 */
export const OPERATOR_ALERT_EVENTS = {
  /** A bonded dispute froze a graduated market until a human settles it. */
  resolutionDisputed: "resolution_disputed",
} as const;

/** Tag of a single operator page; the value half of `OPERATOR_ALERT_EVENTS`. */
export type OperatorAlertEvent =
  (typeof OPERATOR_ALERT_EVENTS)[keyof typeof OPERATOR_ALERT_EVENTS];

/**
 * Renders one operator-alert log line: the two marker terms the metric filter
 * matches, then a JSON object carrying everything an operator needs to act
 * without going back to the chain. `detail` takes no bigints — uint256 values
 * must be stringified by the caller, since `JSON.stringify` throws on them.
 */
export function formatOperatorAlert(
  event: OperatorAlertEvent,
  detail: Readonly<Record<string, string | number>>,
): string {
  return `${OPERATOR_ALERT_MARKER} ${event} ${JSON.stringify(detail)}`;
}
