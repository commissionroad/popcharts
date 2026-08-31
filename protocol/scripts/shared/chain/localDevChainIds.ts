import { ARC_LOCAL } from "./arcLocal.js";
import { LOCAL_DEVCHAIN } from "./localDevchain.js";

/**
 * Chain ids that identify a throwaway local development chain.
 *
 * Deployment seams that stamp dev-only wiring (zero dispute windows, the
 * deployer standing in as every privileged role) gate on this set. The gate
 * exists so those seams can never reach a real network, and widening the set
 * must never weaken that: these are the two disposable chains a developer can
 * run on their own machine — Hardhat's devchain and the single-node Arc chain
 * (ADR 0028) — and nothing else. Arc Testnet (5042002) and any mainnet remain
 * outside it, which is the whole point.
 *
 * Kept as a set rather than a single constant because a `!==` against one id
 * silently rejects the other local chain, which is how the Arc migration first
 * surfaced: `deployLocalPregrad` refused chain 1337 with "expected chain
 * 31337" while pointed at a perfectly valid local devchain.
 */
export const LOCAL_DEV_CHAIN_IDS: ReadonlySet<number> = new Set([
  LOCAL_DEVCHAIN.chainId,
  ARC_LOCAL.chainId,
]);

/** Whether `chainId` is one of the disposable local development chains. */
export function isLocalDevChainId(chainId: number): boolean {
  return LOCAL_DEV_CHAIN_IDS.has(chainId);
}

/** Human-readable list of the permitted ids, for error messages. */
export function describeLocalDevChainIds(): string {
  return [...LOCAL_DEV_CHAIN_IDS].join(" or ");
}

/**
 * `chainEnv` values naming a disposable local development chain.
 *
 * The dispute-config gate keys on chainEnv rather than chain id, so it needs
 * its own set. Both sets must name the same two chains: a chain that is local
 * by id but not by env (or the reverse) would pass one safety gate and fail
 * the other, which is a worse failure than either gate rejecting it outright.
 */
export const LOCAL_DEV_CHAIN_ENVS: ReadonlySet<string> = new Set([
  LOCAL_DEVCHAIN.chainEnv,
  ARC_LOCAL.chainEnv,
]);

/** Whether `chainEnv` names a disposable local development chain. */
export function isLocalDevChainEnv(chainEnv: string): boolean {
  return LOCAL_DEV_CHAIN_ENVS.has(chainEnv);
}
