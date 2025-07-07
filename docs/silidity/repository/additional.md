---
sidebar_position: 2
---

# Additional

## Tests

```bash
yarn test
```

## Verify

```bash
yarn verify:deployed-contracts --chainId <chainId> --contractName <contractName>
```

### Example

```bash
yarn verify:deployed-contracts --chainId 560048 --contractName VaultViewer
```

## ABI

Before deploying, make sure the contract has been compiled.

```bash
yarn abis:extract
```
