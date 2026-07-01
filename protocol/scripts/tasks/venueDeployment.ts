import type { NewTaskActionFunction, TaskDefinition } from "hardhat/types/tasks";
import { emptyTask, task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { errorResult } from "hardhat/utils/result";

import { checkVenueDeployment, parseRequiredVenueKeys } from "../check-venue-deployment.js";
import { parseVenueContractOptionList, writeVenueManifest } from "../write-venue-manifest.js";
import { DEFAULT_VENUE_DEPLOYMENT_FILE } from "../shared/deployment/venueManifest.js";

type WriteVenueManifestTaskArguments = {
  readonly blockNumber: number;
  readonly chainId: number;
  readonly contracts: string;
  readonly deployer: string | undefined;
  readonly manifest: string | undefined;
  readonly optionalContracts: string;
  readonly output: string | undefined;
  readonly rpcUrl: string | undefined;
};

type CheckVenueDeploymentTaskArguments = {
  readonly expectedChainId: number;
  readonly manifest: string | undefined;
  readonly require: string;
  readonly rpcUrl: string | undefined;
};

const writeVenueManifestAction: NewTaskActionFunction<WriteVenueManifestTaskArguments> = async (
  taskArguments,
  hre,
) =>
  runOperatorTask(async () => {
    await writeVenueManifest({
      blockNumber: taskArguments.blockNumber < 0 ? undefined : taskArguments.blockNumber,
      chainId: taskArguments.chainId === 0 ? undefined : taskArguments.chainId,
      deployer: taskArguments.deployer,
      env: process.env,
      optionalContracts: parseVenueContractOptionList(taskArguments.optionalContracts, false),
      outputFile: resolveOutputOption(taskArguments),
      protocolRoot: hre.config.paths.root,
      requiredContracts: parseVenueContractOptionList(taskArguments.contracts, true),
      rpcUrl: taskArguments.rpcUrl,
    });
  });

const checkVenueDeploymentAction: NewTaskActionFunction<CheckVenueDeploymentTaskArguments> = async (
  taskArguments,
  hre,
) =>
  runOperatorTask(async () => {
    await checkVenueDeployment({
      deploymentFile: taskArguments.manifest,
      env: process.env,
      expectedChainId:
        taskArguments.expectedChainId === 0 ? undefined : taskArguments.expectedChainId,
      protocolRoot: hre.config.paths.root,
      requiredKeys: parseRequiredVenueKeys(taskArguments.require),
      rpcUrl: taskArguments.rpcUrl,
    });
  });

const venueDeploymentTasks: TaskDefinition[] = [
  emptyTask("deployment", "Deployment manifest and verification helpers").build(),
  task(["deployment", "write-venue-manifest"], "Write a venue deployment manifest")
    .addOption({
      name: "chainId",
      description: "Chain ID. Defaults to POPCHARTS_CHAIN_ID",
      type: ArgumentType.INT,
      defaultValue: 0,
    })
    .addOption({
      name: "rpcUrl",
      description: "RPC URL. Defaults to POPCHARTS_RPC_URL",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "manifest",
      description: `Output path. Defaults to ${DEFAULT_VENUE_DEPLOYMENT_FILE}`,
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "output",
      description: "Alias for --manifest",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
      hidden: true,
    })
    .addOption({
      name: "blockNumber",
      description: "Optional reference block number",
      type: ArgumentType.INT,
      defaultValue: -1,
    })
    .addOption({
      name: "deployer",
      description: "Optional deployer address",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "contracts",
      description: "Comma-separated required entries: name=address[@block]",
      defaultValue: "",
    })
    .addOption({
      name: "optionalContracts",
      description: "Comma-separated optional entries: name=address[@block]",
      defaultValue: "",
    })
    .setInlineAction(writeVenueManifestAction)
    .build(),
  task(["deployment", "check-venue"], "Check venue manifest bytecode at an RPC endpoint")
    .addOption({
      name: "manifest",
      description: `Manifest path. Defaults to ${DEFAULT_VENUE_DEPLOYMENT_FILE}`,
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "rpcUrl",
      description: "RPC URL. Defaults to POPCHARTS_RPC_URL or manifest.rpcUrl",
      type: ArgumentType.STRING_WITHOUT_DEFAULT,
      defaultValue: undefined,
    })
    .addOption({
      name: "expectedChainId",
      description: "Expected chain ID. Defaults to manifest.chainId",
      type: ArgumentType.INT,
      defaultValue: 0,
    })
    .addOption({
      name: "require",
      description: "Comma-separated manifest entry names that must have bytecode",
      defaultValue: "",
    })
    .setInlineAction(checkVenueDeploymentAction)
    .build(),
];

export default venueDeploymentTasks;

function resolveOutputOption({
  manifest,
  output,
}: Pick<WriteVenueManifestTaskArguments, "manifest" | "output">): string | undefined {
  if (manifest !== undefined && output !== undefined) {
    throw new Error("Use either --manifest or --output, not both.");
  }
  return manifest ?? output;
}

async function runOperatorTask(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return errorResult();
  }
}
