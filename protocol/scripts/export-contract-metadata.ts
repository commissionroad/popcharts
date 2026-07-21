import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PREGRAD_CONTRACT_NAME = "PregradManager";
const MOCK_COLLATERAL_CONTRACT_NAME = "MockCollateral";
const NETWORK_CHAIN_IDS = {
  local: 31337,
  arcTestnet: 5_042_002,
} as const satisfies Record<string, number>;

type ProtocolNetworkId = keyof typeof NETWORK_CHAIN_IDS;

type ContractDeployment = {
  address: `0x${string}`;
  deployBlock?: string;
};

type NetworkDeployment = {
  chainId: number;
  deployment: ContractDeployment | undefined;
};

type DeploymentsByNetwork = Record<ProtocolNetworkId, NetworkDeployment>;

type PostgradVenueNetworkDeployment = {
  chainId: number;
  contracts: Partial<Record<PostgradVenueSingletonKey, ContractDeployment>>;
};

type PostgradVenueDeploymentsByNetwork = Record<ProtocolNetworkId, PostgradVenueNetworkDeployment>;

// Deployment manifests that carry postgrad venue addresses. `market` entries
// are per-market manifests written by create-complete-set-market.ts; the
// others are singleton manifests written by the venue and postgrad deploys.
type PostgradVenueManifestId = "market" | "postgrad" | "venueStack";

type PostgradVenueContractSpec = {
  /** Hardhat artifact path relative to the protocol root. */
  artifactPath: string;
  /** camelCase identifier prefix for the emitted ABI constant. */
  camelName: string;
  /** Manifest that carries this contract's address. */
  manifest: PostgradVenueManifestId;
  /** Manifest field paths (dot notation) that carry this contract's address. */
  manifestKeys: readonly string[];
  /** Contract name matching the Hardhat artifact. */
  name: string;
  /** Whether one instance exists per market instead of per venue deployment. */
  perMarket: boolean;
};

// Singleton address keys exactly as the postgrad and venue-stack manifests
// (and the deployments/protocol.json registry) name their entries.
const POSTGRAD_VENUE_SINGLETON_KEYS = [
  "boundedHook",
  "orderManager",
  "poolTickBounds",
  "postgradAdapter",
  "swapRouter",
] as const;

type PostgradVenueSingletonKey = (typeof POSTGRAD_VENUE_SINGLETON_KEYS)[number];

// One entry per public postgrad venue contract, alphabetical by name so the
// generated module is deterministic.
const POSTGRAD_VENUE_CONTRACTS: readonly PostgradVenueContractSpec[] = [
  {
    artifactPath: "artifacts/contracts/v4/BoundedPoolOrderManager.sol/BoundedPoolOrderManager.json",
    camelName: "boundedPoolOrderManager",
    manifest: "postgrad",
    manifestKeys: ["orderManager"],
    name: "BoundedPoolOrderManager",
    perMarket: false,
  },
  {
    artifactPath: "artifacts/contracts/v4/BoundedPredictionHook.sol/BoundedPredictionHook.json",
    camelName: "boundedPredictionHook",
    manifest: "postgrad",
    manifestKeys: ["boundedHook"],
    name: "BoundedPredictionHook",
    perMarket: false,
  },
  {
    artifactPath:
      "artifacts/contracts/postgrad/CompleteSetBinaryMarket.sol/CompleteSetBinaryMarket.json",
    camelName: "completeSetBinaryMarket",
    manifest: "market",
    manifestKeys: ["market.address"],
    name: "CompleteSetBinaryMarket",
    perMarket: true,
  },
  {
    artifactPath:
      "artifacts/contracts/postgrad/CompleteSetPostgradAdapter.sol/CompleteSetPostgradAdapter.json",
    camelName: "completeSetPostgradAdapter",
    manifest: "postgrad",
    manifestKeys: ["postgradAdapter"],
    name: "CompleteSetPostgradAdapter",
    perMarket: false,
  },
  {
    artifactPath: "artifacts/contracts/v4/MinimalV4SwapRouter.sol/MinimalV4SwapRouter.json",
    camelName: "minimalV4SwapRouter",
    manifest: "venueStack",
    manifestKeys: ["swapRouter"],
    name: "MinimalV4SwapRouter",
    perMarket: false,
  },
  {
    artifactPath: "artifacts/contracts/postgrad/OutcomeToken.sol/OutcomeToken.json",
    camelName: "outcomeToken",
    manifest: "market",
    manifestKeys: ["market.noToken", "market.yesToken"],
    name: "OutcomeToken",
    perMarket: true,
  },
  {
    artifactPath: "artifacts/contracts/v4/PoolTickBounds.sol/PoolTickBounds.json",
    camelName: "poolTickBounds",
    manifest: "postgrad",
    manifestKeys: ["poolTickBounds"],
    name: "PoolTickBounds",
    perMarket: false,
  },
];

// This entrypoint runs via plain `node` inside `pnpm build`, before Hardhat's
// loader is available, so it stays self-contained instead of importing
// scripts/shared helpers.
const scriptDir = dirname(fileURLToPath(import.meta.url));
const protocolRoot = resolve(scriptDir, "..");
const pregradArtifactPath = resolve(
  protocolRoot,
  "artifacts/contracts/PregradManager.sol/PregradManager.json",
);
const mockCollateralArtifactPath = resolve(
  protocolRoot,
  "artifacts/contracts/mocks/MockCollateral.sol/MockCollateral.json",
);
const deploymentsPath = resolve(protocolRoot, "deployments/protocol.json");
const pregradOutputPath = resolve(protocolRoot, "src/generated/pregrad-manager.ts");
const postgradOutputPath = resolve(protocolRoot, "src/generated/postgrad-venue.ts");
const mockCollateralOutputPath = resolve(protocolRoot, "src/generated/mock-collateral.ts");

const checkOnly = process.argv.includes("--check");

async function main(): Promise<void> {
  const pregradArtifact = await readJson(pregradArtifactPath);
  assertArtifact(pregradArtifact, PREGRAD_CONTRACT_NAME, pregradArtifactPath);

  const mockCollateralArtifact = await readJson(mockCollateralArtifactPath);
  assertArtifact(mockCollateralArtifact, MOCK_COLLATERAL_CONTRACT_NAME, mockCollateralArtifactPath);

  const rawDeployments = await readJson(deploymentsPath);
  const pregradDeployments = normalizePregradDeployments(rawDeployments);
  const postgradDeployments = normalizePostgradVenueDeployments(rawDeployments);

  const postgradAbis: Record<string, readonly unknown[]> = {};
  for (const contract of POSTGRAD_VENUE_CONTRACTS) {
    const artifactPath = resolve(protocolRoot, contract.artifactPath);
    const artifact = await readJson(artifactPath);
    assertArtifact(artifact, contract.name, artifactPath);
    postgradAbis[contract.name] = artifact.abi;
  }

  const outputs: readonly { content: string; path: string }[] = [
    {
      content: await formatTypeScript(
        renderPregradMetadata({
          abi: pregradArtifact.abi,
          deployments: pregradDeployments,
        }),
        pregradOutputPath,
      ),
      path: pregradOutputPath,
    },
    {
      content: await formatTypeScript(
        renderPostgradVenueMetadata({
          abis: postgradAbis,
          deployments: postgradDeployments,
        }),
        postgradOutputPath,
      ),
      path: postgradOutputPath,
    },
    {
      content: await formatTypeScript(
        renderMockCollateralMetadata({ abi: mockCollateralArtifact.abi }),
        mockCollateralOutputPath,
      ),
      path: mockCollateralOutputPath,
    },
  ];

  if (checkOnly) {
    for (const output of outputs) {
      const current = existsSync(output.path) ? await readFile(output.path, "utf8") : "";

      if (current !== output.content) {
        console.error(
          `Generated contract metadata at ${output.path} is out of date. ` +
            "Run `pnpm --dir protocol build`.",
        );
        process.exitCode = 1;
      }
    }

    return;
  }

  for (const output of outputs) {
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function formatTypeScript(source: string, outputPath: string): Promise<string> {
  const prettier = await import("prettier");
  const config = (await prettier.resolveConfig(outputPath)) ?? {};

  return prettier.format(source, {
    ...config,
    filepath: outputPath,
  });
}

function assertArtifact(
  artifact: unknown,
  contractName: string,
  artifactPath: string,
): asserts artifact is { abi: readonly unknown[]; contractName: string } {
  if (!isPlainObject(artifact) || artifact.contractName !== contractName) {
    throw new Error(`Expected ${contractName} artifact at ${artifactPath}`);
  }

  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Expected ${contractName} artifact to include an ABI`);
  }
}

function normalizePregradDeployments(rawDeployments: unknown): DeploymentsByNetwork {
  const deployments: Partial<DeploymentsByNetwork> = {};

  for (const [networkId, chainId, contracts] of iterateNetworkContracts(rawDeployments)) {
    const deployment = contracts[PREGRAD_CONTRACT_NAME];
    deployments[networkId] = {
      chainId,
      deployment:
        deployment === undefined
          ? undefined
          : normalizeDeployment(deployment, PREGRAD_CONTRACT_NAME),
    };
  }

  return deployments as DeploymentsByNetwork;
}

function normalizePostgradVenueDeployments(
  rawDeployments: unknown,
): PostgradVenueDeploymentsByNetwork {
  const deployments: Partial<PostgradVenueDeploymentsByNetwork> = {};

  for (const [networkId, chainId, contracts] of iterateNetworkContracts(rawDeployments)) {
    const singletons: PostgradVenueNetworkDeployment["contracts"] = {};
    for (const singletonKey of POSTGRAD_VENUE_SINGLETON_KEYS) {
      const deployment = contracts[singletonKey];
      if (deployment !== undefined) {
        singletons[singletonKey] = normalizeDeployment(deployment, singletonKey);
      }
    }

    deployments[networkId] = { chainId, contracts: singletons };
  }

  return deployments as PostgradVenueDeploymentsByNetwork;
}

function* iterateNetworkContracts(
  rawDeployments: unknown,
): Generator<[ProtocolNetworkId, number, Record<string, unknown>]> {
  if (!isPlainObject(rawDeployments)) {
    throw new Error("Expected protocol deployment registry to be an object");
  }

  for (const [networkId, chainId] of Object.entries(NETWORK_CHAIN_IDS) as [
    ProtocolNetworkId,
    number,
  ][]) {
    const network = rawDeployments[networkId];

    if (!isPlainObject(network)) {
      throw new Error(`Missing deployment registry entry for ${networkId}`);
    }

    if (network.chainId !== chainId) {
      throw new Error(`Expected ${networkId} chainId ${chainId}, received ${network.chainId}`);
    }

    const contracts = network.contracts;
    if (!isPlainObject(contracts)) {
      throw new Error(`Expected ${networkId}.contracts to be an object`);
    }

    yield [networkId, chainId, contracts];
  }
}

function normalizeDeployment(deployment: unknown, entryName: string): ContractDeployment {
  if (!isPlainObject(deployment)) {
    throw new Error(`${entryName} deployment must be an object`);
  }

  if (!isAddress(deployment.address)) {
    throw new Error(`${entryName} deployment address is invalid`);
  }

  const normalized: ContractDeployment = {
    address: deployment.address,
  };

  if (deployment.deployBlock !== undefined) {
    normalized.deployBlock = normalizeDeployBlock(deployment.deployBlock, entryName);
  }

  return normalized;
}

function normalizeDeployBlock(value: unknown, entryName: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${entryName} deployBlock number must be a non-negative safe integer`);
    }

    return String(value);
  }

  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${entryName} deployBlock must be a non-negative decimal string`);
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

// Sorted, deduplicated event names so indexers can subscribe by name without
// re-deriving them from the ABI.
function collectEventNames(abi: readonly unknown[], contractName: string): string[] {
  const names = new Set<string>();

  for (const entry of abi) {
    if (!isPlainObject(entry) || entry.type !== "event") {
      continue;
    }
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      throw new Error(`${contractName} ABI contains an event without a name`);
    }
    names.add(entry.name);
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

function renderPregradMetadata({
  abi,
  deployments,
}: {
  abi: readonly unknown[];
  deployments: DeploymentsByNetwork;
}): string {
  return `// This file is generated by scripts/export-contract-metadata.ts.
// Do not edit it directly.

import type { Abi } from "viem";

export const protocolContractNames = ["${PREGRAD_CONTRACT_NAME}"] as const;
export type ProtocolContractName = (typeof protocolContractNames)[number];

export const protocolNetworkIds = ${JSON.stringify(
    Object.keys(NETWORK_CHAIN_IDS),
    null,
    2,
  )} as const;
export type ProtocolNetworkId = (typeof protocolNetworkIds)[number];

export type ProtocolAddress = \`0x\${string}\`;

export type ProtocolContractDeployment = {
  readonly address: ProtocolAddress;
  readonly deployBlock?: bigint;
};

export type ProtocolNetworkDeployment = {
  readonly chainId: number;
  readonly contracts: Partial<
    Record<ProtocolContractName, ProtocolContractDeployment>
  >;
};

export type ProtocolDeployments = Record<
  ProtocolNetworkId,
  ProtocolNetworkDeployment
>;

export type PregradManagerDeploymentMap = Record<
  ProtocolNetworkId,
  ProtocolContractDeployment | undefined
>;

export const pregradManagerAbi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;

export const protocolDeployments = ${renderProtocolDeployments(
    deployments,
  )} as const satisfies ProtocolDeployments;

export const pregradManagerDeployments = ${renderPregradManagerDeployments(
    deployments,
  )} as const satisfies PregradManagerDeploymentMap;

export const pregradManagerContract = {
  name: "${PREGRAD_CONTRACT_NAME}",
  abi: pregradManagerAbi,
  deployments: pregradManagerDeployments,
} as const;
`;
}

function renderMockCollateralMetadata({ abi }: { abi: readonly unknown[] }): string {
  return `// This file is generated by scripts/export-contract-metadata.ts.
// Do not edit it directly.

import type { Abi } from "viem";

// Dev-only mock collateral token deployed by deploy-devchain.ts. Exported so
// local funding flows mint against the compiled ABI instead of a hand-written
// mirror; it carries no deployment addresses because it only ever lives in
// throwaway local-devchain manifests.
export const mockCollateralAbi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;
`;
}

function renderProtocolDeployments(deployments: DeploymentsByNetwork): string {
  const lines = ["{"];

  for (const [networkId, { chainId, deployment }] of Object.entries(deployments)) {
    lines.push(`  ${networkId}: {`);
    lines.push(`    chainId: ${chainId},`);
    lines.push("    contracts: {");

    if (deployment) {
      lines.push(`      ${PREGRAD_CONTRACT_NAME}: ${renderDeployment(deployment)},`);
    }

    lines.push("    },");
    lines.push("  },");
  }

  lines.push("}");
  return lines.join("\n");
}

function renderPregradManagerDeployments(deployments: DeploymentsByNetwork): string {
  const lines = ["{"];

  for (const [networkId, { deployment }] of Object.entries(deployments)) {
    lines.push(`  ${networkId}: ${deployment ? renderDeployment(deployment) : "undefined"},`);
  }

  lines.push("}");
  return lines.join("\n");
}

function renderDeployment({ address, deployBlock }: ContractDeployment): string {
  const lines = ["{"];
  lines.push(`  address: "${address}",`);

  if (deployBlock !== undefined) {
    lines.push(`  deployBlock: ${deployBlock}n,`);
  }

  lines.push("}");
  return lines.join("\n");
}

function renderPostgradVenueMetadata({
  abis,
  deployments,
}: {
  abis: Record<string, readonly unknown[]>;
  deployments: PostgradVenueDeploymentsByNetwork;
}): string {
  const sections: string[] = [];

  sections.push(`// This file is generated by scripts/export-contract-metadata.ts.
// Do not edit it directly.
//
// Public metadata for the complete-set postgrad and bounded v4 venue surface:
// ABIs, indexer-relevant event names, manifest address sources, and singleton
// deployment entries from deployments/protocol.json. Manifest shapes and the
// pool discovery story are documented in docs/postgrad-contract-metadata.md.

import type { Abi } from "viem";

import type {
  ProtocolContractDeployment,
  ProtocolNetworkId,
} from "./pregrad-manager.js";

/** Contract names on the complete-set postgrad and bounded v4 venue surface. */
export const postgradVenueContractNames = ${JSON.stringify(
    POSTGRAD_VENUE_CONTRACTS.map((contract) => contract.name),
    null,
    2,
  )} as const;
export type PostgradVenueContractName =
  (typeof postgradVenueContractNames)[number];

/**
 * Deployment manifests that carry postgrad venue addresses: \`venueStack\` and
 * \`postgrad\` are singleton manifests written by the deploy scripts, and
 * \`market\` manifests are written per market by create-complete-set-market.ts.
 */
export const postgradVenueManifestIds = ["market", "postgrad", "venueStack"] as const;
export type PostgradVenueManifestId = (typeof postgradVenueManifestIds)[number];

/**
 * Singleton address keys exactly as the postgrad and venue-stack manifests
 * (and the deployments/protocol.json registry) name their entries.
 */
export const postgradVenueSingletonKeys = ${JSON.stringify(
    [...POSTGRAD_VENUE_SINGLETON_KEYS],
    null,
    2,
  )} as const;
export type PostgradVenueSingletonKey =
  (typeof postgradVenueSingletonKeys)[number];

/**
 * Where consumers find one contract's address without local assumptions:
 * the manifest that carries it and the manifest field paths (dot notation)
 * naming it. \`perMarket\` contracts have one instance per market manifest.
 */
export type PostgradVenueAddressSource = {
  readonly manifest: PostgradVenueManifestId;
  readonly manifestKeys: readonly string[];
  readonly perMarket: boolean;
};

/** Manifest address source for each postgrad venue contract. */
export const postgradVenueAddressSources = {
${POSTGRAD_VENUE_CONTRACTS.map(
  (contract) =>
    `  ${contract.name}: {
    manifest: "${contract.manifest}",
    manifestKeys: ${JSON.stringify([...contract.manifestKeys])},
    perMarket: ${contract.perMarket},
  },`,
).join("\n")}
} as const satisfies Record<PostgradVenueContractName, PostgradVenueAddressSource>;
`);

  for (const contract of POSTGRAD_VENUE_CONTRACTS) {
    const abi = abis[contract.name];
    if (abi === undefined) {
      throw new Error(`Missing ABI for ${contract.name}`);
    }
    sections.push(`/** ABI for ${contract.name}. */
export const ${contract.camelName}Abi = ${JSON.stringify(abi, null, 2)} as const satisfies Abi;
`);
  }

  sections.push(`/**
 * Event names each contract can emit, sorted for stable subscription lists.
 * Per-market OutcomeToken instances only emit the standard ERC20 events.
 */
export const postgradVenueEventNames = {
${POSTGRAD_VENUE_CONTRACTS.map(
  (contract) =>
    `  ${contract.name}: ${JSON.stringify(collectEventNames(abis[contract.name] ?? [], contract.name))},`,
).join("\n")}
} as const satisfies Record<PostgradVenueContractName, readonly string[]>;
export type PostgradVenueEventName =
  (typeof postgradVenueEventNames)[PostgradVenueContractName][number];

/** Singleton deployment entries for one network, keyed by manifest key. */
export type PostgradVenueNetworkDeployment = {
  readonly chainId: number;
  readonly contracts: Partial<
    Record<PostgradVenueSingletonKey, ProtocolContractDeployment>
  >;
};

export type PostgradVenueDeployments = Record<
  ProtocolNetworkId,
  PostgradVenueNetworkDeployment
>;

/**
 * Singleton postgrad venue deployments promoted into
 * deployments/protocol.json. Networks without promoted entries stay as typed
 * placeholders; run-scoped addresses live in the (gitignored) venue-stack and
 * postgrad manifests instead.
 */
export const postgradVenueDeployments = ${renderPostgradVenueDeployments(
    deployments,
  )} as const satisfies PostgradVenueDeployments;

/** ABI, event names, and manifest address source for each venue contract. */
export const postgradVenueContracts = {
${POSTGRAD_VENUE_CONTRACTS.map(
  (contract) =>
    `  ${contract.name}: {
    name: "${contract.name}",
    abi: ${contract.camelName}Abi,
    addressSource: postgradVenueAddressSources.${contract.name},
    eventNames: postgradVenueEventNames.${contract.name},
  },`,
).join("\n")}
} as const;
`);

  return sections.join("\n");
}

function renderPostgradVenueDeployments(deployments: PostgradVenueDeploymentsByNetwork): string {
  const lines = ["{"];

  for (const [networkId, { chainId, contracts }] of Object.entries(deployments)) {
    lines.push(`  ${networkId}: {`);
    lines.push(`    chainId: ${chainId},`);
    lines.push("    contracts: {");

    for (const singletonKey of POSTGRAD_VENUE_SINGLETON_KEYS) {
      const deployment = contracts[singletonKey];
      if (deployment !== undefined) {
        lines.push(`      ${singletonKey}: ${renderDeployment(deployment)},`);
      }
    }

    lines.push("    },");
    lines.push("  },");
  }

  lines.push("}");
  return lines.join("\n");
}

await main();
