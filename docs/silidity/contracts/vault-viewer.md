---
sidebar_position: 2
---

# VaultViewer

- [Source code](https://github.com/lidofinance/si-lidity/blob/develop/si-contracts/0.8.25/VaultViewer.sol)

**VaultViewer** is a read-only utility contract designed to simplify querying aggregated data about staking vaults managed by the VaultHub.

Currently, these are **view-only contracts**, designed to provide easy read access to staking data.

## Upgradability

This contract is **not upgradable** and is intended solely for efficient on-chain data aggregation and access.

## Data Structures

### VaultData

Holds aggregated data for a vault:

| Field                 | Type                        |
| --------------------- | --------------------------- |
| `vaultAddress`        | `address`                   |
| `connection`          | `VaultHub.VaultConnection`  |
| `record`              | `VaultHub.VaultRecord`      |
| `totalValue`          | `uint256`                   |
| `liabilityStETH`      | `uint256`                   |
| `nodeOperatorFeeRate` | `uint256`                   |
| `isReportFresh`       | `bool`                      |
| `quarantineInfo`      | `LazyOracle.QuarantineInfo` |

### VaultMembers

Holds information about members related to a vault:

| Field          | Type          |
| -------------- | ------------- |
| `vault`        | `address`     |
| `owner`        | `address`     |
| `nodeOperator` | `address`     |
| `members`      | `address[][]` |

## Methods

### vaultsByOwner

Returns vaults owned by a specific address.

```solidity
function vaultsByOwner(address _owner, uint256 _cursor, uint256 _limit) view returns(IStakingVault[] memory vaults, uint256 nextCursor)
```

### vaultsByRole

Returns vaults where a member holds a specific role on the vault's owner contract.

```solidity
function vaultsByRole(bytes32 _role, address _member, uint256 _cursor, uint256 _limit) view returns(IStakingVault[] memory vaults, uint256 nextCursor)
```

### getVaultData

Returns aggregated data for a specific vault, including value, liabilities, and operator fee.

```solidity
function vaultData(address vault) view returns(VaultData memory)
```

### vaultsDataBound

Returns aggregated data for connected vaults within a range.

```solidity
function vaultsDataBound(uint256 _from, uint256 _to)
view returns(VaultData[] memory vaultsData, uint256 leftover)
```

### getRoleMembers

Returns detailed role members data for a vault owner.

```solidity
function roleMembers(address vaultAddress, bytes32[] calldata roles)
view returns(VaultMembers memory)
```

### getRoleMembersBatch

Returns role members data for multiple vaults.

```solidity
function roleMembersBatch(address[] calldata vaultAddresses, bytes32[] calldata roles)
view returns(VaultMembers[] memory)
```
