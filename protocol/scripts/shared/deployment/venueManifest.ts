import { getAddress, isAddress, type Address } from "viem";

import { requireAddress, requireNonNegativeInteger } from "../cli/requireCliValue.js";

export const DEFAULT_VENUE_DEPLOYMENT_FILE = "deployments/venue-stack.json";

const ADDRESS_CONTAINERS = ["contracts", "addresses", "probes"];
const CONTRACT_ENTRY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const NON_CONTRACT_ADDRESS_FIELDS = new Set([
  "admin",
  "deployer",
  "feeRecipient",
  "owner",
  "resolver",
]);

export type VenueContractSpec = {
  readonly required: boolean;
  readonly spec: string;
};

export type VenueContract = {
  readonly address: Address;
  readonly blockNumber?: string;
  readonly name: string;
  readonly required: boolean;
};

export type VenueManifestContractEntry = {
  readonly address: Address;
  readonly blockNumber?: string;
  readonly required: boolean;
};

export type VenueAddressEntry = {
  readonly address: Address;
  readonly name: string;
  readonly required: boolean;
};

type AddressEntryMap = Map<string, VenueAddressEntry>;
type UnknownRecord = Record<string, unknown>;

/**
 * Normalizes CLI contract specs into sorted manifest contract entries.
 */
export function normalizeVenueContractEntries(
  contractSpecs: readonly VenueContractSpec[],
): VenueContract[] {
  const contracts = new Map<string, VenueContract>();
  for (const contractSpec of contractSpecs) {
    const contract = parseVenueContractSpec(contractSpec);
    if (contracts.has(contract.name)) {
      throw new Error(`Duplicate contract entry: ${contract.name}`);
    }
    contracts.set(contract.name, contract);
  }

  return [...contracts.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Parses a manifest contract spec written as name=address or name=address@block.
 */
export function parseVenueContractSpec({ required, spec }: VenueContractSpec): VenueContract {
  const separatorIndex = spec.indexOf("=");
  if (separatorIndex <= 0 || separatorIndex === spec.length - 1) {
    throw new Error(`Expected contract entry to use name=address or name=address@block: ${spec}`);
  }

  const name = spec.slice(0, separatorIndex).trim();
  if (!CONTRACT_ENTRY_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid contract entry name: ${name}. Use letters, numbers, ".", "-", or "_".`,
    );
  }

  const addressAndBlock = spec.slice(separatorIndex + 1).trim();
  const addressParts = addressAndBlock.split("@");
  if (addressParts.length > 2) {
    throw new Error(`Invalid contract entry block suffix: ${spec}`);
  }

  const [address, block] = addressParts;
  return {
    address: requireAddress(address, name),
    blockNumber:
      block === undefined ? undefined : requireNonNegativeInteger(block, name).toString(),
    name,
    required,
  };
}

/**
 * Formats a normalized contract entry for the venue deployment manifest.
 */
export function formatVenueContractEntry(contract: VenueContract): VenueManifestContractEntry {
  return {
    address: contract.address,
    ...(contract.blockNumber === undefined ? {} : { blockNumber: contract.blockNumber }),
    required: contract.required,
  };
}

/**
 * Collects checker-readable addresses from supported venue manifest shapes.
 */
export function collectVenueAddressEntries(
  manifest: unknown,
  requiredKeys?: ReadonlySet<string>,
): VenueAddressEntry[] {
  const entries: AddressEntryMap = new Map();
  collectTopLevelAddressEntries({ entries, manifest, requiredKeys });
  for (const container of ADDRESS_CONTAINERS) {
    collectContainerAddressEntries({
      entries,
      path: [container],
      requiredKeys,
      value: isPlainObject(manifest) ? manifest[container] : undefined,
    });
  }

  if (requiredKeys) {
    for (const requiredKey of requiredKeys) {
      if (!entries.has(requiredKey)) {
        entries.set(requiredKey, {
          address: "0x0000000000000000000000000000000000000000",
          name: requiredKey,
          required: true,
        });
      }
    }
  }

  return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function collectTopLevelAddressEntries({
  entries,
  manifest,
  requiredKeys,
}: {
  entries: AddressEntryMap;
  manifest: unknown;
  requiredKeys?: ReadonlySet<string>;
}): void {
  if (!isPlainObject(manifest)) {
    return;
  }

  for (const [key, value] of Object.entries(manifest)) {
    if (
      ADDRESS_CONTAINERS.includes(key) ||
      NON_CONTRACT_ADDRESS_FIELDS.has(key) ||
      !isAddressLike(value)
    ) {
      continue;
    }
    addAddressEntry({
      entries,
      name: key,
      required: requiredKeys ? requiredKeys.has(key) : true,
      value,
    });
  }
}

function collectContainerAddressEntries({
  entries,
  path,
  requiredKeys,
  value,
}: {
  entries: AddressEntryMap;
  path: readonly string[];
  requiredKeys?: ReadonlySet<string>;
  value: unknown;
}): void {
  if (!isPlainObject(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const name = [...path, key].slice(1).join(".");
    if (isAddressLike(child)) {
      addAddressEntry({
        entries,
        name,
        required: requiredKeys ? requiredKeys.has(name) : true,
        value: child,
      });
      continue;
    }
    if (isPlainObject(child) && isAddressLike(child.address)) {
      addAddressEntry({
        entries,
        name,
        required: requiredKeys ? requiredKeys.has(name) : child.required !== false,
        value: child.address,
      });
      continue;
    }
    collectContainerAddressEntries({
      entries,
      path: [...path, key],
      requiredKeys,
      value: child,
    });
  }
}

function addAddressEntry({
  entries,
  name,
  required,
  value,
}: {
  entries: AddressEntryMap;
  name: string;
  required: boolean;
  value: string;
}): void {
  const address = getAddress(value);
  entries.set(name, {
    address,
    name,
    required,
  });
}

function isAddressLike(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
