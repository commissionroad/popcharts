import { relative, resolve } from "node:path";

import type { Address } from "viem";

import {
  requireAddress,
  requireNonNegativeInteger,
  requirePositiveInteger,
  requireString,
} from "./shared/cli/requireCliValue.js";
import {
  DEFAULT_VENUE_DEPLOYMENT_FILE,
  formatVenueContractEntry,
  normalizeVenueContractEntries,
  type VenueManifestContractEntry,
  type VenueContractSpec,
} from "./shared/deployment/venueManifest.js";
import { writeJsonFile } from "./shared/json/jsonFile.js";

export type WriteVenueManifestConfig = {
  readonly blockNumber?: number | string;
  readonly chainId?: number | string;
  readonly deployer?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly optionalContracts: readonly VenueContractSpec[];
  readonly outputFile?: string;
  readonly protocolRoot: string;
  readonly requiredContracts: readonly VenueContractSpec[];
  readonly rpcUrl?: string;
};

export type VenueDeploymentManifest = {
  readonly blockNumber?: string;
  readonly chainId: number;
  readonly contracts: Record<string, VenueManifestContractEntry>;
  readonly deployer?: Address;
  readonly generatedAt: string;
  readonly rpcUrl: string;
};

export type WriteVenueManifestResult = {
  readonly contractCount: number;
  readonly manifest: VenueDeploymentManifest;
  readonly outputFile: string;
};

/**
 * Writes a venue deployment manifest from validated Hardhat task inputs.
 */
export async function writeVenueManifest(
  config: WriteVenueManifestConfig,
): Promise<WriteVenueManifestResult> {
  const contracts = normalizeVenueContractEntries([
    ...config.requiredContracts,
    ...config.optionalContracts,
  ]);
  if (contracts.length === 0) {
    throw new Error("At least one --contracts or --optional-contracts entry is required.");
  }

  const outputFile = resolve(
    config.protocolRoot,
    config.outputFile ||
      config.env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
      DEFAULT_VENUE_DEPLOYMENT_FILE,
  );
  const blockNumber =
    config.blockNumber === undefined
      ? undefined
      : requireNonNegativeInteger(config.blockNumber, "--block-number").toString();
  const deployer =
    config.deployer === undefined ? undefined : requireAddress(config.deployer, "--deployer");
  const manifest: VenueDeploymentManifest = {
    ...(blockNumber === undefined ? {} : { blockNumber }),
    chainId: requirePositiveInteger(config.chainId ?? config.env.POPCHARTS_CHAIN_ID, "--chain-id"),
    contracts: Object.fromEntries(
      contracts.map((contract) => [contract.name, formatVenueContractEntry(contract)]),
    ),
    ...(deployer === undefined ? {} : { deployer }),
    generatedAt: new Date().toISOString(),
    rpcUrl: requireString(config.rpcUrl ?? config.env.POPCHARTS_RPC_URL, "--rpc-url"),
  };

  await writeJsonFile(outputFile, manifest);

  const outputPath = relative(config.protocolRoot, outputFile);
  console.log(`Wrote ${outputPath}`);
  console.log(`Contracts: ${contracts.length}`);
  console.log(`Verify with: pnpm deployment:check-venue --manifest ${outputPath}`);

  return {
    contractCount: contracts.length,
    manifest,
    outputFile,
  };
}

/**
 * Converts a comma-separated Hardhat option into contract manifest specs.
 */
export function parseVenueContractOptionList(
  value: string,
  required: boolean,
): VenueContractSpec[] {
  return value
    .split(",")
    .map((spec) => spec.trim())
    .filter((spec) => spec.length !== 0)
    .map((spec) => ({ required, spec }));
}
