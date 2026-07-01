import type { Address } from "viem";

export declare const DEFAULT_VENUE_DEPLOYMENT_FILE: "deployments/venue-stack.json";

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

export declare function normalizeVenueContractEntries(
  contractSpecs: readonly VenueContractSpec[],
): VenueContract[];

export declare function parseVenueContractSpec(contractSpec: VenueContractSpec): VenueContract;

export declare function formatVenueContractEntry(
  contract: VenueContract,
): VenueManifestContractEntry;

export declare function collectVenueAddressEntries(
  manifest: unknown,
  requiredKeys?: ReadonlySet<string>,
): VenueAddressEntry[];
