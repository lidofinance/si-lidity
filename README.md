# SI-lidity

## Description

A set of solidity contracts from the SI team with Hardhat 3 Alpha!

## Prerequisites

Node.js 22

## ⚙️ Configuration

**📑 This file contains a brief guide. For full documentation, see the Docusaurus docs by running:**

```
cd ../docs
yarn start
```

### 🌐 ENV

Set ENVs

`cp .env.example .env.local`

- PRIVATE_KEY
- RPC*URL*<chainId>
- VAULT_HUB_ADDRESS
- ETHERSCAN_API_KEY

### 🔧 Installation

Just run:

`yarn install`

### 🔀 Init submodules

Just updates submodules with:

```
git submodule init
git submodule update --remote --recursive
cd submodules/lidofinance-core
git checkout v3.0.0-audits
cd ../../
```

### 🏃‍♂️ Compile

Just run:

`yarn compile`

## 📌 Additional

### 🚀 Deploy

Deploy with:

**VaultViewer:**

`yarn deploy-vv:<network_name>`

**WstETHReferralStaker:**

`yarn deploy-wrs:<network_name>`

**Example:**

`yarn deploy-vv:hoodi`

### ✅ Verify

Deploy with:

`yarn deploy-vv:<network_name>`

Verify with:

`yarn verify:deployed-contracts --chainId <chainId> --contractName <contractName>`

**Example Hoodi:**

`yarn deploy-vv:hoodi`

`yarn verify:deployed-contracts --chainId 560048 --contractName VaultViewer`

**Example Sepolia:**

`yarn deploy-wrs:sepolia`

`yarn verify:deployed-contracts --chainId 11155111 --contractName WstETHReferralStaker`

### 📝 Tests

Just run:

`yarn test`

### 📦 ABI

Just run:

`yarn compile`

`yarn abis:extract`

## License

TBD
