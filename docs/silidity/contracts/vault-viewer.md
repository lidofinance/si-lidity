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

<details>
  <summary>⚠️ **Important** ⚠️</summary>

The **\_limit** parameter defines the maximum number of vaults to iterate over, not the number of owner matches to return.

Each call scans up to **\_limit** positions in the global vault list starting from **\_cursor**, regardless of how many vaults belong to **\_owner**.
This ensures predictable gas usage and prevents excessive iteration when the owner has no vaults (**\_ownerNoVaults** case).

If the provided owner address has no connected vaults, the function still stops after **\_limit** iterations —
it will not perform a full scan across all vaults (≈272 M gas for full traversal).

Continue paginating by calling again with **nextCursor** until it equals 0.

</details>

### vaultsByRole

Returns vaults where a member holds a specific role on the vault's owner contract.

```solidity
function vaultsByRole(bytes32 _role, address _member, uint256 _cursor, uint256 _limit) view returns(IStakingVault[] memory vaults, uint256 nextCursor)
```

<details>
  <summary>⚠️ **Important** ⚠️</summary>

The **\_limit** parameter specifies the maximum number of vaults to scan, not the number of matches where **\_member** has **\_role**.

Each call examines up to **\_limit** vaults starting from **\_cursor**, regardless of how many contain the specified role.
This guarantees bounded gas cost and prevents full-list scans when the member has no assigned roles (**\_memberNoRoles** case).

If the provided member address has no matching roles, the function still stops after **\_limit** iterations —
it will not iterate through all vaults (≈272 M gas for full traversal).

Continue paginating by calling again with **nextCursor** until it equals 0.

</details>

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
