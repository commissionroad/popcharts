#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const protocolDir = resolve(repoRoot, "protocol");
const defaultEnvFile = resolve(repoRoot, "server", ".env.local-chain");

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");

main().catch((error) => {
  console.error(`\n[local-create-market] ${error.message}`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(rawArgs);

  if (options.help) {
    printUsage();
    return;
  }

  const envFile =
    options.envFile ??
    resolvePath(process.env.POPCHARTS_LOCAL_CHAIN_ENV_FILE ?? defaultEnvFile);
  const envFileExists = existsSync(envFile);
  const fileEnv = envFileExists ? readEnvFile(envFile) : {};
  const commandEnv = { ...process.env, ...fileEnv };

  if (options.metadataUri) {
    commandEnv.LOCAL_MARKET_METADATA = options.metadataUri;
  }

  validateLocalEnv(commandEnv, envFile, envFileExists);
  ensureDependenciesInstalled();

  if (envFileExists) {
    console.log(`[local-create-market] loading ${envFile}`);
  }

  await inherit("pnpm", ["--dir", "protocol", "run", "local:create-market"], {
    env: commandEnv,
  });
}

function parseArgs(args) {
  const options = {
    envFile: undefined,
    help: false,
    metadataUri: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--local-chain-env") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--local-chain-env requires a path.");
      }
      options.envFile = resolvePath(value);
      index += 1;
    } else if (arg.startsWith("--local-chain-env=")) {
      options.envFile = resolvePath(arg.slice("--local-chain-env=".length));
    } else if (arg === "--metadata-uri") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--metadata-uri requires a value.");
      }
      options.metadataUri = value;
      index += 1;
    } else if (arg.startsWith("--metadata-uri=")) {
      options.metadataUri = arg.slice("--metadata-uri=".length);
    } else {
      throw new Error(`Unknown option ${arg}. Use --help.`);
    }
  }

  return options;
}

function printUsage() {
  console.log(`Usage: pnpm run local:create-market -- [options]

Create one local market against the currently running local development chain.

Options:
  --local-chain-env <path>  Load a generated local-chain env file.
                            Defaults to server/.env.local-chain.
  --metadata-uri <uri>      Override the metadata URI hashed into the market event.
  -h, --help                Show this help.

Start the local stack first with 'just local-dev-control' or 'just local-dev'.`);
}

function ensureDependenciesInstalled() {
  if (existsSync(resolve(protocolDir, "node_modules"))) {
    return;
  }

  throw new Error(
    "Missing protocol/node_modules. Run 'just setup' before 'just local-create-market'.",
  );
}

function validateLocalEnv(env, envFile, envFileExists) {
  const missing = [];

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

function readEnvFile(path) {
  const env = {};
  const text = readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = value;
  }

  return env;
}

function resolvePath(path) {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function inherit(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: options.env,
    stdio: "inherit",
  });

  const code = await new Promise((resolveCode, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolveCode(exitCode ?? 0));
  });

  if (code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${code}.`,
    );
  }
}
