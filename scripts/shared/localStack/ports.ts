import {
  localChainEnvFileForSlot,
  localDevIndexerHealthFileForSlot,
} from "../env/localDevEnvFiles.ts";
import { assertValidSlot } from "./assertValidSlot.ts";

/**
 * Base resource values for slot 0 and the per-slot stride, exported as the
 * single source of truth so nothing else hardcodes a port or chain id.
 * `deriveStackResources` offsets each base by the slot (chain id excepted —
 * see below). Slot 0 must equal the historical single-stack defaults, so these
 * numbers are load-bearing: changing one silently moves every stack (ADR 0020).
 */
export const SLOT_PORT_STRIDE = 10;
export const BASE_CHAIN_PORT = 8545;
export const BASE_CHAIN_ID = 31337;
export const BASE_API_PORT = 3001;
export const BASE_APP_PORT = 3000;
export const BASE_REVIEW_PORT = 3002;
export const BASE_RESOLUTION_PORT = 3004;
export const BASE_PC_ADMIN_PORT = 8080;
export const BASE_DATABASE_NAME = "popcharts";

/**
 * The fully-derived set of resources a single local dev stack owns for a given
 * slot: the ports it binds, the devchain it talks to, its Postgres database,
 * the generated env file it writes, and the indexer health marker it waits on.
 * Produced by `deriveStackResources`.
 */
export type StackPorts = {
  slot: number;
  chainPort: number;
  chainId: number;
  apiPort: number;
  appPort: number;
  reviewPort: number;
  resolutionPort: number;
  pcAdminPort: number;
  dbName: string;
  chainRpcHttpUrl: string;
  chainRpcWssUrl: string;
  envFilePath: string;
  indexerHealthFilePath: string;
};

/**
 * Derives every resource a stack on `slot` owns by offsetting the base values
 * by the slot number. Slot 0 reproduces the historical single-stack defaults
 * exactly; higher slots get non-overlapping ports, database, and env file so
 * they run concurrently without collision (ADR 0020). Throws on a negative or
 * non-integer slot.
 */
export function deriveStackResources(slot: number): StackPorts {
  assertValidSlot(slot);

  const chainPort = BASE_CHAIN_PORT + SLOT_PORT_STRIDE * slot;

  return {
    slot,
    chainPort,
    // chainId is intentionally constant across slots: `hardhat node` takes its
    // chainId from network config, not a CLI flag, so every slot's devchain
    // actually reports BASE_CHAIN_ID. Isolation is provided by the per-slot
    // chain port and database. Per-slot chainId is deferred (see ADR 0020).
    chainId: BASE_CHAIN_ID,
    apiPort: BASE_API_PORT + SLOT_PORT_STRIDE * slot,
    appPort: BASE_APP_PORT + SLOT_PORT_STRIDE * slot,
    reviewPort: BASE_REVIEW_PORT + SLOT_PORT_STRIDE * slot,
    resolutionPort: BASE_RESOLUTION_PORT + SLOT_PORT_STRIDE * slot,
    // Strided like every other port, and deliberately so: this one addresses
    // the control API that can stop another slot's whole stack, and a devchain
    // stopped that way loses its in-memory state for good. At the old stride
    // of 1 the control ports were 8080/8081/8082 — adjacent digits, while every
    // other resource (8545/8555, popcharts/popcharts_1) announces its slot at a
    // glance. Twice, a worktree session reached for the memorable 8080 and shut
    // down the primary checkout's stack. Striding makes a stale or mistyped
    // port hit nothing and fail loudly instead of a live neighbour.
    pcAdminPort: BASE_PC_ADMIN_PORT + SLOT_PORT_STRIDE * slot,
    dbName: slot === 0 ? BASE_DATABASE_NAME : `${BASE_DATABASE_NAME}_${slot}`,
    chainRpcHttpUrl: `http://127.0.0.1:${chainPort}`,
    chainRpcWssUrl: `ws://127.0.0.1:${chainPort}`,
    envFilePath: localChainEnvFileForSlot(slot),
    indexerHealthFilePath: localDevIndexerHealthFileForSlot(slot),
  };
}

/**
 * The slot that owns `port`, given the base that port is offset from, or
 * `undefined` when no slot owns it.
 *
 * The inverse of `deriveStackResources`, for a caller holding a port rather
 * than a slot number — a chain picked as an inherited `RPC_HTTP_URL`, an app
 * port typed by an operator — that then needs the slot it belongs to. Without
 * it such a caller derives one resource from the port it was given and every
 * other from slot 0, which is the ADR 0020 leak in miniature.
 *
 * Only an exact slot port answers. Any other port is not a slot's, and
 * inventing a slot for it would name a stack that does not own it —
 * `undefined` says "this port is outside the grid" instead. The stride keeps
 * the bases from colliding, so an API port (3001) is not slot 0's app port.
 */
function slotForPort(port: number, basePort: number): number | undefined {
  const offset = port - basePort;

  if (offset < 0 || offset % SLOT_PORT_STRIDE !== 0) {
    return undefined;
  }

  return offset / SLOT_PORT_STRIDE;
}

/** The slot whose devchain listens on `chainPort`. See `slotForPort`. */
export function slotForChainPort(chainPort: number): number | undefined {
  return slotForPort(chainPort, BASE_CHAIN_PORT);
}

/** The slot whose Next.js app listens on `appPort`. See `slotForPort`. */
export function slotForAppPort(appPort: number): number | undefined {
  return slotForPort(appPort, BASE_APP_PORT);
}

/**
 * The slot whose process-compose control API listens on `pcAdminPort`. See
 * `slotForPort`.
 *
 * This is the lookup a caller holding a control port needs before acting on
 * it: the control API has no authentication and its `/project/stop` takes the
 * whole stack down, so "which slot am I about to command?" must be answerable
 * from the port alone rather than assumed.
 */
export function slotForControlPort(pcAdminPort: number): number | undefined {
  return slotForPort(pcAdminPort, BASE_PC_ADMIN_PORT);
}
