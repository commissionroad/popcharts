import { resolve } from "node:path";

import { isPlainJsonObject } from "../json/isPlainJsonObject.js";
import { readJsonFile } from "../../../src/json/jsonFile.js";

/**
 * The parts of a Hardhat build-info document that standard JSON verification
 * needs: the exact compiler input plus the long solc version string.
 */
export type SolidityBuildInfo = {
  readonly input: {
    readonly settings: {
      readonly evmVersion: string;
      readonly optimizer: { readonly runs: number };
    };
  };
  readonly solcLongVersion: string;
};

/**
 * Loads the Hardhat build-info document referenced by a contract artifact.
 */
export async function loadBuildInfo({
  artifact,
  buildInfoRoot,
}: {
  artifact: { readonly buildInfoId: string };
  buildInfoRoot: string;
}): Promise<SolidityBuildInfo> {
  const buildInfoPath = resolve(buildInfoRoot, `${artifact.buildInfoId}.json`);
  const buildInfo = await readJsonFile(buildInfoPath);

  if (
    !isPlainJsonObject(buildInfo) ||
    typeof buildInfo.solcLongVersion !== "string" ||
    !isPlainJsonObject(buildInfo.input)
  ) {
    throw new Error(`Invalid Hardhat build-info document: ${buildInfoPath}`);
  }

  // Hardhat wrote the document, so trust the nested compiler settings shape.
  return buildInfo as SolidityBuildInfo;
}
