// import { configVariable, HardhatUserConfig } from "hardhat/config";
import { HardhatUserConfig } from "hardhat/config";

import HardhatEthers from "@nomicfoundation/hardhat-ethers";
// import HardhatChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
// import HardhatIgnitionEthers from "@nomicfoundation/hardhat-ignition-ethers";
// import HardhatKeystore from "@nomicfoundation/hardhat-keystore";
import HardhatMochaTestRunner from "@nomicfoundation/hardhat-mocha";
// import HardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import HardhatTypechain from "@nomicfoundation/hardhat-typechain";

const config: HardhatUserConfig = {
  paths: {
    sources: [
      "./si-contracts",
      "./submodules/lidofinance-core/contracts/0.4.24",
      // "./submodules/lidofinance-core/contracts/0.8.25",
    ],
  },
  plugins: [
    HardhatMochaTestRunner,
    HardhatEthers,
    //   HardhatNetworkHelpers,
    //   HardhatKeystore,
    //   HardhatChaiMatchers,
    HardhatTypechain,
    //   HardhatIgnitionEthers,
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
    remappings: [
      // "forge-std/=npm/forge-std@1.9.4/src/",
      "contracts/=submodules/lidofinance-core/contracts/",
    ],
  },
  typechain: {
    outDir: "typechain-types",
    alwaysGenerateOverloads: false,
    dontOverrideCompile: false,
  },
  // networks: {
  //   hardhatMainnet: {
  //     type: "edr",
  //     chainType: "l1",
  //   },
  //   hardhatOp: {
  //     type: "edr",
  //     chainType: "optimism",
  //   },
  //   sepolia: {
  //     type: "http",
  //     chainType: "l1",
  //     url: configVariable("SEPOLIA_RPC_URL"),
  //     accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
  //   },
  // },
  mocha: {
    parallel: true,
    timeout: 20 * 60 * 1000, // 20 minutes
  },
};

export default config;
