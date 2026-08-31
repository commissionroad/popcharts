import type { Abi, Hex } from "viem";

import { isPlainJsonObject } from "../json/isPlainJsonObject.js";
import { readJsonFile } from "#src/json/jsonFile.js";

/**
 * The subset of a Hardhat contract artifact that deployment and verification
 * flows rely on: deployable bytecode plus build-info linkage.
 */
export type HardhatDeployableArtifact = {
  readonly abi: Abi;
  readonly buildInfoId: string;
  readonly bytecode: Hex;
  readonly contractName: string;
  /**
   * Where each external library's address has to be written into `bytecode`
   * before it can be deployed, keyed by source file and then library name.
   * Empty for contracts that link nothing, which is most of them.
   */
  readonly linkReferences: ArtifactLinkReferences;
  readonly sourceName: string;
};

/** Byte offsets of one unlinked library placeholder inside the bytecode. */
export type ArtifactLinkPlaceholder = {
  readonly length: number;
  readonly start: number;
};

/** Hardhat's `linkReferences`: source file -> library name -> placeholders. */
export type ArtifactLinkReferences = Readonly<
  Record<string, Readonly<Record<string, readonly ArtifactLinkPlaceholder[]>>>
>;

/**
 * Loads a Hardhat artifact and verifies it has deployable bytecode and metadata.
 */
export async function loadHardhatDeployableArtifact({
  artifactPath,
  contractName,
}: {
  artifactPath: string;
  contractName: string;
}): Promise<HardhatDeployableArtifact> {
  const artifact = await readJsonFile(artifactPath);

  if (
    !isPlainJsonObject(artifact) ||
    !Array.isArray(artifact.abi) ||
    typeof artifact.bytecode !== "string" ||
    artifact.bytecode === "0x"
  ) {
    throw new Error(`Invalid ${contractName} artifact. Run pnpm build first.`);
  }

  const { buildInfoId, sourceName } = artifact;
  const artifactContractName = artifact.contractName;
  if (
    typeof buildInfoId !== "string" ||
    !buildInfoId ||
    typeof artifactContractName !== "string" ||
    !artifactContractName ||
    typeof sourceName !== "string" ||
    !sourceName
  ) {
    throw new Error(`Missing Hardhat build metadata for ${contractName}. Run pnpm build first.`);
  }

  return {
    // Hardhat wrote the artifact, so trust the ABI entries beyond the array check.
    abi: artifact.abi as Abi,
    buildInfoId,
    bytecode: artifact.bytecode as Hex,
    contractName: artifactContractName,
    // Hardhat omits the key entirely when a contract links nothing.
    linkReferences: isPlainJsonObject(artifact.linkReferences)
      ? (artifact.linkReferences as ArtifactLinkReferences)
      : {},
    sourceName,
  };
}
