import type { Address, Hex, PublicClient } from "viem";

// Runtime bytecode of the keyless CREATE2 factory expected at
// VENUE_STACK_DEPLOYMENT.deterministicFactoryAddress. Source: Arachnid's
// deterministic-deployment-proxy, read back from the canonical mainnet deploy.
export const DETERMINISTIC_FACTORY_RUNTIME_BYTECODE: Hex =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

export const LOCAL_DEVCHAIN_CHAIN_ID = 31_337;

type TestClientConnection = {
  viem: {
    getTestClient(): Promise<{
      setCode(parameters: { address: Address; bytecode: Hex }): Promise<void>;
    }>;
  };
};

/**
 * Makes sure the keyless CREATE2 factory exists before a hook deploy. Real
 * chains must already have it; the throwaway local devchain is seeded in
 * place instead.
 */
export async function ensureDeterministicFactory({
  chainId,
  chainName,
  connection,
  factoryAddress,
  publicClient,
}: {
  chainId: number;
  chainName?: string;
  connection: TestClientConnection;
  factoryAddress: Address;
  publicClient: PublicClient;
}): Promise<void> {
  if (await hasBytecode(publicClient, factoryAddress)) {
    return;
  }
  if (chainId !== LOCAL_DEVCHAIN_CHAIN_ID) {
    throw new Error(
      `Deterministic CREATE2 factory has no bytecode at ${factoryAddress}` +
        `${chainName ? ` on ${chainName}` : ""}. ` +
        "Deploy or locate the keyless factory before deploying the venue stack.",
    );
  }

  const testClient = await connection.viem.getTestClient();
  await testClient.setCode({
    address: factoryAddress,
    bytecode: DETERMINISTIC_FACTORY_RUNTIME_BYTECODE,
  });
  if (!(await hasBytecode(publicClient, factoryAddress))) {
    throw new Error(`Failed to seed the deterministic CREATE2 factory at ${factoryAddress}.`);
  }
  console.log(`Seeded local deterministic CREATE2 factory at ${factoryAddress}.`);
}

export async function hasBytecode(publicClient: PublicClient, address: Address): Promise<boolean> {
  const bytecode = await publicClient.getCode({ address });
  return bytecode !== undefined && bytecode !== "0x";
}
