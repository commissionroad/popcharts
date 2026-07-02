import { ARC_TESTNET } from "./arcTestnet.mjs";
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
      "Use --network arcTestnet or --network localhost.",
  );
}
