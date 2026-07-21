import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { waitFor } from "../wait/waitFor.ts";
import type {
  ProcessSupervisor,
  SupervisedProcess,
} from "./processSupervisor.ts";

/**
 * Cross-process service control for the lifecycle nightly stack. The
 * orchestrator owns every service as a supervised child, but the scenario
 * runner is a separate process, so the infrastructure-drill scenarios
 * (indexer restart, AI-service outage) reach the supervisor through a tiny
 * localhost HTTP surface instead of hunting PIDs — which would be
 * slot-ambiguous and could kill another stack's service. Process ownership
 * stays entirely in the orchestrator; the scenario only expresses intent.
 */

/** A single service the control surface can bounce. */
export type ServiceController = {
  /** Stops the service if it is running; a no-op if already stopped. */
  stop: () => Promise<void>;
  /** (Re)starts the service and waits for it to report ready. */
  start: () => Promise<void>;
  /** Stops then starts, waiting for readiness. */
  restart: () => Promise<void>;
};

type ControllerAction = keyof ServiceController;
const CONTROLLER_ACTIONS: readonly ControllerAction[] = [
  "stop",
  "start",
  "restart",
];

/** How to (re)start one supervised service and confirm it is ready again. */
export type SupervisedServiceSpec = {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  /** Resolves truthy once the freshly started service is serving. */
  readonly waitReady: () => Promise<boolean>;
  /**
   * Runs before each (re)start — e.g. delete the indexer health marker so a
   * restart proves the marker was re-written after catch-up, not left over.
   */
  readonly beforeStart?: () => void | Promise<void>;
  readonly readyTimeoutMs?: number;
};

/**
 * Builds a controller over one supervised service. The controller owns the
 * live handle (booting the service the same way it restarts it, so both paths
 * share the beforeStart + readiness logic); each start replaces the tracked
 * child so the supervisor still owns the current process and tears it down at
 * shutdown.
 */
export function createSupervisedController(
  supervisor: ProcessSupervisor,
  spec: SupervisedServiceSpec,
): ServiceController {
  let handle: SupervisedProcess | null = null;
  const readyTimeoutMs = spec.readyTimeoutMs ?? 45_000;

  const isRunning = () => handle !== null && !handle.exited;

  async function confirmReady(): Promise<void> {
    await waitFor(`${spec.name} ready`, spec.waitReady, {
      // Fail fast if the just-started child dies during its readiness wait
      // instead of timing out with stale context.
      ensure: () => {
        if (!isRunning()) {
          throw new Error(
            `${spec.name} exited during startup (code ${handle?.code ?? "?"}).`,
          );
        }
      },
      timeoutMs: readyTimeoutMs,
    });
  }

  async function stop(): Promise<void> {
    if (isRunning()) {
      await supervisor.stop(handle as SupervisedProcess);
    }
  }

  async function start(): Promise<void> {
    if (isRunning()) {
      // Already up; just reconfirm readiness rather than spawn a duplicate.
      await confirmReady();
      return;
    }
    await spec.beforeStart?.();
    handle = supervisor.start(spec.name, spec.command, [...spec.args], {
      env: spec.env,
    });
    await confirmReady();
  }

  async function restart(): Promise<void> {
    await stop();
    await start();
  }

  return { restart, start, stop };
}

/**
 * Serves the controllers over `POST /services/:name/:action` on an ephemeral
 * loopback port. Returns the base URL to hand the scenario runner via
 * `POPCHARTS_LIFECYCLE_CONTROL_URL`. Loopback-only and up only for the run.
 */
export function createStackControlServer(
  controllers: Map<string, ServiceController>,
  options: { readonly logLabel: string },
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void handleRequest(controllers, options.logLabel, request, response);
  });

  return new Promise((resolvePromise, rejectPromise) => {
    server.on("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resolveClose) => {
            server.close(() => resolveClose());
          }),
      });
    });
  });
}

async function handleRequest(
  controllers: Map<string, ServiceController>,
  logLabel: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const send = (status: number, body: Record<string, unknown>): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };

  if (request.method !== "POST") {
    send(405, { error: "Only POST is supported." });
    return;
  }

  // e.g. /services/indexer/restart
  const match = /^\/services\/([^/]+)\/([^/]+)\/?$/.exec(request.url ?? "");
  if (!match) {
    send(404, { error: `Unknown control path: ${request.url}` });
    return;
  }

  const [, name, action] = match as unknown as [string, string, string];
  const controller = controllers.get(name);
  if (!controller) {
    send(404, {
      error: `Unknown service "${name}". Known: ${[...controllers.keys()].join(", ")}`,
    });
    return;
  }
  if (!CONTROLLER_ACTIONS.includes(action as ControllerAction)) {
    send(400, {
      error: `Unknown action "${action}". Known: ${CONTROLLER_ACTIONS.join(", ")}`,
    });
    return;
  }

  console.log(`[${logLabel}] control: ${action} ${name}`);
  try {
    await controller[action as ControllerAction]();
    send(200, { action, name, ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${logLabel}] control ${action} ${name} failed: ${message}`);
    send(500, { action, error: message, name });
  }
}
