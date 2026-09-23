import { arcChainDataDir } from "../chain/arcNodePaths.ts";
import { deriveArcNodePorts } from "../chain/arcNodePorts.ts";
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
 *
 * The chain's other three ports have no base here on purpose. They belong to
 * the node's own port families, which `shared/chain/arcNodePorts.ts` owns and
 * derives from the HTTP port; restating them here would be a second source of
 * truth for the same offsets.
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
 *
 * The chain is four ports and a datadir, not one port. `chainPort` is the HTTP
 * JSON-RPC everything talks to; the other three and the datadir are bound by
 * the chain process itself and appear here so slot resolution can probe them
 * and the launcher cannot pick a different set. See `deriveArcNodePorts` and
 * ADR 0028 G7.
 */
export type StackPorts = {
  slot: number;
  chainPort: number;
  chainAuthRpcPort: number;
  chainMetricsPort: number;
  chainP2pPort: number;
  chainDataDir: string;
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
  // One HTTP port moves all four, through the module that owns the offsets, so
  // there is no second copy of "authrpc sits six above http" to drift. The
  // stride of 10 is what keeps the families from overlapping; the exact slot
  // range over which that holds is asserted, and its boundary explained, by the
  // port-disjointness test in scripts/test/local-stack-ports.test.ts.
  const chainNodePorts = deriveArcNodePorts(chainPort);

  return {
    slot,
    chainPort,
    chainAuthRpcPort: chainNodePorts.authrpc,
    chainMetricsPort: chainNodePorts.metrics,
    chainP2pPort: chainNodePorts.p2p,
    chainDataDir: arcChainDataDir(slot),
    // chainId is constant across slots — now by choice, where it used to be by
    // constraint. ADR 0020 deferred per-slot ids because `hardhat node` read
    // its chainId from network config and exposed no CLI flag. arc-node takes
    // `--chain`, so that constraint is gone (ADR 0028 G7) and this is a
    // decision rather than a limitation. The decision is still "one id":
    //
    //   - `--chain=arc-localdev` names a chain spec compiled into the binary.
    //     A per-slot id means passing `--chain` a genesis *file* instead, which
    //     means forking arc-localdev's genesis — the prefunded dev accounts and
    //     the native fiat token / Multicall3 / Permit2 / CREATE2 predeploys —
    //     and re-syncing it by hand on every version bump. That spends real
    //     fidelity on isolation we already have.
    //   - Isolation is already complete without it. The ports above, the
    //     datadir, and the database are what stop two slots touching; a chain
    //     id is an identity, not a lock, and no slot can reach another's chain
    //     to be misled by a matching one.
    //   - Every reader of the id is single-valued today — `chainIdToNetwork`,
    //     the app's wallet chain list, `local-create-market`'s BASE_CHAIN_ID
    //     read. Per-slot ids would multiply that surface and buy nothing.
    //
    // The value is still Hardhat's 31337 because the stack's chain is still
    // `hardhat node`. Moving it to arc-localdev's 1337 is the network-identity
    // change in ADR 0028 Phase 3 (G6), not a slot-model change: flipping it
    // here while the stack runs Hardhat would only make the registry lie about
    // the chain that is actually answering.
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
