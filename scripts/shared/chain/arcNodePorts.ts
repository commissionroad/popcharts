/**
 * Every port a single arc-node instance binds, and how to derive a
 * non-colliding set for a second instance.
 *
 * This lives apart from the launcher because it is shared knowledge, not CLI
 * plumbing: ADR 0028 Phase 2 folds it into `deriveStackResources` so each
 * stack slot gets its own set.
 *
 * The five-resource shape is not defensive over-modelling. reth reports port
 * conflicts one at a time, so an instance that strides only the HTTP port
 * fails first with
 *   `address 0.0.0.0:30303 (listener service) is already in use`
 * and then, once that is fixed, with
 *   `address 127.0.0.1:8551 (AUTH server) is already in use`.
 * Both were hit in practice while validating the migration; `--disable-discovery`
 * does not release the P2P listener. See ADR 0028 G7.
 */

/** reth's default HTTP JSON-RPC port, and the anchor every offset is taken from. */
export const DEFAULT_ARC_HTTP_PORT = 8545;

const DEFAULT_AUTHRPC_PORT = 8551;
const DEFAULT_METRICS_PORT = 9001;
const DEFAULT_P2P_PORT = 30303;

/** The full set of ports one arc-node instance binds. */
export type ArcNodePorts = {
  readonly http: number;
  readonly p2p: number;
  readonly authrpc: number;
  readonly metrics: number;
};

/**
 * Derives the full port set from the HTTP port, so one number moves them all
 * together.
 *
 * Each family keeps its own numeric neighbourhood — HTTP as given, P2P near
 * 30303, authrpc near 8551, metrics near 9001 — so a stray port in a log is
 * attributable to its role at a glance.
 */
export function deriveArcNodePorts(httpPort: number): ArcNodePorts {
  const offset = httpPort - DEFAULT_ARC_HTTP_PORT;

  return {
    authrpc: DEFAULT_AUTHRPC_PORT + offset,
    http: httpPort,
    metrics: DEFAULT_METRICS_PORT + offset,
    p2p: DEFAULT_P2P_PORT + offset,
  };
}
