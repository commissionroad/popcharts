import { resolve } from "node:path";

import { readJson } from "../json/readJson.mjs";

/**
 * Loads the Hardhat build-info document referenced by a contract artifact.
 */
export async function loadBuildInfo({ artifact, buildInfoRoot }) {
  return readJson(resolve(buildInfoRoot, `${artifact.buildInfoId}.json`));
}
