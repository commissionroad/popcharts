import { relative, resolve } from "node:path";

import { createPublicClient, http, type Hex } from "viem";

import { requirePositiveInteger, requireString } from "./shared/cli/requireCliValue.js";
import {
  collectVenueAddressEntries,
  DEFAULT_VENUE_DEPLOYMENT_FILE,
} from "./shared/deployment/venueManifest.js";
import { readJsonFile } from "./shared/json/jsonFile.js";

export type CheckVenueDeploymentConfig = {
  readonly deploymentFile?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedChainId?: number | string;
  readonly protocolRoot: string;
  readonly requiredKeys?: ReadonlySet<string>;
  readonly rpcUrl?: string;
};

/**
 * Checks that configured deployment manifest addresses have bytecode at the RPC endpoint.
 */
export async function checkVenueDeployment(config: CheckVenueDeploymentConfig): Promise<void> {
  const deploymentFile = resolve(
    config.protocolRoot,
    config.deploymentFile ||
      config.env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
      DEFAULT_VENUE_DEPLOYMENT_FILE,
  );
  const manifest = await readJsonFile(deploymentFile);
  const rpcUrl =
    config.rpcUrl ??
    config.env.POPCHARTS_RPC_URL ??
    requireString(readManifestField(manifest, "rpcUrl"), "manifest.rpcUrl");
  const expectedChainId =
    config.expectedChainId ??
    requirePositiveInteger(readManifestField(manifest, "chainId"), "manifest.chainId");
  const entries = collectVenueAddressEntries(manifest, config.requiredKeys);
  if (entries.length === 0) {
    throw new Error(
      `No contract addresses found in ${relative(config.protocolRoot, deploymentFile)}.`,
    );
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });
  const chainId = await client.getChainId();
  if (chainId !== requirePositiveInteger(expectedChainId, "--expected-chain-id")) {
    throw new Error(`Connected to chain ${chainId}, expected ${expectedChainId}.`);
  }

  const blockNumber = await client.getBlockNumber();
  const results = await Promise.all(
    entries.map(async (entry) => {
      const bytecode = await client.getBytecode({ address: entry.address });
      const byteLength = bytecodeLength(bytecode);
      return {
        ...entry,
        byteLength,
      };
    }),
  );
  const failures = results.filter((result) => result.required && result.byteLength === 0);

  console.log(`Manifest: ${relative(config.protocolRoot, deploymentFile)}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Block: ${blockNumber}`);
  for (const result of results) {
    const required = result.required ? "required" : "optional";
    console.log(
      `${result.name}: ${result.address} bytecode=${result.byteLength} bytes (${required})`,
    );
  }

  if (failures.length !== 0) {
    throw new Error(
      `Missing bytecode for required address entries: ${failures
        .map((failure) => failure.name)
        .join(", ")}`,
    );
  }
}

/**
 * Converts a comma-separated Hardhat option into a set of required manifest names.
 */
export function parseRequiredVenueKeys(value: string): ReadonlySet<string> | undefined {
  const requiredKeys = value
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length !== 0);
  return requiredKeys.length === 0 ? undefined : new Set(requiredKeys);
}

function bytecodeLength(bytecode: Hex | undefined): number {
  return bytecode === undefined ? 0 : (bytecode.length - 2) / 2;
}

function readManifestField(manifest: unknown, field: string): unknown {
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return undefined;
  }
  return (manifest as Record<string, unknown>)[field];
}
