import { isAddress } from "viem";
import type { Address, Hex } from "viem";

import type { HardhatDeployableArtifact } from "./loadHardhatDeployableArtifact.js";

/**
 * Writes deployed library addresses into an artifact's bytecode.
 *
 * A contract that calls an external library compiles to bytecode carrying a
 * `__$<hash>$__` placeholder wherever that library's address belongs, and the
 * address is only known once the library itself is deployed. Solidity test
 * fixtures and `viem.deployContract`'s `libraries` option both do this
 * substitution for you; a raw-bytecode deploy path has to do it here, or it
 * broadcasts a placeholder the node rejects as a malformed hex string.
 *
 * Throws when a library is left unlinked rather than returning bytecode that
 * would fail at the RPC boundary with an error naming neither the contract nor
 * the library.
 */
export function linkArtifactLibraries({
  artifact,
  libraries,
}: {
  artifact: HardhatDeployableArtifact;
  libraries: Readonly<Record<string, Address>>;
}): HardhatDeployableArtifact {
  const required = new Map<string, readonly { length: number; start: number }[]>();
  for (const libraryPlaceholders of Object.values(artifact.linkReferences)) {
    for (const [libraryName, placeholders] of Object.entries(libraryPlaceholders)) {
      required.set(libraryName, [...(required.get(libraryName) ?? []), ...placeholders]);
    }
  }

  const missing = [...required.keys()].filter((name) => libraries[name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `${artifact.contractName} needs an address for ${missing.join(", ")} before it can be deployed.`,
    );
  }

  const unexpected = Object.keys(libraries).filter((name) => !required.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `${artifact.contractName} does not link ${unexpected.join(", ")}; check the library name against the artifact.`,
    );
  }

  // Byte offsets, and the bytecode is a hex string with a leading "0x", so a
  // byte at offset n occupies characters 2n+2 through 2n+2+2*length.
  let bytecode = artifact.bytecode as string;
  for (const [libraryName, placeholders] of required) {
    const address = libraries[libraryName];
    if (address === undefined || !isAddress(address)) {
      throw new Error(`Address for ${libraryName} is not a valid address: ${String(address)}`);
    }
    const encoded = address.slice(2).toLowerCase();

    for (const { length, start } of placeholders) {
      if (length * 2 !== encoded.length) {
        throw new Error(
          `${artifact.contractName} reserves ${length} bytes for ${libraryName}, but an address is 20.`,
        );
      }
      const from = start * 2 + 2;
      bytecode = bytecode.slice(0, from) + encoded + bytecode.slice(from + length * 2);
    }
  }

  if (bytecode.includes("__")) {
    throw new Error(
      `${artifact.contractName} still has an unlinked library placeholder after linking.`,
    );
  }

  return { ...artifact, bytecode: bytecode as Hex };
}
