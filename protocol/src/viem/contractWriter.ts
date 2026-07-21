import type { Address, Hex } from "viem";

/**
 * Structural subset of a viem wallet client that the market flows need: any
 * client that can send a contract write. Deliberately loose so hardhat-viem
 * and plain viem wallet clients both satisfy it without threading generics.
 */
export type ContractWriter = {
  writeContract(parameters: {
    abi: readonly unknown[];
    address: Address;
    args: readonly unknown[];
    functionName: string;
  }): Promise<Hex>;
};
