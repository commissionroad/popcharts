import { LOCAL_DEVCHAIN } from "../chain/localDevchain.js";
import { LOCAL_DISPUTE_CONFIG } from "./localDisputeConfig.js";

// A hard-coded bypass of the real-chain guard must embed this grep-able,
// self-describing admission instead of a boolean that hides as `true`.
export const ZERO_DISPUTE_CONFIG_TOKEN = "unprotected-markets-on-purpose";

export type ZeroDisputeConfigToken = typeof ZERO_DISPUTE_CONFIG_TOKEN;

export const DISPUTE_WINDOW_ENV_VAR = "POPCHARTS_DISPUTE_WINDOW_SECONDS";
export const DISPUTE_BOND_ENV_VAR = "POPCHARTS_DISPUTE_BOND_RAW";
export const ALLOW_ZERO_DISPUTE_ENV_VAR = "POPCHARTS_ALLOW_ZERO_DISPUTE_WINDOW_UNPROTECTED_MARKETS";

// CompleteSetPostgradAdapter stores the window as uint64 seconds.
const DISPUTE_WINDOW_MAX = 2n ** 64n - 1n;

export type ResolvedDisputeConfig = {
  allowZeroDisputeConfig?: ZeroDisputeConfigToken;
  disputeBond: bigint;
  disputeWindow: bigint;
};

/**
 * Refuses a dispute config that would deploy unprotected markets on a real
 * chain: outside the local devchain, both window and bond must be nonzero
 * unless the caller passes the literal escape-hatch token. Keyed on the
 * connected chainId (not env or profile) so a future entry script hardcoding
 * zeros dies on any real network.
 */
export function assertDeployableDisputeConfig({
  allowZeroDisputeConfig,
  chainId,
  disputeBond,
  disputeWindow,
}: ResolvedDisputeConfig & { chainId: number }): void {
  if (chainId === LOCAL_DEVCHAIN.chainId) {
    return;
  }
  if (disputeWindow > 0n && disputeBond > 0n) {
    return;
  }
  if (allowZeroDisputeConfig === ZERO_DISPUTE_CONFIG_TOKEN) {
    return;
  }
  throw new Error(
    `Refusing to deploy dispute config (window=${disputeWindow}s, bond=${disputeBond} raw) on chain ${chainId}: ` +
      "a zero value disables the dispute flow, so every resolution on this deployment would be final " +
      'the moment it lands. Repo ADR 0024 makes resolution "propose → 24h public dispute window → ' +
      'permissionless finalize"; protocol ADR 0013 Phase 0 sizes the bond as "a flat protocol-wide ' +
      'constant on the order of 100 collateral units". Set ' +
      `${DISPUTE_WINDOW_ENV_VAR} and ${DISPUTE_BOND_ENV_VAR} to nonzero values, or deploy unprotected ` +
      `markets on purpose with ${ALLOW_ZERO_DISPUTE_ENV_VAR}=${ZERO_DISPUTE_CONFIG_TOKEN}.`,
  );
}

/**
 * Resolves the dispute config a deploy stamps into CompleteSetPostgradAdapter.
 * Local chains get the locked zero config. Every other chain requires both
 * env vars explicitly — the escape hatch only legalizes an explicit "0",
 * never an omission.
 */
export function resolveDisputeConfig({
  chainEnv,
  env,
}: {
  chainEnv: string;
  env: NodeJS.ProcessEnv;
}): ResolvedDisputeConfig {
  if (chainEnv === LOCAL_DEVCHAIN.chainEnv) {
    return { ...LOCAL_DISPUTE_CONFIG };
  }

  const hatch = env[ALLOW_ZERO_DISPUTE_ENV_VAR];
  if (hatch !== undefined && hatch !== ZERO_DISPUTE_CONFIG_TOKEN) {
    throw new Error(
      `Expected ${ALLOW_ZERO_DISPUTE_ENV_VAR} to be unset or the exact literal ` +
        `"${ZERO_DISPUTE_CONFIG_TOKEN}".`,
    );
  }

  const missing = [DISPUTE_WINDOW_ENV_VAR, DISPUTE_BOND_ENV_VAR].filter(
    (name) => env[name] === undefined || env[name] === "",
  );
  if (missing.length > 0) {
    throw new Error(
      `Non-local deploys require ${DISPUTE_WINDOW_ENV_VAR} (seconds) and ` +
        `${DISPUTE_BOND_ENV_VAR} (collateral raw units); missing ${missing.join(", ")}. ` +
        `${ALLOW_ZERO_DISPUTE_ENV_VAR} only legalizes an explicit "0", never an omission.`,
    );
  }

  const disputeWindow = requireEnvBigInt(env, DISPUTE_WINDOW_ENV_VAR);
  const disputeBond = requireEnvBigInt(env, DISPUTE_BOND_ENV_VAR);
  if (disputeWindow > DISPUTE_WINDOW_MAX) {
    throw new Error(
      `Expected ${DISPUTE_WINDOW_ENV_VAR} to fit the adapter's uint64 window ` +
        `(max ${DISPUTE_WINDOW_MAX}).`,
    );
  }
  if ((disputeWindow === 0n || disputeBond === 0n) && hatch === undefined) {
    throw new Error(
      `Refusing zero dispute config (window=${disputeWindow}s, bond=${disputeBond} raw) on a ` +
        "non-local chain: it deploys unprotected markets. Set nonzero values, or opt in with " +
        `${ALLOW_ZERO_DISPUTE_ENV_VAR}=${ZERO_DISPUTE_CONFIG_TOKEN}.`,
    );
  }

  return { allowZeroDisputeConfig: hatch, disputeBond, disputeWindow };
}

// Bond values can exceed Number.MAX_SAFE_INTEGER in raw collateral units, so
// parse decimal strings straight to bigint instead of through Number.
function requireEnvBigInt(env: NodeJS.ProcessEnv, name: string): bigint {
  const value = env[name];
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`Expected ${name} to be a non-negative integer string.`);
  }
  return BigInt(value);
}
