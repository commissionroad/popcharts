import type { Address } from "viem";

import type { SolidityBuildInfo } from "../artifact/loadBuildInfo.js";
import type { ExplorerApiResponse } from "../json/parseExplorerJson.js";
import { postExplorerForm } from "./postExplorerForm.js";

/**
 * Submits Solidity standard JSON source verification to Blockscout-compatible APIs.
 */
export async function submitStandardJsonVerification({
  address,
  apiUrl,
  buildInfo,
  contractName,
  explorerName,
  licenseType,
}: {
  address: Address;
  apiUrl: string;
  buildInfo: SolidityBuildInfo;
  contractName: string;
  explorerName: string;
  licenseType: string;
}): Promise<ExplorerApiResponse> {
  // Hardhat stores the exact Solidity standard JSON input in build-info. Sending
  // that to Blockscout avoids brittle flattened-source reconstruction.
  const sourceCode = JSON.stringify(buildInfo.input);
  const compilerVersion = `v${buildInfo.solcLongVersion}`;

  const form = new FormData();
  form.set("contractaddress", address);
  form.set("sourceCode", sourceCode);
  form.set("contractname", contractName);
  form.set("codeformat", "solidity-standard-json-input");
  form.set("compilerversion", compilerVersion);
  form.set("optimizationUsed", "1");
  form.set("runs", String(buildInfo.input.settings.optimizer.runs));
  form.set("constructorArguments", "");
  form.set("evmversion", buildInfo.input.settings.evmVersion);
  form.set("licenseType", licenseType);

  return postExplorerForm({
    explorerName,
    form,
    url: `${apiUrl}?module=contract&action=verifysourcecode`,
  });
}
