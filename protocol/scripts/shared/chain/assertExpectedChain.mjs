/**
 * Confirms the RPC endpoint is serving the expected chain before sending transactions.
 */
export async function assertExpectedChain({ chainName, expectedChainId, publicClient }) {
  const chainId = await publicClient.getChainId();
  if (chainId !== expectedChainId) {
    throw new Error(`Expected ${chainName} chain ${expectedChainId}, received ${chainId}.`);
  }

  return chainId;
}
