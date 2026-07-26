import { deriveStackResources } from "./ports.ts";
import type { StackDescriptor } from "./registry.ts";

/**
 * The variables a spawned protocol helper picks its chain from, and the one
 * source of truth for that set.
 *
 * `hardhat run --network localhost` takes its URL from POPCHARTS_LOCAL_RPC_URL
 * and the protocol scripts' own viem clients read POPCHARTS_RPC_URL. Both
 * default to slot 0's :8545, so a caller that resolves a stack but forgets to
 * export them sends the child to the *human* slot's chain while validating and
 * reporting success against its own slot (ADR 0020). RPC_HTTP_URL rides along
 * so every consumer of the child env agrees on one URL.
 */
export type ProtocolChainEnv = {
  POPCHARTS_LOCAL_RPC_URL: string;
  POPCHARTS_RPC_URL: string;
  RPC_HTTP_URL: string;
};

/**
 * Resolves the chain a protocol child should target.
 *
 * A stack resolved from the registry owns its chain port outright, so its
 * derived URL wins over anything inherited — a stale RPC_HTTP_URL exported by
 * another slot's shell must not redirect the run. Without a target the caller
 * selected its chain some other way (an explicit env file), so that file's
 * RPC_HTTP_URL leads, an explicit POPCHARTS_LOCAL_RPC_URL backstops it, and
 * slot 0 is the last resort.
 */
export function resolveProtocolChainEnv(
  env: NodeJS.ProcessEnv,
  target: Pick<StackDescriptor, "slot"> | undefined,
): ProtocolChainEnv {
  const rpcUrl = target
    ? deriveStackResources(target.slot).chainRpcHttpUrl
    : (env.RPC_HTTP_URL ??
      env.POPCHARTS_LOCAL_RPC_URL ??
      deriveStackResources(0).chainRpcHttpUrl);

  return {
    POPCHARTS_LOCAL_RPC_URL: rpcUrl,
    POPCHARTS_RPC_URL: rpcUrl,
    RPC_HTTP_URL: rpcUrl,
  };
}
