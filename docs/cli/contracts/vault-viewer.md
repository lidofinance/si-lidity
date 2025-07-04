# VaultViewer

- [Source code](https://github.com/lidofinance/si-lidity/blob/develop/si-contracts/0.8.25/VaultViewer.sol)
- [Deployed contract on the HOODI](https://hoodi.etherscan.io/address/0xe1E9d4B5fc05A8B824B211164A683B1AefB46F31)

**VaultViewer** is a read-only utility contract designed to simplify querying aggregated data about staking vaults managed by the VaultHub.

Currently, these are **view-only contracts**, designed to provide easy read access to staking data.

## Upgradability

This contract is **not upgradable** and is intended solely for efficient on-chain data aggregation and access.

## Data Structures

### VaultData

Holds aggregated data for a vault:

| Field                 | Type                       |
| --------------------- | -------------------------- |
| `vaultAddress`        | `address`                  |
| `connection`          | `VaultHub.VaultConnection` |
| `record`              | `VaultHub.VaultRecord`     |
| `totalValue`          | `uint256`                  |
| `liabilityStETH`      | `uint256`                  |
| `nodeOperatorFeeRate` | `uint256`                  |

### VaultMembers

Holds information about members related to a vault:

| Field          | Type          |
| -------------- | ------------- |
| `vault`        | `address`     |
| `owner`        | `address`     |
| `nodeOperator` | `address`     |
| `members`      | `address[][]` |

## Methods

### vaultsConnected

Returns all connected vaults registered in the VaultHub.

```solidity
function vaultsConnected() view returns(IStakingVault[])
```

### vaultsConnectedBound

Returns connected vaults within a specified index range and number of leftover vaults.

```solidity
function vaultsConnectedBound(uint256 _from, uint256 _to)
view returns(IStakingVault[] memory, uint256)
```

### vaultsByOwner

Returns vaults owned by a specific address.

```solidity
function vaultsByOwner(address _owner) view returns(IStakingVault[])
```

### vaultsByOwnerBound

Returns vaults owned by an address within a specific range and leftover count.

```solidity
function vaultsByOwnerBound(address _owner, uint256 _from, uint256 _to)
view returns(IStakingVault[] memory, uint256)
```

### vaultsByRole

Returns vaults where a member holds a specific role on the vault's owner contract.

```solidity
function vaultsByRole(bytes32 _role, address _member) view returns(IStakingVault[])
```

### vaultsByRoleBound

Returns vaults for a role and member within a range and leftover count.

```solidity
function vaultsByRoleBound(bytes32 _role, address _member, uint256 _from, uint256 _to)
view returns(IStakingVault[] memory, uint256)
```

### getVaultData

Returns aggregated data for a specific vault, including value, liabilities, and operator fee.

```solidity
function getVaultData(address vault)
view returns(
  VaultData {
  address vaultAddress;
  VaultHub.VaultConnection connection;
  VaultHub.VaultRecord record;
  uint256 totalValue;
  uint256 liabilityStETH;
  uint256 nodeOperatorFeeRate;
  }
)
```

### getVaultsDataBound

Returns aggregated data for connected vaults within a range.

```solidity
function getVaultsDataBound(uint256 _from, uint256 _to)
view returns(VaultData[] memory, uint256)
```

### getRoleMembers

Returns detailed role members data for a vault owner.

```solidity
function getRoleMembers(address vaultAddress, bytes32[] calldata roles)
view returns(
  VaultMembers {
  address vault;
  address owner;
  address nodeOperator;
  address[][] members;
  }
)
```

### getRoleMembersBatch

Returns role members data for multiple vaults.

```solidity
function getRoleMembersBatch(address[] calldata vaultAddresses, bytes32[] calldata roles)
view returns(VaultMembers[] memory)
```
