---
sidebar_position: 2
---

# Additional

This guide covers:

- run tests;
- generate ABI files;
- verify the contracts on the Etherscan.

## Tests

```bash
yarn test
```

## ABI

Before deploying, make sure the contract has been compiled:

```bash
yarn abis:extract
```

You will get the ABI in JSON format in the `<repo_root>/abi` directory.

## Verify

Before deploying, make sure:

1. you have [deployed the smart contract](../contracts/deploy#Deploy)
2. you have [set all environment variables required for smart contract verification](../repository/configuration#environment-variables)

```bash
yarn verify:deployed-contracts --chainId <chainId> --contractName <contractName>
```

### Example

For hoodi:

```bash
yarn verify:deployed-contracts --chainId 560048 --contractName VaultViewer
```
