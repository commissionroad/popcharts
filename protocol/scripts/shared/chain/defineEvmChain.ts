import { defineChain } from "viem";
import type { Chain } from "viem";

/**
 * Builds a viem chain descriptor from explicit chain and explorer settings.
 */
export function defineEvmChain({
  blockExplorer,
  chainId,
  name,
  nativeCurrency,
  rpcUrl,
}: {
  blockExplorer?: { name: string; url: string };
  chainId: number;
  name: string;
  nativeCurrency: { decimals: number; name: string; symbol: string };
  rpcUrl: string;
}): Chain {
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
