/**
 * Scenario-side client for the orchestrator's stack-control server. The
 * infrastructure-drill scenarios bounce supervised services (indexer, AI
 * services) through this HTTP surface rather than touching process lifecycles
 * themselves — the orchestrator owns every service, and PID hunting from the
 * scenario process would be slot-ambiguous. The control URL is injected by
 * scripts/local-lifecycle-nightly.ts as POPCHARTS_LIFECYCLE_CONTROL_URL.
 */

/** Services the orchestrator registers as bounce-able. */
export type ControllableService =
  "indexer" | "keeper" | "ai-review" | "ai-resolution";

type ControlAction = "stop" | "start" | "restart";

function controlBaseUrl(): string {
  const url = process.env.POPCHARTS_LIFECYCLE_CONTROL_URL;
  if (!url) {
    throw new Error(
      "POPCHARTS_LIFECYCLE_CONTROL_URL is not set. The infrastructure-drill " +
        "scenarios need the stack-control server, which only " +
        "scripts/local-lifecycle-nightly.ts starts — run the suite through " +
        "`pnpm local:lifecycle-nightly`, not against a hand-booted stack.",
    );
  }
  return url;
}

async function control(
  service: ControllableService,
  action: ControlAction,
): Promise<void> {
  const response = await fetch(
    `${controlBaseUrl()}/services/${service}/${action}`,
    { method: "POST" },
  );
  if (!response.ok) {
    throw new Error(
      `stack control ${action} ${service} failed: ${response.status} ${(
        await response.text()
      ).slice(0, 300)}`,
    );
  }
}

/** Stops a supervised service (SIGTERM); no-op if already stopped. */
export function stopService(service: ControllableService): Promise<void> {
  return control(service, "stop");
}

/** (Re)starts a stopped service and waits for it to report ready. */
export function startService(service: ControllableService): Promise<void> {
  return control(service, "start");
}

/** Stops then starts a service, waiting for readiness. */
export function restartService(service: ControllableService): Promise<void> {
  return control(service, "restart");
}
