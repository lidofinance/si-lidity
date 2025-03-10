import { HardhatUserConfig } from "hardhat/config";

import HardhatEthers from "@nomicfoundation/hardhat-ethers";
import HardhatChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import HardhatKeystore from "@nomicfoundation/hardhat-keystore";
import HardhatMochaTestRunner from "@nomicfoundation/hardhat-mocha";
import HardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import HardhatTypechain from "@nomicfoundation/hardhat-typechain";
// for deploying smart contracts on Ethereum
// import HardhatIgnitionEthers from "@nomicfoundation/hardhat-ignition-ethers";

const config: HardhatUserConfig = {
  paths: {
    sources: [
      "./si-contracts",
      "./submodules/lidofinance-core/contracts/0.8.25",
      "./submodules/lidofinance-core/test/0.8.25",
    ],
    // TODO: remove this example
    // sources: [
    //   "./si-contracts",
    //   "./submodules/lidofinance-core/contracts/0.4.24/lib",
    //   "./submodules/lidofinance-core/contracts/0.4.24/nos",
    //   "./submodules/lidofinance-core/contracts/0.4.24/oracle",
    //   // troubles with compilation
    //   // "./submodules/lidofinance-core/contracts/0.4.24/template",
    //   "./submodules/lidofinance-core/contracts/0.4.24/utils",
    //   "./submodules/lidofinance-core/contracts/0.6.11",
    //   "./submodules/lidofinance-core/contracts/0.6.12",
    //   "./submodules/lidofinance-core/contracts/0.8.4",
    //   "./submodules/lidofinance-core/contracts/0.8.9",
    //   "./submodules/lidofinance-core/contracts/0.8.25",
    //   "./submodules/lidofinance-core/contracts/common",
    //   "./submodules/lidofinance-core/contracts/openzeppelin",
    //   "./submodules/lidofinance-core/contracts/testnets",
    //   "./submodules/lidofinance-core/test/0.8.25",
    // ],
  },
  plugins: [
    HardhatEthers,
    HardhatKeystore,
    HardhatMochaTestRunner,
    HardhatNetworkHelpers,
    HardhatChaiMatchers,
    HardhatTypechain,
    // for deploying smart contracts on Ethereum
    // HardhatIgnitionEthers,
  ],
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
          optimizer: {
            enabled: true,
            runs: 200,
          },
          evmVersion: "cancun",
        },
      },
    ],
    dependenciesToCompile: [
      // for tests
      "@openzeppelin/contracts-v5.2/proxy/beacon/UpgradeableBeacon.sol",
    ],
    remappings: [
      "contracts/=submodules/lidofinance-core/contracts/",
      // from hardhat v3 init command
      // can be deleted if we aren't planning to use
      "forge-std/=npm/forge-std@1.9.4/src/",
    ],
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
  },
  // for tests
  mocha: {
    parallel: true,
    timeout: 20 * 60 * 1000, // 20 minutes
  },
};

export default config;
