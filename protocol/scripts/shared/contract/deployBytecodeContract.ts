import { getAddress } from "viem";
import type {
  Abi,
  Account,
  Address,
  Chain,
  Hash,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
} from "viem";

/**
 * Receipt metadata for a broadcast contract deployment, with bigints rendered
 * as decimal strings so the result can go straight into a JSON manifest.
 */
export type DeployedContract = {
  address: Address;
  blockNumber: string;
  gasUsed: string;
  transactionHash: Hash;
};

/**
 * Deploys artifact bytecode and returns normalized transaction receipt metadata.
 */
export async function deployBytecodeContract({
  artifact,
  contractName,
  publicClient,
  txFees,
  walletClient,
}: {
  artifact: { readonly abi: Abi; readonly bytecode: Hex };
  contractName: string;
  publicClient: PublicClient;
  txFees?: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
  walletClient: WalletClient<Transport, Chain, Account>;
}): Promise<DeployedContract> {
  const transactionHash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    ...txFees,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });

  if (receipt.status !== "success") {
    throw new Error(`${contractName} deployment transaction reverted: ${transactionHash}`);
  }
  if (!receipt.contractAddress) {
    throw new Error(`${contractName} deployment did not return a contract address.`);
  }

  return {
    address: getAddress(receipt.contractAddress),
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    transactionHash,
  };
}
