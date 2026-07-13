import hre from "hardhat";
import type { Address, Hex, PublicClient } from "viem";

import { LOCAL_DEVCHAIN_CHAIN_ID } from "./deterministicFactory.js";

export type TokenPullerMode = "mockPuller" | "transferApproval";

type TestClientConnection = {
  viem: {
    getTestClient(): Promise<{
      setCode(parameters: { address: Address; bytecode: Hex }): Promise<void>;
    }>;
  };
};

/**
 * Ensures the order manager's token-puller dependency is callable before maker
 * orders can reach it. Public chains must provide the configured singleton.
 * Local devchains are empty after every restart, so they receive the mock
 * puller bytecode at the same configured address.
 */
export async function ensureTokenPullerBytecode({
  chainId,
  connection,
  publicClient,
  tokenPuller,
}: {
  chainId: number;
  connection: TestClientConnection;
  publicClient: PublicClient;
  tokenPuller: Address;
}): Promise<TokenPullerMode> {
  const mockArtifact = await hre.artifacts.readArtifact("MockTokenPuller");
  const mockRuntimeBytecode = (mockArtifact.deployedBytecode as Hex).toLowerCase();
  const code = await publicClient.getCode({ address: tokenPuller });

  if (code === undefined || code === "0x") {
    if (chainId !== LOCAL_DEVCHAIN_CHAIN_ID) {
      throw new Error(
        `Order-manager token puller ${tokenPuller} has no bytecode. The configured ` +
          "allowance-transfer singleton must exist before maker orders can settle input tokens.",
      );
    }

    const testClient = await connection.viem.getTestClient();
    await testClient.setCode({
      address: tokenPuller,
      bytecode: mockArtifact.deployedBytecode as Hex,
    });

    const seededCode = await publicClient.getCode({ address: tokenPuller });
    if (seededCode === undefined || seededCode === "0x") {
      throw new Error(`Failed to seed local token puller bytecode at ${tokenPuller}.`);
    }

    console.log(`Seeded local MockTokenPuller bytecode at ${tokenPuller}.`);
    return "mockPuller";
  }

  return code.toLowerCase() === mockRuntimeBytecode ? "mockPuller" : "transferApproval";
}
