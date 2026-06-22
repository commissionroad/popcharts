import { loadBuildInfo } from "../artifact/loadBuildInfo.mjs";
import { normalizeExplorerMessage } from "./normalizeExplorerMessage.mjs";
import { pollVerificationStatus } from "./pollVerificationStatus.mjs";
import { submitStandardJsonVerification } from "./submitStandardJsonVerification.mjs";

/**
 * Verifies a Hardhat artifact through Blockscout's standard JSON workflow.
 */
export async function verifyBlockscoutStandardJson({
  address,
  apiUrl,
  artifact,
  buildInfoRoot,
  explorerName = "Blockscout",
  licenseType = "3",
  pollAttempts = 30,
  pollIntervalMs = 4_000,
}) {
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
