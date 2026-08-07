/**
 * The log-record contract between a service that raises an operator-severity
 * event and the CloudWatch metric filter that pages on it (repo ADR 0024
 * phase 5). This is the server's master of the marker terms; the alarm in
 * `infra/` holds its own copy, because `infra/` imports no workspace source
 * (`docs/architecture.md`). The two are kept honest by an assertion test in
 * `infra/test/`, which builds a record with `formatOperatorAlert` and fails if
 * the synthesized filter's terms no longer occur in it — so changing anything
 * here about how the marker terms are rendered will fail infra's lane, not
 * silently unbuild the page.
 *
 * Keep this module dependency-free and free of `src/*` path aliases: that
 * test loads it under tsx rather than bun.
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
  /**
   * A status-projecting event reached a market whose status is neither a valid
   * predecessor nor already at or past the target. The projection throws, and
   * the throw abandons the sweep it was running under, wedging at least that
   * contract's whole cursor group — up to every contract that watcher follows —
   * until a human intervenes.
   */
  marketStatusOutOfOrder: "market_status_out_of_order",
  /** A bonded dispute froze a graduated market until a human settles it. */
  resolutionDisputed: "resolution_disputed",
  /**
   * A proposal landed for the OPPOSITE side of the AI's recorded pending
   * judgment, which is now superseded (ADR 0026): the market is resolving
   * against what the AI concluded — exactly when a human should look.
   */
  resolutionSuperseded: "resolution_superseded",
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
