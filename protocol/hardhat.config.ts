import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { parseGwei } from "viem";

import { ARC_LOCAL } from "./scripts/shared/chain/arcLocal.js";
import { ARC_TESTNET } from "./scripts/shared/chain/arcTestnet.js";
import { ARCSCAN } from "./scripts/shared/explorer/arcscan.js";
import postgradAdminTasks from "./scripts/tasks/postgradAdmin.js";
import venueDeploymentTasks from "./scripts/tasks/venueDeployment.js";

const ARC_TESTNET_RPC_URL = process.env.POPCHARTS_RPC_URL ?? ARC_TESTNET.rpcUrl;
const ARC_LOCAL_RPC_URL = process.env.POPCHARTS_LOCAL_RPC_URL ?? ARC_LOCAL.rpcUrl;
const ARCSCAN_BROWSER_URL = process.env.POPCHARTS_ARCSCAN_BROWSER_URL ?? ARCSCAN.browserUrl;
const ARCSCAN_API_URL = process.env.POPCHARTS_ARCSCAN_API_URL ?? ARCSCAN.apiUrl;

const soliditySettings = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
};

// PregradManager sat within 2% of the EIP-170 code-size limit before the
// ADR 0014 P3 withdrawal mechanism landed. The mechanism's state machine is
// split into the external ReceiptWithdrawals library, and the manager alone
// compiles via IR, which packs its remaining code under the limit; both are
// size measures, not behaviour changes. Every artifact-based deploy path —
// production, local stacks, and the nodejs suite — ships the viaIR bytecode.
// Solidity test units recompile the imported source under the default
// pipeline (their in-test deploys are size-exempt and still warn), so the
// suite exercises both pipelines. Applied identically in every profile so
// local and production bytecode agree.
const pregradManagerSettingsOverride = {
  "contracts/PregradManager.sol": {
    version: "0.8.28",
    settings: { ...soliditySettings, viaIR: true },
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViem],
  tasks: [...venueDeploymentTasks, ...postgradAdminTasks],
  chainDescriptors: {
    [ARC_LOCAL.chainId]: {
      chainType: "l1",
      name: ARC_LOCAL.name,
    },
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
    // Same shape as Hardhat's built-in localhost network, with the URL
    // overridable so isolated stacks (worktrees, CI) can target an alternate
    // devchain port without touching the primary stack on 8545.
    localhost: {
      chainType: "l1",
      type: "http",
      url: process.env.POPCHARTS_LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
    },
    // The single-node Arc devchain started by `scripts/arc-node.ts`. It runs
    // the real Arc EVM, fee market, denylist, and predeploys, so a deploy that
    // succeeds here has cleared constraints `hardhat node` cannot express
    // (EIP-170 under Arc's EVM, the 20 gwei base-fee floor, the 30M block gas
    // limit). Accounts are omitted on purpose: the chain prefunds the standard
    // development accounts, so Hardhat's own defaults already hold value here.
    arcLocal: {
      chainId: ARC_LOCAL.chainId,
      chainType: "l1",
      type: "http",
      url: ARC_LOCAL_RPC_URL,
    },
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
    // Emit deployable artifacts for the vendored v4 venue-stack contracts so
    // Ignition can deploy them by fully-qualified name.
    npmFilesToBuild: [
      "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol",
      "@uniswap/v4-periphery/src/lens/StateView.sol",
      "@uniswap/v4-periphery/src/lens/V4Quoter.sol",
    ],
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
        overrides: pregradManagerSettingsOverride,
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
        overrides: pregradManagerSettingsOverride,
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
