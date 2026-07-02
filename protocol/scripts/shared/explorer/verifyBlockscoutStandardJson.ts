import type { Address } from "viem";

import { loadBuildInfo } from "../artifact/loadBuildInfo.js";
import type { HardhatDeployableArtifact } from "../artifact/loadHardhatDeployableArtifact.js";
import { normalizeExplorerMessage } from "./normalizeExplorerMessage.js";
import { pollVerificationStatus } from "./pollVerificationStatus.js";
import { submitStandardJsonVerification } from "./submitStandardJsonVerification.js";

// Blockscout/Etherscan license code 3 = MIT.
const DEFAULT_LICENSE_TYPE = "3";
const DEFAULT_POLL_ATTEMPTS = 30;
const DEFAULT_POLL_INTERVAL_MS = 4_000;

/**
 * Outcome of a Blockscout verification. `guid` is undefined when the explorer
 * reported the contract as already verified, so no polling happened.
 */
export type BlockscoutVerification = {
  guid: string | undefined;
  result: string;
};

/**
 * Verifies a Hardhat artifact through Blockscout's standard JSON workflow.
 */
export async function verifyBlockscoutStandardJson({
  address,
  apiUrl,
  artifact,
  buildInfoRoot,
  explorerName = "Blockscout",
  licenseType = DEFAULT_LICENSE_TYPE,
  pollAttempts = DEFAULT_POLL_ATTEMPTS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: {
  address: Address;
  apiUrl: string;
  artifact: Pick<HardhatDeployableArtifact, "buildInfoId" | "contractName" | "sourceName">;
  buildInfoRoot: string;
  explorerName?: string;
  licenseType?: string;
  pollAttempts?: number;
  pollIntervalMs?: number;
}): Promise<BlockscoutVerification> {
  const buildInfo = await loadBuildInfo({ artifact, buildInfoRoot });
  const contractName = `${artifact.sourceName}:${artifact.contractName}`;
  const submission = await submitStandardJsonVerification({
    address,
    apiUrl,
    buildInfo,
    contractName,
    explorerName,
    licenseType,
  });

  if (submission.status !== "1") {
    const result = normalizeExplorerMessage(submission.result);
    if (result.toLowerCase().includes("already verified")) {
      return { guid: undefined, result };
    }
    throw new Error(`${explorerName} verification submission failed: ${result}`);
  }

  const guid = String(submission.result);
  return {
    guid,
    result: await pollVerificationStatus({
      apiUrl,
      explorerName,
      guid,
      pollAttempts,
      pollIntervalMs,
    }),
  };
}
