---
sidebar_position: 1
---

# Configuration

This guide covers:

- configure your environment variables;
- init submodules;
- compile the contracts.

## Dependencies

```bash
yarn install
```

## Environment Variables

Configure your environment by creating a `.env` file in your project root:

```.env
PRIVATE_KEY=<0x...>
RPC_URL_<chainId>=<url> // RPC_URL_1, RPC_URL_560048, etc
LIDO_LOCATOR_ADDRESS_<chainId>=<0x...> // LIDO_LOCATOR_ADDRESS_1, LIDO_LOCATOR_ADDRESS_560048, etc
ETHERSCAN_API_KEY=<url>
```

| Variable                         | Description                                      | Required for        |
| -------------------------------- | ------------------------------------------------ | ------------------- |
| `PRIVATE_KEY`                    | Deployer account with a sufficient amount of ETH | Contract deployment |
| `RPC_URL_<chainId>`              | Deployer RPC URL for the target chain            | Contract deployment |
| `LIDO_LOCATOR_ADDRESS_<chainId>` | Address of the already deployed LidoLocator      | Contract deployment |
| `ETHERSCAN_API_KEY`              | Etherscan API key                                | Contract deployment |

## Submodules

The develop branch currently works with Lido Core Contracts version `v3.0.0-audits`.
Make sure to properly initialize the submodules to pull the correct version:

```bash
git submodule init
git submodule update --remote --recursive
cd submodules/lidofinance-core
git checkout v3.0.0-audits
cd ../../
```

## Compile

After this, you can compile the contracts:

```bash
yarn compile
```
