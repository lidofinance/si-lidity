# SI-lidity

## Description

A set of solidity contracts from the SI team with Hardhat 3 Alpha!

## Getting Started

### Prerequisites

Node.js 22

### Installation

Just run

`yarn install`

### Quick Start

Just run

`git submodule init`

`git submodule update --remote --recursive`

`yarn compile`

### Deploy

Set ENVs
`cp .env.example .env.local`

Deploy with
`yarn deploy:<network_name>`

#### Hoodi example

`yarn deploy:hoodi`

### Verify

Deploy with
`yarn deploy:<network_name>`

Verify with
`yarn verify:deployed-contracts --chainId <chainId> --contractName <contractName>`

#### Hoodi example

`yarn deploy:hoodi`

`yarn verify:deployed-contracts --chainId 560048 --contractName VaultViewer`

### Tests

Just run

`yarn test`

### ABI

Just run

`yarn compile`

`yarn abis:extract`

### Submodules

Just updates submodules with:

`git submodule init`

`git submodule update --remote --recursive`

## License

TBD
