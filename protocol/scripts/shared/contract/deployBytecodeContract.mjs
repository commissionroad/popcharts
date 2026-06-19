import { getAddress } from "viem";

/**
 * Deploys artifact bytecode and returns normalized transaction receipt metadata.
 */
export async function deployBytecodeContract({
  artifact,
  contractName,
  publicClient,
  txFees,
  walletClient,
}) {
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
