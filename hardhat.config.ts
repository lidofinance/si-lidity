import * as process from "node:process";

import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";

import "dotenv/config";
import "solidity-coverage";
import "tsconfig-paths/register";
import "hardhat-tracer";
import "hardhat-watcher";
import "hardhat-ignore-warnings";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import { HardhatUserConfig } from "hardhat/config";

import { mochaRootHooks } from "test/hooks";

// import "tasks";
import { getHardhatForkingConfig, loadAccounts } from "./hardhat.helpers";

const RPC_URL: string = process.env.RPC_URL || "";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  paths: {
    sources: "./src/contracts",
  },
  gasReporter: {
    enabled: process.env.SKIP_GAS_REPORT ? false : true,
  },
  networks: {
    "hardhat": {
      // setting base fee to 0 to avoid extra calculations doesn't work :(
      // minimal base fee is 1 for EIP-1559
      // gasPrice: 0,
      // initialBaseFeePerGas: 0,
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true,
      accounts: {
        // default hardhat's node mnemonic
        mnemonic: "test test test test test test test test test test test junk",
        count: 30,
        accountsBalance: "100000000000000000000000",
      },
      forking: getHardhatForkingConfig(),
    },
    "local": {
      url: process.env.LOCAL_RPC_URL || RPC_URL,
    },
    "holesky": {
      url: process.env.HOLESKY_RPC_URL || RPC_URL,
      chainId: 17000,
      accounts: loadAccounts("holesky"),
    },
    "sepolia": {
      url: process.env.SEPOLIA_RPC_URL || RPC_URL,
      chainId: 11155111,
      accounts: loadAccounts("sepolia"),
    },
    "sepolia-fork": {
      url: process.env.SEPOLIA_RPC_URL || RPC_URL,
      chainId: 11155111,
    },
    "mainnet-fork": {
      url: process.env.MAINNET_RPC_URL || RPC_URL,
      timeout: 20 * 60 * 1000, // 20 minutes
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  solidity: {
    compilers: [
      {
        version: "0.8.25",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
    ],
  },
  tracer: {
    tasks: ["watch"],
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
    alwaysGenerateOverloads: false,
    externalArtifacts: ["externalArtifacts/*.json"],
    dontOverrideCompile: false,
  },
  watcher: {
    test: {
      tasks: [
        { command: "compile", params: { quiet: true } },
        { command: "test", params: { noCompile: true, testFiles: ["{path}"] } },
      ],
      files: ["./src/test/**/*"],
      clearOnStart: true,
      start: "echo Running tests...",
    },
  },
  mocha: {
    rootHooks: mochaRootHooks,
    timeout: 20 * 60 * 1000, // 20 minutes
  },
  warnings: {
    "src/contracts/*/mocks/**/*": {
      default: "off",
    },
    "src/test/*/contracts/**/*": {
      default: "off",
    },
  },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: false,
    runOnCompile: process.env.SKIP_CONTRACT_SIZE ? false : true,
    strict: true,
    except: ["template", "mocks", "openzeppelin", "test"],
  },
};

export default config;
