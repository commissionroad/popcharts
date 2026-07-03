/**
 * Payload of the `LOCAL_CHAIN_SMOKE_DEPLOY=` line emitted by
 * `protocol/scripts/deploy-local-pregrad.ts` — the machine-readable record of
 * a fresh local pregrad deployment that orchestrators parse from stdout.
 */
export type PregradDeploy = {
  readonly chainId: number;
  readonly collateralAddress: string;
  readonly deployBlock: string;
  readonly pregradManagerAddress: string;
};
