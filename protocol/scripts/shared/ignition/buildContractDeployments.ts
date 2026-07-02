import { listTransactions, type ArtifactResolver } from "@nomicfoundation/ignition-core";
import { getAddress, type Address, type Hash, type PublicClient } from "viem";

import { contractExplorerUrl } from "../explorer/contractExplorerUrl.js";
import { findDeploymentTransaction } from "./findDeploymentTransaction.js";

export type IgnitionContractDescriptor = {
  contractName: string;
  futureId: string;
  manifestKey: string;
  resultKey: string;
};

export type ContractDeploymentManifest = {
  address: Address;
  blockNumber?: string;
  contractName: string;
  deployedBytecodeBytes: string;
  explorerUrl: string;
  futureId: string;
  gasUsed?: string;
  transactionHash?: string;
};

/**
 * Builds manifest entries from Ignition contracts and transaction state.
 */
export async function buildContractDeployments({
  artifactResolver,
  browserUrl,
  contracts,
  deploymentDir,
  descriptors,
  publicClient,
}: {
  artifactResolver: Omit<ArtifactResolver, "getBuildInfo">;
  browserUrl: string;
  contracts: Record<string, { address: Address }>;
  deploymentDir: string;
  descriptors: readonly IgnitionContractDescriptor[];
  publicClient: PublicClient;
}) {
  const transactions = await listTransactions(deploymentDir, artifactResolver);
  const deployments: Record<string, ContractDeploymentManifest> = {};

  for (const descriptor of descriptors) {
    const deployedContract = contracts[descriptor.resultKey];
    if (deployedContract === undefined) {
      throw new Error(`Ignition result missing ${descriptor.resultKey}.`);
    }

    const address = getAddress(deployedContract.address);
    const transaction = findDeploymentTransaction({
      address,
      transactions,
    });
    const receipt =
      transaction === undefined
        ? undefined
        : await publicClient.getTransactionReceipt({ hash: transaction.txHash as Hash });
    const bytecode = await publicClient.getCode({ address });

    if (bytecode === undefined || bytecode === "0x") {
      throw new Error(`${descriptor.contractName} has no deployed bytecode at ${address}.`);
    }

    deployments[descriptor.manifestKey] = {
      address,
      blockNumber: receipt?.blockNumber.toString(),
      contractName: descriptor.contractName,
      deployedBytecodeBytes: String((bytecode.length - 2) / 2),
      explorerUrl: contractExplorerUrl({ address, browserUrl }),
      futureId: descriptor.futureId,
      gasUsed: receipt?.gasUsed.toString(),
      transactionHash: transaction?.txHash,
    };

    console.log(`${descriptor.contractName}: ${address}`);
  }

  return deployments;
}
