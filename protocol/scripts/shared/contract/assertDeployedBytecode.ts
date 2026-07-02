import type { Address, PublicClient } from "viem";

/**
 * Fails fast when a manifest address has no deployed bytecode, so smoke and
 * deployment flows never send funds or approvals at stale manifest entries.
 */
export async function assertDeployedBytecode(
  publicClient: PublicClient,
  name: string,
  address: Address,
): Promise<void> {
  const bytecode = await publicClient.getCode({ address });
  if (bytecode === undefined || bytecode === "0x") {
    throw new Error(`${name} has no deployed bytecode at ${address}.`);
  }
}
