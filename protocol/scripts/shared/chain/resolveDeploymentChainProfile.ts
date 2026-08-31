import { ARC_LOCAL } from "./arcLocal.js";
import { ARC_TESTNET } from "./arcTestnet.js";
import { LOCAL_DEVCHAIN } from "./localDevchain.js";

export type DeploymentChainProfile = {
  readonly chainEnv: string;
  readonly chainId: number;
  readonly chainName: string;
  readonly defaultRpcUrl: string;
  readonly nativeCurrency: {
    readonly decimals: number;
    readonly name: string;
    readonly symbol: string;
  };
  readonly networkName: string;
  readonly supportsExplorerVerification: boolean;
};

/**
 * Maps a Hardhat network name onto the chain metadata deployment scripts need,
 * failing fast for networks the venue and postgrad deploy flows do not support.
 */
export function resolveDeploymentChainProfile(networkName: string): DeploymentChainProfile {
  if (networkName === "arcTestnet") {
    return {
      chainEnv: ARC_TESTNET.chainEnv,
      chainId: ARC_TESTNET.chainId,
      chainName: ARC_TESTNET.name,
      defaultRpcUrl: ARC_TESTNET.rpcUrl,
      nativeCurrency: ARC_TESTNET.nativeCurrency,
      networkName,
      supportsExplorerVerification: true,
    };
  }
  if (networkName === "arcLocal") {
    return {
      chainEnv: ARC_LOCAL.chainEnv,
      chainId: ARC_LOCAL.chainId,
      chainName: ARC_LOCAL.name,
      defaultRpcUrl: ARC_LOCAL.rpcUrl,
      nativeCurrency: ARC_LOCAL.nativeCurrency,
      networkName,
      // The single-node dev chain runs no explorer, so verification has
      // nowhere to publish even though the chain is a real Arc node.
      supportsExplorerVerification: false,
    };
  }
  if (networkName === "localhost") {
    return {
      chainEnv: LOCAL_DEVCHAIN.chainEnv,
      chainId: LOCAL_DEVCHAIN.chainId,
      chainName: LOCAL_DEVCHAIN.name,
      defaultRpcUrl: LOCAL_DEVCHAIN.rpcUrl,
      nativeCurrency: LOCAL_DEVCHAIN.nativeCurrency,
      networkName,
      supportsExplorerVerification: false,
    };
  }

  throw new Error(
    `Unsupported Hardhat network for venue deployment scripts: ${networkName}. ` +
      "Use --network arcTestnet, --network arcLocal, or --network localhost.",
  );
}
