import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { parseGwei } from "viem";

import { ARC_TESTNET } from "./scripts/shared/chain/arcTestnet.mjs";
import { ARCSCAN } from "./scripts/shared/explorer/arcscan.mjs";

const ARC_TESTNET_RPC_URL = process.env.POPCHARTS_RPC_URL ?? ARC_TESTNET.rpcUrl;
const ARCSCAN_BROWSER_URL = process.env.POPCHARTS_ARCSCAN_BROWSER_URL ?? ARCSCAN.browserUrl;
const ARCSCAN_API_URL = process.env.POPCHARTS_ARCSCAN_API_URL ?? ARCSCAN.apiUrl;

const soliditySettings = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViem],
  chainDescriptors: {
    [ARC_TESTNET.chainId]: {
      blockExplorers: {
        blockscout: {
          apiUrl: ARCSCAN_API_URL,
          name: ARCSCAN.name,
          url: ARCSCAN_BROWSER_URL,
        },
      },
      chainType: "l1",
      name: ARC_TESTNET.name,
    },
  },
  networks: {
    arcTestnet: {
      accounts: [configVariable("POPCHARTS_DEPLOYER_PRIVATE_KEY")],
      chainId: ARC_TESTNET.chainId,
      chainType: "l1",
      ignition: {
        explorerUrl: ARCSCAN_BROWSER_URL,
        maxFeePerGas: parseGwei(process.env.POPCHARTS_MAX_FEE_GWEI ?? "25"),
        maxPriorityFeePerGas: parseGwei(process.env.POPCHARTS_PRIORITY_FEE_GWEI ?? "1"),
      },
      type: "http",
      url: ARC_TESTNET_RPC_URL,
    },
  },
  paths: {
    sources: "./contracts",
    tests: {
      nodejs: "./test/nodejs",
      solidity: "./test/solidity",
    },
  },
  solidity: {
    profiles: {
      default: {
        compilers: [
          {
            version: "0.8.28",
            settings: soliditySettings,
          },
          {
            version: "0.8.26",
            settings: soliditySettings,
          },
        ],
      },
      production: {
        compilers: [
          {
            version: "0.8.28",
            settings: soliditySettings,
          },
          {
            version: "0.8.26",
            settings: soliditySettings,
          },
        ],
      },
    },
  },
  test: {
    solidity: {
      fuzz: {
        runs: 256,
      },
    },
  },
  verify: {
    blockscout: {
      enabled: true,
    },
    etherscan: {
      enabled: false,
    },
    sourcify: {
      enabled: false,
    },
  },
});
