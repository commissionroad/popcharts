import { parseLabeledJson } from "../json/parseLabeledJson.ts";

/**
 * Payload of the `LOCAL_CHAIN_SMOKE_DEPLOY=` line emitted by
 * `protocol/scripts/deploy-local-pregrad.ts` — the machine-readable record of
 * a fresh local pregrad deployment that orchestrators parse from stdout.
 */
export type PregradDeploy = {
  readonly chainId: number;
  readonly collateralAddress: string;
  readonly deployBlock: string;
  readonly postgradAdapterAddress: string;
  readonly pregradManagerAddress: string;
};

export function parsePregradDeploy(stdout: string): PregradDeploy {
  const deploy = parseLabeledJson<Partial<PregradDeploy>>(
    stdout,
    "LOCAL_CHAIN_SMOKE_DEPLOY",
  );

  if (typeof deploy.chainId !== "number") {
    throw new Error("LOCAL_CHAIN_SMOKE_DEPLOY is missing a numeric chainId.");
  }
  if (!isEvmAddress(deploy.collateralAddress)) {
    throw new Error("LOCAL_CHAIN_SMOKE_DEPLOY is missing a collateralAddress.");
  }
  if (!isEvmAddress(deploy.pregradManagerAddress)) {
    throw new Error(
      "LOCAL_CHAIN_SMOKE_DEPLOY is missing a pregradManagerAddress.",
    );
  }
  if (!isEvmAddress(deploy.postgradAdapterAddress)) {
    throw new Error(
      "LOCAL_CHAIN_SMOKE_DEPLOY is missing a postgradAdapterAddress.",
    );
  }
  if (
    typeof deploy.deployBlock !== "string" ||
    !/^\d+$/.test(deploy.deployBlock)
  ) {
    throw new Error("LOCAL_CHAIN_SMOKE_DEPLOY is missing a deployBlock.");
  }

  return {
    chainId: deploy.chainId,
    collateralAddress: deploy.collateralAddress as string,
    deployBlock: deploy.deployBlock,
    postgradAdapterAddress: deploy.postgradAdapterAddress as string,
    pregradManagerAddress: deploy.pregradManagerAddress as string,
  };
}

function isEvmAddress(value: unknown): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}
