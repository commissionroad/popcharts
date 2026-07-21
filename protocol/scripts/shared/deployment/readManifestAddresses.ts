import { relative } from "node:path";

import type { Address } from "viem";

import { readJsonFile } from "../../../src/json/jsonFile.js";
import { collectVenueAddressEntries } from "./venueManifest.js";

/** Manifest location and validation context shared by both read helpers. */
export type ManifestReadArgs = {
  /** Command hint appended when the manifest file cannot be read. */
  readonly deployHint: string;
  readonly expectedChainId: number;
  /** Lowercase manifest kind for error messages, e.g. "venue" or "postgrad". */
  readonly kind: string;
  readonly manifestFile: string;
  /** Optional extra sentence appended to the chain-mismatch error. */
  readonly mismatchHint?: string;
  readonly protocolRoot: string;
};

/**
 * Reads named contract addresses from one deployment manifest: parses the
 * JSON, requires the manifest's chainId to match the connected chain, and
 * resolves every requested name via collectVenueAddressEntries — failing with
 * the caller's deploy hint so operators know which command produces the file.
 */
export async function readManifestAddresses<const TNames extends readonly string[]>(
  args: ManifestReadArgs & { readonly names: TNames },
): Promise<Record<TNames[number], Address>> {
  const manifestPath = relative(args.protocolRoot, args.manifestFile);
  const sentenceKind = args.kind.charAt(0).toUpperCase() + args.kind.slice(1);

  let manifest: unknown;
  try {
    manifest = await readJsonFile(args.manifestFile);
  } catch {
    throw new Error(`Could not read ${args.kind} manifest ${manifestPath}. ${args.deployHint}`);
  }

  const manifestChainId =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).chainId
      : undefined;
  if (manifestChainId !== args.expectedChainId) {
    throw new Error(
      `${sentenceKind} manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${args.expectedChainId}.` +
        (args.mismatchHint === undefined ? "" : ` ${args.mismatchHint}`),
    );
  }

  const entries = collectVenueAddressEntries(manifest);
  const addresses = {} as Record<TNames[number], Address>;
  for (const name of args.names) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (entry === undefined) {
      throw new Error(`${sentenceKind} manifest ${manifestPath} has no ${name} address entry.`);
    }
    addresses[name as TNames[number]] = entry.address;
  }
  return addresses;
}

/**
 * Single-name variant of readManifestAddresses for callers whose entry name
 * is a runtime string; returns the one address instead of a record whose key
 * set TypeScript could not narrow.
 */
export async function readManifestAddress(
  args: ManifestReadArgs & { readonly name: string },
): Promise<Address> {
  const { name, ...rest } = args;
  const addresses = await readManifestAddresses({ ...rest, names: [name] });
  return addresses[name];
}
