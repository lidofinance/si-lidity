// SPDX-FileCopyrightText: 2025 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.25;
import { VaultHub } from "contracts/0.8.25/vaults/VaultHub.sol";
import { IStakingVault } from "contracts/0.8.25/vaults/interfaces/IStakingVault.sol";
import { ILido } from "contracts/common/interfaces/ILido.sol";
import { ILidoLocator } from "contracts/common/interfaces/ILidoLocator.sol";
import { LazyOracle } from "contracts/0.8.25/vaults/LazyOracle.sol";

contract VaultViewer {
    struct VaultData {
        address vaultAddress;
        VaultHub.VaultConnection connection;
        VaultHub.VaultRecord record;
        uint256 totalValue;
        uint256 liabilityStETH;
        uint256 nodeOperatorFeeRate;
        bool isReportFresh;
        LazyOracle.QuarantineInfo quarantineInfo;
    }

    struct VaultMembers {
        address vault;
        address owner;
        address nodeOperator;
        address[][] members;
    }

    /**
     * @notice Strict true value for checking role membership
     */
    bytes32 constant strictTrue = keccak256(hex"0000000000000000000000000000000000000000000000000000000000000001");

    /**
     * @notice Default admin role for checking roles
     */
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    ILidoLocator public immutable LIDO_LOCATOR;
    VaultHub public immutable VAULT_HUB;
    LazyOracle public immutable LAZY_ORACLE;

    /// @notice Constructor
    /// @param _lidoLocator Address of the lido locator
    constructor(address _lidoLocator) {
        if (_lidoLocator == address(0)) revert ZeroArgument("_lidoLocator");
        LIDO_LOCATOR = ILidoLocator(_lidoLocator);

        address vaultHubAddress = LIDO_LOCATOR.vaultHub();
        if (vaultHubAddress == address(0)) revert ZeroVaultHub();
        VAULT_HUB = VaultHub(payable(vaultHubAddress));

        address lazyOracleAddress = LIDO_LOCATOR.lazyOracle();
        if (lazyOracleAddress == address(0)) revert ZeroLazyOracle();
        LAZY_ORACLE = LazyOracle(lazyOracleAddress);
    }

    /// @notice Checks if a given address is a contract
    /// @param account The address to check
    /// @return True if the address is a contract, false otherwise
    function isContract(address account) public view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(account)
        }
        return size > 0;
    }

    /// @notice Checks if a given address is the owner of a connection vault
    /// @param vault The vault to check
    /// @param _owner The address to check
    /// @return True if the address is the owner, false otherwise
    function isOwner(IStakingVault vault, address _owner) public view returns (bool) {
        // For connected vaults the `vault.owner()` is VaultHub
        VaultHub.VaultConnection memory connection = VAULT_HUB.vaultConnection(address(vault));
        if (connection.owner == _owner) {
            return true;
        }

        return _checkHasRole(connection.owner, _owner, DEFAULT_ADMIN_ROLE);
    }

    /// @notice Checks if a given address has a given role on a connection vault owner contract
    /// @param vault The vault to check
    /// @param _member The address to check
    /// @param _role The role to check
    /// @return True if the address has the role, false otherwise
    /// @dev Return roles only for connection vault owner - dashboard contract
    function hasRole(IStakingVault vault, address _member, bytes32 _role) public view returns (bool) {
        // For connected vaults the `vault.owner()` is VaultHub
        VaultHub.VaultConnection memory connection = VAULT_HUB.vaultConnection(address(vault));
        if (connection.owner == address(0)) {
            return false;
        }

        return _checkHasRole(connection.owner, _member, _role);
    }

    /// @notice Returns all vaults owned by a given address
    /// @param _owner Address of the owner
    /// @return An array of vaults owned by the given address
    function vaultsByOwner(address _owner) public view returns (IStakingVault[] memory) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsByOwner(_owner);

        return _filterNonZeroVaults(vaults, 0, validCount);
    }

    /// @notice Returns all vaults owned by a given address
    /// @param _owner Address of the owner
    /// @param _from Index to start from inclisive
    /// @param _to Index to end at non-inculsive
    /// @return array of vaults owned by the given address
    /// @return number of leftover vaults in range
    function vaultsByOwnerBound(
        address _owner,
        uint256 _from,
        uint256 _to
    ) public view returns (IStakingVault[] memory, uint256) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsByOwner(_owner);

        uint256 count = validCount > _to ? _to : validCount;
        uint256 leftover = validCount > _to ? validCount - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns all vaults with a given role on a given address
    /// @param _role Role to check
    /// @param _member Address to check
    /// @return An array of vaults with the given role on the given address
    /// @dev Return roles only for connection vault owner - dashboard contract
    function vaultsByRole(bytes32 _role, address _member) public view returns (IStakingVault[] memory) {
        (IStakingVault[] memory vaults, uint256 valid) = _vaultsByRole(_role, _member);

        return _filterNonZeroVaults(vaults, 0, valid);
    }

    /// @notice Returns all vaults with a given role on a given address
    /// @param _role Role to check
    /// @param _member Address to check
    /// @param _from Index to start from inclisive
    /// @param _to Index to end at non-inculsive
    /// @return array of vaults in range with the given role on the given address
    /// @return number of leftover vaults
    /// @dev Return roles only for connection vault owner - dashboard contract
    function vaultsByRoleBound(
        bytes32 _role,
        address _member,
        uint256 _from,
        uint256 _to
    ) public view returns (IStakingVault[] memory, uint256) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsByRole(_role, _member);

        uint256 count = validCount > _to ? _to : validCount;
        uint256 leftover = validCount > _to ? validCount - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns all connected vaults
    /// @return array of connected vaults
    function vaultsConnected() public view returns (IStakingVault[] memory) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsConnected();

        return _filterNonZeroVaults(vaults, 0, validCount);
    }

    /// @notice Returns all connected vaults within a range
    /// @param _from Index to start from inclisive
    /// @param _to Index to end at non-inculsive
    /// @return array of connected vaults
    /// @return number of leftover connected vaults
    function vaultsConnectedBound(uint256 _from, uint256 _to) public view returns (IStakingVault[] memory, uint256) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsConnected();

        uint256 count = validCount > _to ? _to : validCount;
        uint256 leftover = validCount > _to ? validCount - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns aggregated data for a single vault
    /// @param vault Address of the vault
    /// @return data Aggregated vault data
    function getVaultData(address vault) public view returns (VaultData memory data) {
        ILido lido = VAULT_HUB.LIDO();
        VaultHub.VaultConnection memory connection = VAULT_HUB.vaultConnection(vault);
        VaultHub.VaultRecord memory record = VAULT_HUB.vaultRecord(vault);
        uint256 nodeOperatorFeeRate = _getNodeOperatorFeeRate(connection.owner);
        LazyOracle.QuarantineInfo memory quarantineInfo = LAZY_ORACLE.vaultQuarantine(vault);

        data = VaultData({
            vaultAddress: vault,
            connection: connection,
            record: record,
            totalValue: VAULT_HUB.totalValue(vault),
            liabilityStETH: lido.getPooledEthBySharesRoundUp(record.liabilityShares),
            nodeOperatorFeeRate: nodeOperatorFeeRate,
            isReportFresh: VAULT_HUB.isReportFresh(vault),
            quarantineInfo: quarantineInfo
        });
    }

    /// @notice Returns aggregated data for a batch of connected vaults
    /// @param _from Index to start from inclusive
    /// @param _to Index to end at non-inclusive
    /// @return vaultsData Array of aggregated vault data
    /// @return leftover Number of leftover vaults
    function getVaultsDataBound(
        uint256 _from,
        uint256 _to
    ) external view returns (VaultData[] memory vaultsData, uint256 leftover) {
        (IStakingVault[] memory vaults, uint256 validCount) = _vaultsConnected();

        uint256 count = validCount > _to ? _to : validCount;
        leftover = validCount > _to ? validCount - _to : 0;

        if (count < _from) revert WrongPaginationRange(_from, _to);

        vaultsData = new VaultData[](count - _from);
        for (uint256 i = 0; i < vaultsData.length; i++) {
            vaultsData[i] = getVaultData(address(vaults[_from + i]));
        }
    }

    /// @notice Returns the VaultMembers for each specified role on a single vault
    /// @param vaultAddress The address of the vault
    /// @param roles An array of role identifiers (bytes32) to query on the vault’s owner contract
    /// @return roleMembers VaultMembers containing vault address, owner, nodeOperator, and corresponding role members
    function getRoleMembers(
        address vaultAddress,
        bytes32[] calldata roles
    ) public view returns (VaultMembers memory roleMembers) {
        IStakingVault vaultContract = IStakingVault(vaultAddress);
        VaultHub.VaultConnection memory connection = VAULT_HUB.vaultConnection(vaultAddress);
        // For connected vaults the `vaultContract.owner()` is VaultHub
        // connection.owner is the owner of the vault - dashboard contract
        roleMembers.vault = vaultAddress;
        roleMembers.owner = connection.owner;
        roleMembers.nodeOperator = _getNodeOperatorAddress(vaultAddress);
        roleMembers.members = new address[][](roles.length);

        // owner may be an EOA wallet
        if (!isContract(roleMembers.owner)) {
            return roleMembers;
        }

        for (uint256 i = 0; i < roles.length; i++) {
            roleMembers.members[i] = _getRoleMember(roleMembers.owner, roles[i]);
        }
        return roleMembers;
    }

    /// @notice Returns VaultMembers for each role on multiple vaults
    /// @param vaultAddresses Array of vault addresses to query
    /// @param roles Array of roles to check for each vault
    /// @return result Array of VaultMembers containing vault address, owner, nodeOperator and corresponding role members
    function getRoleMembersBatch(
        address[] calldata vaultAddresses,
        bytes32[] calldata roles
    ) external view returns (VaultMembers[] memory result) {
        result = new VaultMembers[](vaultAddresses.length);

        for (uint256 i = 0; i < vaultAddresses.length; i++) {
            result[i] = getRoleMembers(vaultAddresses[i], roles);
        }
    }

    // ==================== Internal Functions ====================

    /// @dev common logic for vaultsConnected and vaultsConnectedBound
    /// @custom:todo get vaults by pages, not all vaults
    function _vaultsConnected() internal view returns (IStakingVault[] memory, uint256) {
        uint256 count = VAULT_HUB.vaultsCount();
        IStakingVault[] memory vaults = new IStakingVault[](count);
        uint256 connectedCounter = 0;

        // The `vaultByIndex` is 1-based list
        for (uint256 i = 1; i <= count; i++) {
            // variable declaration inside the loop doesn’t affect gas costs
            address vault = VAULT_HUB.vaultByIndex(i);
            if (VAULT_HUB.isVaultConnected(vault)) {
                vaults[connectedCounter] = IStakingVault(vault);
                connectedCounter++;
            }
        }

        return (vaults, connectedCounter);
    }

    /// @dev common logic for vaultsByRole and vaultsByRoleBound
    /// @custom:todo get vaults by pages, not all vaults
    function _vaultsByRole(bytes32 _role, address _member) internal view returns (IStakingVault[] memory, uint256) {
        uint256 count = VAULT_HUB.vaultsCount();
        IStakingVault[] memory vaults = new IStakingVault[](count);
        uint256 validCounter = 0;

        // The `vaultByIndex` is 1-based list
        for (uint256 i = 1; i <= count; i++) {
            // variable declaration inside the loop doesn’t affect gas costs
            IStakingVault vault = IStakingVault(VAULT_HUB.vaultByIndex(i));
            if (hasRole(vault, _member, _role)) {
                vaults[validCounter] = vault;
                validCounter++;
            }
        }

        return (vaults, validCounter);
    }

    /// @dev common logic for vaultsByOwner and vaultsByOwnerBound
    /// @custom:todo get vaults by pages, not all vaults
    function _vaultsByOwner(address _owner) internal view returns (IStakingVault[] memory, uint256) {
        uint256 count = VAULT_HUB.vaultsCount();
        IStakingVault[] memory vaults = new IStakingVault[](count);
        uint256 validCounter = 0;

        // The `vaultByIndex` is 1-based list
        for (uint256 i = 1; i <= count; i++) {
            IStakingVault vault = IStakingVault(VAULT_HUB.vaultByIndex(i));
            if (isOwner(vault, _owner)) {
                vaults[validCounter] = vault;
                validCounter++;
            }
        }
        return (vaults, validCounter);
    }

    /// @notice Safely attempt a staticcall to `getRoleMembers(bytes32)` on the owner address
    /// @dev common logic for getRoleMembers
    /// @dev More gas-efficient to do any `isContract(owner)` check in the caller
    /// @param owner The address to call (may be a contract or an EOA)
    /// @param role The role identifier
    /// @return members Array of addresses if the call succeeds; empty array otherwise
    function _getRoleMember(address owner, bytes32 role) internal view returns (address[] memory members) {
        (bool success, bytes memory data) = owner.staticcall(abi.encodeWithSignature("getRoleMembers(bytes32)", role));

        if (success) {
            members = abi.decode(data, (address[]));
        }
    }

    /// @notice safely returns if role member has given role
    /// @param _contract that can have ACL or not
    /// @param _member addrress to check for role
    /// @return _role ACL role bytes
    function _checkHasRole(address _contract, address _member, bytes32 _role) internal view returns (bool) {
        if (!isContract(_contract)) return false;

        bytes memory payload = abi.encodeWithSignature("hasRole(bytes32,address)", _role, _member);
        (bool success, bytes memory result) = _contract.staticcall(payload);

        if (success && keccak256(result) == strictTrue) {
            return true;
        } else {
            return false;
        }
    }

    /// @notice Filters out zero address vaults from an array
    /// @param _vaults Array of vaults to filter
    /// @return filtered An array of non-zero vaults
    function _filterNonZeroVaults(
        IStakingVault[] memory _vaults,
        uint256 _from,
        uint256 _to
    ) internal pure returns (IStakingVault[] memory filtered) {
        if (_to < _from) revert WrongPaginationRange(_from, _to);

        uint256 count = _to - _from;
        filtered = new IStakingVault[](count);
        for (uint256 i = 0; i < count; i++) {
            filtered[i] = _vaults[_from + i];
        }
    }

    /// @notice Tries to fetch nodeOperatorFeeRate() from the vault owner if it's a dashboard contract
    /// @dev Uses low-level staticcall to avoid reverting when the method is missing or the address is an EOA
    /// @param owner The address of the vault owner (can be either a contract or an EOA)
    /// @return fee The decoded fee value if present, otherwise 0
    function _getNodeOperatorFeeRate(address owner) internal view returns (uint256 fee) {
        if (isContract(owner)) {
            (bool success, bytes memory result) = owner.staticcall(abi.encodeWithSignature("nodeOperatorFeeRate()"));
            // Check ensures safe decoding — avoids abi.decode revert on short return data
            if (success && result.length >= 32) {
                fee = abi.decode(result, (uint256));
            }
        }
    }

    /// @notice Tries to fetch nodeOperator() from the vault contract
    /// @dev Uses low-level staticcall to avoid reverting when the method is missing or vault is not a valid contract
    /// @param vault The address of the vault (must be a contract implementing nodeOperator())
    /// @return operator The decoded nodeOperator address if present, otherwise address(0)
    /// @custom:todo Think about the need for this method
    function _getNodeOperatorAddress(address vault) internal view returns (address operator) {
        if (isContract(vault)) {
            (bool success, bytes memory result) = vault.staticcall(abi.encodeWithSignature("nodeOperator()"));
            // Check ensures safe decoding — avoids abi.decode revert on short return data
            if (success && result.length >= 32) {
                operator = abi.decode(result, (address));
            }
        }
    }

    // ==================== Errors ====================

    /// @notice Error for zero address arguments
    /// @param argName Name of the argument that is zero
    error ZeroArgument(string argName);

    /// @notice LidoLocator returned address zero
    error ZeroVaultHub();
    error ZeroLazyOracle();

    /// @notice Error for wrong pagination range
    /// @param _from Start of the range
    /// @param _to End of the range
    error WrongPaginationRange(uint256 _from, uint256 _to);
}
