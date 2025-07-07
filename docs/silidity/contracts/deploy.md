---
sidebar_position: 1
---

# Deploy

This guide covers all necessary configuration steps to deploy `VaultViewer` contract to different networks.

Before deploying, make sure:

1. you have [initialized the submodules](../repository/configuration#submodules)
2. you have [set all environment variables required for contract deployment](../repository/configuration#environment-variables)

```bash
yarn deploy:<network_name>
```

# Example

For hoodi:

```bash
yarn deploy:hoodi
```
