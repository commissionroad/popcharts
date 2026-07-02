import { relative, resolve } from "node:path";

import type { Address } from "viem";

import { readJsonFile } from "../json/jsonFile.js";
import { collectVenueAddressEntries } from "./venueManifest.js";
import { VENUE_STACK_DEPLOYMENT } from "./venueStack.js";

/**
 * Reads one contract address from the venue-stack manifest for this chain,
 * failing with a pointer to the venue deploy when the manifest or the entry
 * is missing, so smoke flows never guess at venue addresses.
 */
export async function readVenueStackAddress(args: {
  readonly chainEnv: string;
  readonly env: NodeJS.ProcessEnv;
  readonly expectedChainId: number;
  readonly name: string;
  readonly protocolRoot: string;
}): Promise<Address> {
  const manifestFile = resolve(
    args.protocolRoot,
    args.env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
      VENUE_STACK_DEPLOYMENT.defaultDeploymentFile(args.chainEnv),
  );
  const manifestPath = relative(args.protocolRoot, manifestFile);

  let manifest: unknown;
  try {
    manifest = await readJsonFile(manifestFile);
  } catch {
    throw new Error(
      `Could not read venue manifest ${manifestPath}. Run the venue-stack deploy first ` +
        "(pnpm local:deploy-venue or pnpm arc:testnet:deploy-venue).",
    );
  }

  const manifestChainId =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).chainId
      : undefined;
  if (manifestChainId !== args.expectedChainId) {
    throw new Error(
      `Venue manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${args.expectedChainId}.`,
    );
  }

  const entry = collectVenueAddressEntries(manifest).find(
    (candidate) => candidate.name === args.name,
  );
  if (entry === undefined) {
    throw new Error(`Venue manifest ${manifestPath} has no ${args.name} address entry.`);
  }
  return entry.address;
}
