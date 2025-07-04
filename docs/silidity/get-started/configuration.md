---
sidebar_position: 1
---

# Configuration

This guide covers all necessary configuration steps to get started, for:

- build the contracts;
- run tests;
- generate ABI files;
- deploy contracts to different networks;
- verify the contracts on the Etherscan;

you need to configure your environment variables and wallet settings.

## Dependencies

```bash
yarn install
```

## Environment Variables

Configure your environment by creating a `.env` file in your project root:

```.env
# Deployer account
PRIVATE_KEY=<0x...> // required for contract deployment

# Deployer RPC URL
RPC_URL_560048=<url> // required for contract deployment

# Address of the already deployed VaultHub contract
VAULT_HUB_ADDRESS=<url> // required for contract deployment; update this value when deploying to other networks

ETHERSCAN_API_KEY=<url> // required for smart contract validation
```

## Submodules

The develop branch currently works with Lido Core Contracts version v3.0.0-audits.
Make sure to properly initialize the submodules to pull the correct version.

```bash
git submodule init
git submodule update --remote --recursive
cd submodules/lidofinance-core
git checkout v3.0.0-audits
cd ../../
yarn compile
```
