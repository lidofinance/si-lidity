---
sidebar_position: 1
---

# Deploy

This guide covers all necessary configuration steps to deploy `VaultViewer` contract to different networks.

Before deploying, make sure:

1. you have [initialized the submodules](../repository/configuration#submodules)
2. you have [set all environment variables required for contract deployment](../repository/configuration#environment-variables)
3. you have removed the `<repo_root>/ignition/deployments` directory.

```bash
yarn deploy-{contract}:<network_name>
```

# Example `VaultViewer` hoodi:

```bash
yarn deploy-vv:hoodi
```

# Example `WstETHReferralStaker` hoodi:

```bash
yarn deploy-wrs:hoodi
```
