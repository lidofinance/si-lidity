import { config as dotenvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
dotenvConfig({ path: ".env.local" });

import HardhatEthers from "@nomicfoundation/hardhat-ethers";
import HardhatChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import HardhatIgnition from "@nomicfoundation/hardhat-ignition";
import HardhatKeystore from "@nomicfoundation/hardhat-keystore";
import HardhatMochaTestRunner from "@nomicfoundation/hardhat-mocha";
import HardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import HardhatTypechain from "@nomicfoundation/hardhat-typechain";

// The HardhatVerify haven't been ported to Hardhat 3 yet
// import HardhatVerify from "@nomicfoundation/hardhat-verify";
import { abisExtractTask, verifyDeployedContracts } from "./tasks";

const config: HardhatUserConfig = {
  paths: {
    // TODO
    sources: ["./si-contracts/0.8.25/vaults"],
  },
  plugins: [
    HardhatEthers,
    HardhatKeystore,
    HardhatMochaTestRunner,
    HardhatNetworkHelpers,
    HardhatChaiMatchers,
    HardhatTypechain,
    HardhatIgnition,
  ],
  tasks: [abisExtractTask, verifyDeployedContracts],
  solidity: {
    compilers: [
      {
        version: "0.4.24",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "constantinople",
        },
      },
      {
        version: "0.6.11",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.6.12",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.8.9",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "istanbul",
        },
      },
      {
        version: "0.8.25",
        settings: {
          // like here https://github.com/lidofinance/core/blob/4af82f0d0851ec514b32c9ce40c7ac0cd2915d69/hardhat.config.ts
          viaIR: true,
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
    ],
    remappings: ["contracts/=submodules/lidofinance-core/contracts/"],
    overrides: {
      "si-contracts/0.8.25/vaults/DashboardFactory.sol": {
        version: "0.8.25",
        settings: {
          // like here https://github.com/lidofinance/core/blob/4af82f0d0851ec514b32c9ce40c7ac0cd2915d69/hardhat.config.ts
          viaIR: true,
          optimizer: { enabled: true, runs: 999_999 },
        },
      },
    },
  },
  typechain: {
    outDir: "typechain-types",
    alwaysGenerateOverloads: false,
    dontOverrideCompile: false,
  },
  networks: {
    hardhat: {
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
    },
    mainnet: {
      type: "http",
      url: process.env.RPC_URL_1,
      accounts: [process.env.PRIVATE_KEY],
    },
    hoodi: {
      type: "http",
      url: process.env.RPC_URL_560048,
      accounts: [process.env.PRIVATE_KEY],
    },
    sepolia: {
      type: "http",
      url: process.env.RPC_URL_11155111,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};

export default config;
