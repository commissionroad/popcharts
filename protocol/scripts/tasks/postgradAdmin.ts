import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import type { NewTaskActionFunction, TaskDefinition } from "hardhat/types/tasks";
import { emptyTask, task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import { errorResult } from "hardhat/utils/result";

import { getWalletClientAddress } from "../shared/account/getWalletClientAddress.js";
import { resolveDeploymentChainProfile } from "../shared/chain/resolveDeploymentChainProfile.js";
import { requireAddress } from "../../src/cli/requireCliValue.js";
import { assertHardhatNetwork } from "../shared/hardhat/assertHardhatNetwork.js";
import {
  runPostgradAdminAction,
  type PostgradAdminAction,
  type PostgradAdminContext,
} from "../operate-postgrad-admin.js";

type FlagArguments = { readonly execute: boolean };
type AccountToggleArguments = FlagArguments & {
  readonly account: string | undefined;
  readonly allowed: string | undefined;
};

// Safe-CLI default per the plan doc's operator posture: every subtask is a
// dry run unless --execute is passed.
const EXECUTE_FLAG = {
  description: "Broadcast the change. Without this flag the task is a read-only dry run",
  name: "execute",
} as const;

const setResolverRoleAction: NewTaskActionFunction<AccountToggleArguments> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    account: requireAddress(args.account, "--account"),
    allowed: parseBooleanOption(args.allowed, "--allowed"),
    kind: "setResolverRole",
  }));

const setHookRoleAction: NewTaskActionFunction<AccountToggleArguments> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    account: requireAddress(args.account, "--account"),
    allowed: parseBooleanOption(args.allowed, "--allowed"),
    kind: "setHookRole",
  }));

const setPoolWhitelistedAction: NewTaskActionFunction<
  FlagArguments & { side: string | undefined; whitelisted: string | undefined }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    kind: "setPoolWhitelisted",
    side: parseSideOption(args.side),
    whitelisted: parseBooleanOption(args.whitelisted, "--whitelisted"),
  }));

const setMaximumExecutionCountAction: NewTaskActionFunction<
  FlagArguments & { count: string | undefined }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    count: parsePositiveBigintOption(args.count, "--count"),
    kind: "setMaximumExecutionCount",
  }));

const setMinimumOrderAmountAction: NewTaskActionFunction<
  FlagArguments & {
    amount: string | undefined;
    side: string | undefined;
    token: string | undefined;
  }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => {
    if (args.amount === undefined) {
      throw new Error("Expected --amount to be set.");
    }
    if ((args.token === undefined) === (args.side === undefined)) {
      throw new Error("Set exactly one of --token or --side.");
    }
    if (args.token !== undefined) {
      return {
        amount: args.amount,
        kind: "setMinimumOrderAmount",
        token: requireAddress(args.token, "--token"),
      };
    }
    return { amount: args.amount, kind: "setMinimumOrderAmount", side: parseSideOption(args.side) };
  });

const resolveMarketAction: NewTaskActionFunction<
  FlagArguments & { side: string | undefined }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    kind: "resolveMarket",
    side: parseSideOption(args.side),
  }));

const cancelMarketAction: NewTaskActionFunction<FlagArguments> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({ kind: "cancelMarket" }));

const setTrustedCreatorAction: NewTaskActionFunction<
  FlagArguments & { account: string | undefined; trusted: string | undefined }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    account: requireAddress(args.account, "--account"),
    kind: "setTrustedCreator",
    trusted: parseBooleanOption(args.trusted, "--trusted"),
  }));

const setMarketCreationPausedAction: NewTaskActionFunction<
  FlagArguments & { paused: string | undefined }
> = async (args, hre) =>
  runAdminTask(hre, args.execute, () => ({
    kind: "setMarketCreationPaused",
    paused: parseBooleanOption(args.paused, "--paused"),
  }));

// Option parsing runs inside the same guard as the action itself so operator
// mistakes surface as one-line errors instead of stack traces.
async function runAdminTask(
  hre: HardhatRuntimeEnvironment,
  execute: boolean,
  buildAction: () => PostgradAdminAction,
) {
  try {
    const action = buildAction();
    const context = await createAdminContext(hre, execute);
    await runPostgradAdminAction(context, action);
  } catch (error) {
    return reportOperatorError(error);
  }
}

// The admin CLI connects through the task's --network selection so the same
// subtasks serve localhost and Arc Testnet.
async function createAdminContext(
  hre: HardhatRuntimeEnvironment,
  execute: boolean,
): Promise<PostgradAdminContext> {
  const connection = await hre.network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error(
      `Expected Hardhat network ${profile.networkName} to expose an operator account. ` +
        "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    );
  }
  const callerAddress = getWalletClientAddress({
    missingMessage:
      `Expected Hardhat network ${profile.networkName} to expose an operator account. ` +
      "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  console.log(`Pop Charts postgrad admin (${profile.chainName}, chain ${chainId})`);
  console.log(`Mode: ${execute ? "EXECUTE (broadcasting)" : "dry-run (no broadcast)"}`);

  return {
    callerAddress,
    chainEnv: profile.chainEnv,
    chainId,
    env: process.env,
    execute,
    protocolRoot: hre.config.paths.root,
    publicClient,
    walletClient,
  };
}

function reportOperatorError(error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  return errorResult();
}

// Generic over the literal option name so task argument types keep the key.
function stringOption<NameT extends string>(name: NameT, description: string) {
  return {
    defaultValue: undefined,
    description,
    name,
    type: ArgumentType.STRING_WITHOUT_DEFAULT,
  } as const;
}

function parseBooleanOption(value: string | undefined, label: string): boolean {
  if (value !== "true" && value !== "false") {
    throw new Error(`Expected ${label} to be "true" or "false".`);
  }
  return value === "true";
}

function parseSideOption(value: string | undefined): "no" | "yes" {
  if (value !== "yes" && value !== "no") {
    throw new Error('Expected --side to be "yes" or "no".');
  }
  return value;
}

function parsePositiveBigintOption(value: string | undefined, label: string): bigint {
  if (value === undefined || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`Expected ${label} to be a positive integer.`);
  }
  return BigInt(value);
}

const postgradAdminTasks: TaskDefinition[] = [
  emptyTask(
    "operator",
    "Owner and resolver admin workflows for the complete-set postgrad venue (dry-run by default)",
  ).build(),
  task(["operator", "set-resolver-role"], "Grant or revoke an order-manager resolver role")
    .addOption(stringOption("account", "Account whose resolver role changes"))
    .addOption(stringOption("allowed", "true to grant, false to revoke"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setResolverRoleAction)
    .build(),
  task(["operator", "set-hook-role"], "Grant or revoke an order-manager hook role")
    .addOption(stringOption("account", "Hook address whose role changes"))
    .addOption(stringOption("allowed", "true to grant, false to revoke"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setHookRoleAction)
    .build(),
  task(["operator", "set-pool-whitelisted"], "Whitelist or delist a market pool for maker orders")
    .addOption(stringOption("side", "Market pool side: yes or no"))
    .addOption(stringOption("whitelisted", "true to whitelist, false to delist"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setPoolWhitelistedAction)
    .build(),
  task(
    ["operator", "set-maximum-execution-count"],
    "Set the order manager's per-batch execution cap",
  )
    .addOption(stringOption("count", "Maximum crossed order IDs per execution batch"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setMaximumExecutionCountAction)
    .build(),
  task(
    ["operator", "set-minimum-order-amount"],
    "Set the order manager's minimum maker input for a token",
  )
    .addOption(stringOption("token", "ERC20 token address (or use --side)"))
    .addOption(stringOption("side", "Market outcome side (yes or no) resolving the token"))
    .addOption(stringOption("amount", "Minimum maker input as a decimal token amount (0 clears)"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setMinimumOrderAmountAction)
    .build(),
  task(["operator", "resolve-market"], "Resolve the complete-set market to a winning side")
    .addOption(stringOption("side", "Winning side: yes or no"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(resolveMarketAction)
    .build(),
  task(["operator", "cancel-market"], "Cancel the complete-set market (draw redemption)")
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(cancelMarketAction)
    .build(),
  task(["operator", "set-trusted-creator"], "Grant or revoke pregrad trusted-creator status")
    .addOption(stringOption("account", "Account whose trusted-creator status changes"))
    .addOption(stringOption("trusted", "true to grant, false to revoke"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setTrustedCreatorAction)
    .build(),
  task(["operator", "set-market-creation-paused"], "Pause or resume pregrad market creation")
    .addOption(stringOption("paused", "true to pause, false to resume"))
    .addFlag(EXECUTE_FLAG)
    .setInlineAction(setMarketCreationPausedAction)
    .build(),
];

export default postgradAdminTasks;
