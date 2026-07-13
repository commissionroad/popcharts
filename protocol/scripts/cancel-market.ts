import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import type { Address } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { runScript } from "./shared/cli/runScript.js";
import { collectVenueAddressEntries } from "./shared/deployment/venueManifest.js";
import { readJsonFile } from "./shared/json/jsonFile.js";
import { parseMarketIdArgument } from "./shared/market/parseMarketIdArgument.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";

// MarketTypes.MarketStatus enum order, for human-readable operator output.
const MARKET_STATUS_NAMES = [
  "Active",
  "Frozen",
  "Graduating",
  "Graduated",
  "Refunded",
  "Resolved",
  "Cancelled",
  "UnderReview",
  "Rejected",
] as const;

// The env var the just target sets; operators may also pass the id as the
// trailing CLI argument when invoking the script directly.
const MARKET_ID_ENV = "POPCHARTS_CANCEL_MARKET_ID";

/**
 * Operator kill switch (ADR 0011): calls `cancelMarket(marketId)` on the
 * deployed PregradManager with the operator/manager key, halting an Active
 * market and opening full refunds. The id may be a bare uint256 ("9") or the
 * composite "chainId:marketId" shown in the app URL ("31337:9"), so an operator
 * can paste straight from the address bar. `cancelMarket` is onlyOwner and
 * requires Active status; those guards stay on-chain — this script only reads
 * back the current status for confirmation and surfaces a readable error when
 * the transaction reverts.
 */
async function main(): Promise<void> {
  const { account, chainId, connection, profile, publicClient } =
    await initializeWalletScriptEnvironment({ accountRole: "operator", network });

  const parsed = parseMarketIdArgument(readMarketIdInput());
  if (parsed.chainId !== undefined && parsed.chainId !== chainId) {
    throw new Error(
      `Market id names chain ${parsed.chainId}, but the connected network is chain ${chainId}. ` +
        "Select the market's own chain (the number after the colon is the marketId).",
    );
  }
  const { marketId } = parsed;

  const pregradManagerAddress = await resolvePregradManagerAddress({
    chainEnv: profile.chainEnv,
    chainId,
    env: process.env,
    protocolRoot: hre.config.paths.root,
  });
  const manager = await connection.viem.getContractAt("PregradManager", pregradManagerAddress);

  // getMarketState reverts for an id that does not exist, so a revert here means
  // "no such market" rather than a real failure; report it as unreadable.
  const readStatus = async (): Promise<number | undefined> => {
    try {
      const state = (await manager.read.getMarketState([marketId])) as {
        readonly status: bigint | number;
      };
      return Number(state.status);
    } catch {
      return undefined;
    }
  };

  console.log(`Pop Charts operator: cancel market (${profile.chainName}, chain ${chainId})`);
  console.log(`PregradManager: ${pregradManagerAddress}`);
  console.log(`Operator account: ${account}`);
  console.log(`Market id: ${marketId}`);
  console.log(`Current status: ${describeStatus(await readStatus())}`);

  console.log(
    "Broadcasting cancelMarket (opens full refunds; onlyOwner + Active enforced on-chain)...",
  );
  const hash = await manager.write.cancelMarket([marketId]);
  await requireSuccessfulReceipt(publicClient, hash, `cancelMarket(${marketId})`);

  console.log(`cancelMarket(${marketId}) confirmed (${hash}).`);
  console.log(`Final status: ${describeStatus(await readStatus())}. Full refunds are now open.`);
}

// Prefer the env var the just target sets; fall back to the first CLI argument
// that looks like a market id so the script also works when run directly.
function readMarketIdInput(): string {
  const fromEnv = process.env[MARKET_ID_ENV];
  if (fromEnv !== undefined && fromEnv.trim().length !== 0) {
    return fromEnv;
  }
  const fromArgv = process.argv.slice(2).find((arg) => /^\d+(:\d+)?$/.test(arg.trim()));
  if (fromArgv !== undefined) {
    return fromArgv;
  }
  throw new Error(
    `Set ${MARKET_ID_ENV} (or pass the id as an argument) to the market id to cancel, ` +
      'e.g. "9" or "31337:9" copied from the market detail URL.',
  );
}

function describeStatus(status: number | undefined): string {
  if (status === undefined) {
    return "unreadable (market id may not exist on this chain)";
  }
  return `${MARKET_STATUS_NAMES[status] ?? `Unknown(${status})`} (${status})`;
}

// The PregradManager address lives in the postgrad deploy manifest, matching how
// the postgrad admin CLI resolves it; fail with a pointer to the deploy when the
// manifest is missing or targets another chain.
async function resolvePregradManagerAddress(args: {
  readonly chainEnv: string;
  readonly chainId: number;
  readonly env: NodeJS.ProcessEnv;
  readonly protocolRoot: string;
}): Promise<Address> {
  const manifestFile = resolve(
    args.protocolRoot,
    args.env.POPCHARTS_POSTGRAD_DEPLOYMENT_FILE ||
      `deployments/${args.chainEnv}.postgrad.local.json`,
  );
  const manifestPath = relative(args.protocolRoot, manifestFile);

  let manifest: unknown;
  try {
    manifest = await readJsonFile(manifestFile);
  } catch {
    throw new Error(
      `Could not read postgrad manifest ${manifestPath}. Run the postgrad deploy first ` +
        "(pnpm local:deploy-postgrad or pnpm arc:testnet:deploy-postgrad).",
    );
  }

  const manifestChainId =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).chainId
      : undefined;
  if (manifestChainId !== args.chainId) {
    throw new Error(
      `Postgrad manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${args.chainId}.`,
    );
  }

  const entry = collectVenueAddressEntries(manifest).find(
    (candidate) => candidate.name === "pregradManager",
  );
  if (entry === undefined) {
    throw new Error(`Postgrad manifest ${manifestPath} has no pregradManager address entry.`);
  }
  return entry.address;
}

await runScript(main);
