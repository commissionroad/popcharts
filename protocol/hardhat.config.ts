import hardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import { defineConfig } from "hardhat/config";

const soliditySettings = {
  optimizer: {
    enabled: true,
    runs: 200,
  },
};

export default defineConfig({
  plugins: [hardhatToolboxViem],
  paths: {
    sources: "./contracts",
    tests: {
      nodejs: "./test/nodejs",
      solidity: "./test/solidity",
    },
  },
  solidity: {
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
  test: {
    solidity: {
      fuzz: {
        runs: 256,
      },
    },
  },
});
