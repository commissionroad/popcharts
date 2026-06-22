import { readJson } from "../json/readJson.mjs";

/**
 * Loads a Hardhat artifact and verifies it has deployable bytecode and metadata.
 */
export async function loadHardhatDeployableArtifact({ artifactPath, contractName }) {
  const artifact = await readJson(artifactPath);

  if (!artifact.abi || !artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`Invalid ${contractName} artifact. Run pnpm build first.`);
  }

  if (!artifact.buildInfoId || !artifact.contractName || !artifact.sourceName) {
    throw new Error(`Missing Hardhat build metadata for ${contractName}. Run pnpm build first.`);
  }

  return artifact;
}
