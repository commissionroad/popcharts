import { defineChain, http } from "viem";

/**
 * Builds a viem chain descriptor from explicit chain and explorer settings.
 */
export function defineEvmChain({ blockExplorer, chainId, name, nativeCurrency, rpcUrl }) {
  return defineChain({
    id: chainId,
    name,
    nativeCurrency,
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
    ...(blockExplorer
      ? {
          blockExplorers: {
            default: blockExplorer,
          },
        }
      : {}),
  });
}
