#!/usr/bin/env -S node --experimental-strip-types

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateLocalPregradDeployment } from "./shared/chain/validateLocalPregradDeployment.ts";
import { parseSmokeMarket } from "./shared/deployments/smokeMarket.ts";
import { DEFAULT_HARDHAT_ACCOUNT_ADDRESS } from "./shared/chain/defaultHardhatPrivateKey.ts";
import {
  depositCommandEnv,
  hasIndexedCredit,
  INDEXING_TIMEOUT_MS,
  topUpAmountWad,
  waitForIndexedCredit,
} from "./shared/localMarket/autoTopUpCredit.ts";
import {
  createDraftApi,
  DraftApiError,
  draftWriteFrom,
  parsePublishTransactionHash,
} from "./shared/localMarket/draftFlow.ts";
import { localChainEnvFile } from "./shared/env/localDevEnvFiles.ts";
import { readEnvFile } from "./shared/env/readEnvFile.ts";
import { resolveIndexerApiBaseUrl } from "./shared/env/resolveIndexerApiBaseUrl.ts";
import { buildGeneratedMarket } from "./shared/localMarket/generatedMarketPlan.ts";
import { readExistingGeneratedMarketOptions } from "./shared/localMarket/indexedMarketOptions.ts";
import {
  parseLocalCreateMarketArgs,
  printLocalCreateMarketUsage,
  type LocalCreateMarketOptions,
} from "./shared/localMarket/parseLocalCreateMarketArgs.ts";
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
      rejectable: options.rejectable,
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
  await validateLocalPregradDeployment({ env: commandEnv, envFile, rpcUrl });
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
    rejectable: options.rejectable,
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

  // The market is created THROUGH the API's draft flow — the same reviewed,
  // authorized path the product uses (repo ADR 0022 P5 removed the ungated
  // contract path this script previously called). The draft owner and the
  // publishing wallet default to the first Hardhat account.
  const creatorAddress = DEFAULT_HARDHAT_ACCOUNT_ADDRESS;
  const drafts = createDraftApi({ apiBaseUrl, owner: creatorAddress });

  const draft = await drafts.create(
    draftWriteFrom(generatedMarket, creatorAddress),
  );
  console.log(`[${logLabel}] draft ${draft.id} created via ${apiBaseUrl}`);
  await submitWithAutoTopUp({
    chainEnv,
    commandEnv,
    creatorAddress,
    draftId: draft.id,
    drafts,
    vaultAddress: commandEnv.LOCAL_REVIEW_CREDIT_VAULT_ADDRESS,
  });
  console.log(`[${logLabel}] submitted for review`);

  const reviewed = await drafts.waitForReview(draft.id);

  if (reviewed.status !== "approved") {
    console.log(
      `[${logLabel}] review outcome: ${reviewed.status} — no market published`,
    );
    for (const item of reviewed.feedback) {
      console.log(`[${logLabel}]   - ${item}`);
    }
    return;
  }

  if (generatedMarket.incoherent) {
    // Publishing anyway keeps the run useful, but silence here reads as "the
    // reject path works" when nothing tested it.
    console.warn(
      `[${logLabel}] NOTE: review APPROVED the intentionally incoherent ` +
        `market, so this run did not exercise the reject path. Local stacks ` +
        `gate drafts with the claude-cli model by default, so either this ` +
        `stack was dialed to LOCAL_DRAFT_REVIEW_PROVIDER=heuristic (which ` +
        `matches patterns, not meaning) or the model missed the ` +
        `contradiction.`,
    );
  }

  console.log(`[${logLabel}] approved; minting publish authorization`);
  const publishPayload = await drafts.publishParams(draft.id, creatorAddress);

  if (!publishPayload.authorization) {
    throw new Error(
      "The API minted no creation authorization — is this stack armed? Redeploy contracts (just local-dev) and retry.",
    );
  }

  const output = await run(
    "pnpm",
    ["--dir", "protocol", "run", "local:publish-authorized-market"],
    {
      env: {
        ...commandEnv,
        ...chainEnv,
        POPCHARTS_PUBLISH_PAYLOAD: JSON.stringify({
          authorization: publishPayload.authorization,
          params: {
            bypassAiResolution: publishPayload.bypassAiResolution,
            collateral: publishPayload.collateral,
            graduationDeadline: publishPayload.graduationDeadline,
            graduationThreshold: publishPayload.graduationThreshold,
            liquidityParameter: publishPayload.liquidityParameter,
            metadata: publishPayload.metadata,
            metadataHash: publishPayload.metadataHash,
            openingProbabilityWad: publishPayload.openingProbabilityWad,
            resolutionTime: publishPayload.resolutionTime,
            yesNotBefore: publishPayload.yesNotBefore,
          },
        }),
      },
    },
  );
  const market = parseSmokeMarket(output.stdout);
  const transactionHash = parsePublishTransactionHash(output.stdout);

  await drafts.markPublished(draft.id, {
    chainId: market.chainId,
    marketId: market.marketId,
    transactionHash,
  });
  console.log(
    `[${logLabel}] market ${market.marketId} published from draft ${draft.id}`,
  );
}

/**
 * Submits the draft, and if the review-credit meter refuses it (402), tops the
 * creator up and submits again — the CLI equivalent of the app's deposit
 * panel, which recovers from the same refusal without the creator retyping
 * anything. Any other failure propagates untouched.
 */
async function submitWithAutoTopUp({
  chainEnv,
  commandEnv,
  creatorAddress,
  draftId,
  drafts,
  vaultAddress,
}: {
  readonly chainEnv: NodeJS.ProcessEnv;
  readonly commandEnv: NodeJS.ProcessEnv;
  readonly creatorAddress: string;
  readonly draftId: string;
  readonly drafts: ReturnType<typeof createDraftApi>;
  readonly vaultAddress: string | undefined;
}): Promise<void> {
  try {
    await drafts.submit(draftId);
    return;
  } catch (error) {
    if (
      !(error instanceof DraftApiError) ||
      error.status !== 402 ||
      !error.shortfall
    ) {
      throw error;
    }

    if (!vaultAddress) {
      throw new Error(
        `${error.message}\nNo LOCAL_REVIEW_CREDIT_VAULT_ADDRESS in the loaded env, so this run cannot top up. Redeploy contracts (just local-dev) and retry.`,
      );
    }

    const { shortfall } = error;
    const sleep = (ms: number) =>
      new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

    // An earlier run's deposit may be indexing right now — its own wait timed
    // out and told the operator to rerun. Depositing again would buy credit
    // that is already paid for, and credit is non-refundable.
    const alreadyCovered = await hasIndexedCredit({
      readCredit: () => drafts.credit(creatorAddress),
      requiredWad: shortfall.requiredWad,
    });

    if (alreadyCovered) {
      console.log(
        `[${logLabel}] credit already covers this run — resubmitting without depositing`,
      );
    } else {
      const amountWad = topUpAmountWad(shortfall);
      console.log(
        `[${logLabel}] out of review credit (${shortfall.runsUsed} run(s) used) — depositing ${amountWad} wei for ${creatorAddress}`,
      );

      await run(
        "pnpm",
        ["--dir", "protocol", "run", "local:deposit-review-credit"],
        {
          env: depositCommandEnv({
            amountWad,
            beneficiary: creatorAddress,
            chainEnv,
            commandEnv,
            vaultAddress,
          }),
        },
      );

      // The gate reads the server's indexed rows, not the chain, so a
      // confirmed deposit is not yet spendable — retrying now would hit the
      // same 402.
      const indexed = await waitForIndexedCredit({
        readCredit: () => drafts.credit(creatorAddress),
        requiredWad: shortfall.requiredWad,
        sleep,
      });

      if (!indexed) {
        throw new Error(
          `The deposit confirmed on-chain but has not reached the indexed view after ${INDEXING_TIMEOUT_MS}ms. It is not lost — rerun 'just local-create-market' in a moment, and this run's credit will be spent rather than bought again.`,
        );
      }

      console.log(`[${logLabel}] credit topped up; resubmitting`);
    }

    try {
      await drafts.submit(draftId);
    } catch (retryError) {
      if (
        retryError instanceof DraftApiError &&
        retryError.status === 402 &&
        retryError.shortfall
      ) {
        // Topping up cleared the shortfall this run measured, so a second
        // refusal means the price moved underneath it (the rate is server
        // configuration). Say that rather than repeating a raw 402.
        throw new Error(
          `Still refused after topping up: the meter now wants ${retryError.shortfall.requiredWad} wei per review. The rate changed mid-run — rerun 'just local-create-market'.`,
        );
      }

      throw retryError;
    }
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
