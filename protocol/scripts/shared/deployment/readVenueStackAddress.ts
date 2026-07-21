import type { Address } from "viem";

import { VENUE_STACK_DEPLOYMENT } from "../../../src/deployment/venueStackDeployment.js";
import { readManifestAddress } from "./readManifestAddresses.js";
import { resolveDeploymentManifestFile } from "./resolveDeploymentManifestFile.js";

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
  return readManifestAddress({
    deployHint: VENUE_STACK_DEPLOYMENT.deployHint,
    expectedChainId: args.expectedChainId,
    kind: "venue",
    manifestFile: resolveDeploymentManifestFile(VENUE_STACK_DEPLOYMENT, args),
    name: args.name,
    protocolRoot: args.protocolRoot,
  });
}
