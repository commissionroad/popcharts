#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Reached by relative path, not by package name: the root workspace declares
// no dependencies, so there is no `@popcharts/local-chain-tools` symlink to
// resolve from here. Node strips the types of a file outside node_modules,
// and the bare `viem` import inside that package resolves from the package
// itself — which is why the chain probe can use viem while this lane stays
// dependency-free.
import { validateLocalPregradDeployment } from "../packages/local-chain-tools/src/validateLocalPregradDeployment.ts";
import { staleStackRecovery } from "./shared/chain/staleStackRecovery.ts";
import { parseSmokeMarket } from "./shared/deployments/smokeMarket.ts";
import { getErrorMessage } from "./shared/errors/getErrorMessage.ts";
import { localChainEnvFile } from "./shared/env/localDevEnvFiles.ts";
import { readEnvFile } from "./shared/env/readEnvFile.ts";
import { resolveIndexerApiBaseUrl } from "./shared/env/resolveIndexerApiBaseUrl.ts";
import { buildProtocolCommandEnv } from "./shared/localMarket/buildProtocolCommandEnv.ts";
import { buildGeneratedMarket } from "./shared/localMarket/generatedMarketPlan.ts";
import { readExistingGeneratedMarketOptions } from "./shared/localMarket/indexedMarketOptions.ts";
import {
  parseLocalCreateMarketArgs,
  printLocalCreateMarketUsage,
  type LocalCreateMarketOptions,
} from "./shared/localMarket/parseLocalCreateMarketArgs.ts";
import { persistMarketMetadata } from "./shared/localMarket/persistMarketMetadata.ts";
import { BASE_CHAIN_ID } from "./shared/localStack/ports.ts";
import { promptForStack } from "./shared/localStack/promptForStack.ts";
import { resolveProtocolChainEnv } from "./shared/localStack/protocolChainEnv.ts";
import {
  pruneDeadDescriptors,
  type StackDescriptor,
} from "./shared/localStack/registry.ts";
import {
  resolveTargetStack,
  TargetStackResolutionError,
} from "./shared/localStack/resolveTargetStack.ts";
import { repoRoot, protocolDir, resolveRepoPath } from "./shared/paths.ts";

/**
 * Creates one local market against the currently running local dev chain.
 * Generates a near-term crypto or weather market from live public sources,
 * creates it onchain through the protocol helper, then saves the matching
 * metadata to the local API so the app can render the market it created.
 */

// This script's own name, prefixed onto every line it prints and threaded
// into the shared helpers it calls so they never name their caller.
const logLabel = "local-create-market";

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    if (error instanceof TargetStackResolutionError) {
      console.error(error.message);
    } else {
      console.error(
        `\n[${logLabel}] ${error instanceof Error ? error.message : error}`,
      );
    }
    process.exit(1);
  });
}

async function main(): Promise<void> {
  const options = parseLocalCreateMarketArgs(rawArgs);

  if (options.help) {
    printLocalCreateMarketUsage();
    return;
  }

  if (options.preview) {
    const generatedMarket = await buildGeneratedMarket({
      kind: options.kind,
      logLabel,
      usedOptionKeys: new Set(),
    });
    console.log(
      JSON.stringify(
        {
          graduationSeconds: generatedMarket.graduationSeconds,
          kind: generatedMarket.kind,
          metadata: generatedMarket.metadata,
          resolutionSeconds: generatedMarket.resolutionSeconds,
        },
        null,
        2,
      ),
    );
    return;
  }

  // Only `--local-chain-env` bypasses stack resolution: it names the chain
  // outright. `--api-url` says nothing about which chain to create on, so
  // letting it bypass too used to leave the run creating markets on slot 0
  // while saving their metadata to another slot's API.
  const target =
    options.envFile === undefined
      ? await resolveRegisteredStack(options)
      : undefined;
  const envFile =
    target?.envFilePath ??
    options.envFile ??
    resolveRepoPath(
      process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ?? localChainEnvFile,
    );
  const envFileExists = existsSync(envFile);
  const fileEnv = envFileExists ? readEnvFile(envFile) : {};
  const commandEnv: NodeJS.ProcessEnv = { ...process.env, ...fileEnv };
  const chainEnv = resolveProtocolChainEnv(commandEnv, target);
  const rpcUrl = chainEnv.POPCHARTS_LOCAL_RPC_URL;

  validateLocalEnv({ env: commandEnv, envFile, envFileExists });
  await validateLocalPregradDeployment({
    expectedChainId: BASE_CHAIN_ID,
    managerAddress: commandEnv.PREGRAD_MANAGER_ADDRESS ?? "",
    recoveryHint: staleStackRecovery({ envFile, rpcUrl }),
    rpcUrl,
  });
  ensureDependenciesInstalled();

  // An explicit --api-url wins over the resolved stack's own API port, so the
  // flag never silently does nothing.
  const apiBaseUrl = resolveIndexerApiBaseUrl(
    options.apiBaseUrl ??
      (target ? `http://127.0.0.1:${target.apiPort}` : undefined),
    commandEnv,
  );
  const usedOptionKeys = await readExistingGeneratedMarketOptions({
    apiBaseUrl,
    chainId: BASE_CHAIN_ID,
    logLabel,
  });
  const generatedMarket = await buildGeneratedMarket({
    kind: options.kind,
    logLabel,
    usedOptionKeys,
  });

  if (envFileExists) {
    console.log(`[${logLabel}] loading ${envFile}`);
  }

  // The chain this run targets is printed because a mis-targeted run is
  // otherwise silent: it creates the market on another slot's chain and still
  // reports success.
  console.log(`[${logLabel}] chain: ${rpcUrl}`);
  console.log(`[${logLabel}] generated ${generatedMarket.kind} market`);
  console.log(`[${logLabel}] question: ${generatedMarket.metadata.question}`);
  console.log(
    `[${logLabel}] resolution source: ${
      generatedMarket.metadata.resolutionUrl ?? "none"
    }`,
  );

  const output = await run(
    "pnpm",
    ["--dir", "protocol", "run", "local:create-market"],
    {
      env: buildProtocolCommandEnv({
        baseEnv: commandEnv,
        chainEnv,
        generatedMarket,
      }),
    },
  );
  const market = parseSmokeMarket(output.stdout);

  try {
    await persistMarketMetadata({
      apiBaseUrl,
      chainId: market.chainId,
      metadata: generatedMarket.metadata,
      metadataHash: market.metadataHash,
    });
    console.log(`[${logLabel}] metadata saved to ${apiBaseUrl}`);
  } catch (error) {
    console.warn(
      `[${logLabel}] metadata sync failed: ${getErrorMessage(error)}`,
    );
  }
}

async function resolveRegisteredStack(
  options: LocalCreateMarketOptions,
): Promise<StackDescriptor> {
  const live = await pruneDeadDescriptors();
  return resolveTargetStack({
    liveStacks: live,
    token: options.stack ?? process.env.POPCHARTS_STACK,
    chooseStack: process.stdin.isTTY ? promptForStack : undefined,
  });
}

function validateLocalEnv({
  env,
  envFile,
  envFileExists,
}: {
  readonly env: NodeJS.ProcessEnv;
  readonly envFile: string;
  readonly envFileExists: boolean;
}): void {
  const missing: string[] = [];

  if (!env.PREGRAD_MANAGER_ADDRESS) {
    missing.push("PREGRAD_MANAGER_ADDRESS");
  }

  if (!env.LOCAL_COLLATERAL_ADDRESS && !env.COLLATERAL_ADDRESS) {
    missing.push("LOCAL_COLLATERAL_ADDRESS");
  }

  if (missing.length === 0) {
    return;
  }

  const source = envFileExists
    ? `${envFile} is missing ${missing.join(", ")}`
    : `Missing ${envFile}`;

  throw new Error(
    `${source}. Start the local stack with 'just local-dev-control' or ` +
      "'just local-dev', wait for contract deployment to complete, then run " +
      "'just local-create-market' again.",
  );
}

function ensureDependenciesInstalled(): void {
  if (existsSync(resolve(protocolDir, "node_modules"))) {
    return;
  }

  throw new Error(
    "Missing protocol/node_modules. Run 'just setup' before 'just local-create-market'.",
  );
}

// The protocol helper's output streams through unprefixed (the developer is
// watching one command, not a multi-service stack) while stdout is captured
// for the LOCAL_CHAIN_SMOKE_MARKET marker.
async function run(
  command: string,
  args: readonly string[],
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<{ stderr: string; stdout: string }> {
  const child = spawn(command, [...args], {
    cwd: repoRoot,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });

  const code = await new Promise<number>((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}.`,
    );
  }

  return { stderr, stdout };
}
