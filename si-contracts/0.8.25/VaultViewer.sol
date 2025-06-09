// SPDX-FileCopyrightText: 2025 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.25;
import {VaultHub} from "contracts/0.8.25/vaults/VaultHub.sol";
import {IStakingVault} from "contracts/0.8.25/vaults/interfaces/IStakingVault.sol";
import {ILido} from "contracts/0.8.25/interfaces/ILido.sol";

interface IVault is IStakingVault {
    function owner() external view returns (address);
}

contract VaultViewer {
    enum VaultState {
        MintingAllowed, // Shares(inEth) <= 0.90
        Healthy, // 0.90  < Shares(inEth) <= 0.92
        Unhealthy, // 0.92 < Shares(inEth) < 1.00
        BadDebt // Shares(inEth) >= 1.00
    }

    struct VaultData {
        address vault;
        uint256 totalValue;
        uint256 forcedRebalanceThreshold;
        uint256 liabilityShares;
        uint256 stEthLiability;
        uint256 lidoTreasuryFee;
        uint256 nodeOperatorFee;
        bool isOwnerDashboard;
    }

    struct VaultRoleMembers {
        address vault;
        address owner;
        address nodeOperator;
        address depositor;
        address[][] members;
    }

    bytes32 constant strictTrue = keccak256(hex"0000000000000000000000000000000000000000000000000000000000000001");

    uint256 internal constant TOTAL_BASIS_POINTS = 100_00;

    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;

    VaultHub public immutable vaultHub;

    constructor(address _vaultHubAddress) {
        if (_vaultHubAddress == address(0)) revert ZeroArgument("_vaultHubAddress");
        vaultHub = VaultHub(_vaultHubAddress);
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

    /// @notice Checks the health of the vault depending on the valuation and shares minted
    /// @param _vault The address of the vault
    /// @return VaultState the state of the vault health
    function vaultState(IStakingVault _vault) public view returns (VaultState) {
        ILido lido = vaultHub.LIDO();

        VaultHub.VaultSocket memory socket = vaultHub.vaultSocket(address(_vault));
        uint256 valuation = _vault.totalValue();
        uint256 stethMinted = lido.getPooledEthByShares(socket.liabilityShares);

        if (stethMinted <= (valuation * (TOTAL_BASIS_POINTS - socket.reserveRatioBP)) / TOTAL_BASIS_POINTS) {
            return VaultState.MintingAllowed;
        } else if (
            stethMinted <= (valuation * (TOTAL_BASIS_POINTS - socket.forcedRebalanceThresholdBP)) / TOTAL_BASIS_POINTS
        ) {
            return VaultState.Healthy;
        } else if (stethMinted <= valuation) {
            return VaultState.Unhealthy;
        } else {
            return VaultState.BadDebt;
        }
    }

    /// @notice Checks if a given address is the owner of a vault
    /// @param vault The vault to check
    /// @param _owner The address to check
    /// @return True if the address is the owner, false otherwise
    function isOwner(IVault vault, address _owner) public view returns (bool) {
        address vaultOwner = vault.owner();
        if (vaultOwner == _owner) {
            return true;
        }

        return _checkHasRole(vaultOwner, _owner, DEFAULT_ADMIN_ROLE);
    }

    /// @notice Checks if a given address has a given role on a vault owner contract
    /// @param vault The vault to check
    /// @param _member The address to check
    /// @param _role The role to check
    /// @return True if the address has the role, false otherwise
    function hasRole(IVault vault, address _member, bytes32 _role) public view returns (bool) {
        address vaultOwner = vault.owner();
        if (vaultOwner == address(0)) {
            return false;
        }

        return _checkHasRole(vaultOwner, _member, _role);
    }

    /// @notice Returns all vaults owned by a given address
    /// @param _owner Address of the owner
    /// @return An array of vaults owned by the given address
    function vaultsByOwner(address _owner) public view returns (IVault[] memory) {
        (IVault[] memory vaults, uint256 valid) = _vaultsByOwner(_owner);

        return _filterNonZeroVaults(vaults, 0, valid);
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
    ) public view returns (IVault[] memory, uint256) {
        (IVault[] memory vaults, uint256 valid) = _vaultsByOwner(_owner);

        uint256 count = valid > _to ? _to : valid;
        uint256 leftover = valid > _to ? valid - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns all vaults with a given role on a given address
    /// @param _role Role to check
    /// @param _member Address to check
    /// @return An array of vaults with the given role on the given address
    function vaultsByRole(bytes32 _role, address _member) public view returns (IVault[] memory) {
        (IVault[] memory vaults, uint256 valid) = _vaultsByRole(_role, _member);

        return _filterNonZeroVaults(vaults, 0, valid);
    }

    /// @notice Returns all vaults with a given role on a given address
    /// @param _role Role to check
    /// @param _member Address to check
    /// @param _from Index to start from inclisive
    /// @param _to Index to end at non-inculsive
    /// @return array of vaults in range with the given role on the given address
    /// @return number of leftover vaults
    function vaultsByRoleBound(
        bytes32 _role,
        address _member,
        uint256 _from,
        uint256 _to
    ) public view returns (IVault[] memory, uint256) {
        (IVault[] memory vaults, uint256 valid) = _vaultsByRole(_role, _member);

        uint256 count = valid > _to ? _to : valid;
        uint256 leftover = valid > _to ? valid - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns all connected vaults
    /// @return array of connected vaults
    function vaultsConnected() public view returns (IVault[] memory) {
        (IVault[] memory vaults, uint256 valid) = _vaultsConnected();

        return _filterNonZeroVaults(vaults, 0, valid);
    }

    /// @notice Returns all connected vaults within a range
    /// @param _from Index to start from inclisive
    /// @param _to Index to end at non-inculsive
    /// @return array of connected vaults
    /// @return number of leftover connected vaults
    function vaultsConnectedBound(uint256 _from, uint256 _to) public view returns (IVault[] memory, uint256) {
        (IVault[] memory vaults, uint256 valid) = _vaultsConnected();

        uint256 count = valid > _to ? _to : valid;
        uint256 leftover = valid > _to ? valid - _to : 0;

        return (_filterNonZeroVaults(vaults, _from, count), leftover);
    }

    /// @notice Returns aggregated data for a single vault
    /// @param vault Address of the vault
    /// @return data Aggregated vault data
    function getVaultData(address vault) public view returns (VaultData memory data) {
        VaultHub.VaultSocket memory socket = vaultHub.vaultSocket(vault);
        ILido lido = vaultHub.LIDO();

        IVault vaultContract = IVault(vault);
        address owner = vaultContract.owner();
        (uint16 nodeOperatorFee, bool isDashboard) = _getNodeOperatorFeeIfDashboard(owner);

        data = VaultData({
            vault: vault,
            totalValue: vaultContract.totalValue(),
            forcedRebalanceThreshold: socket.forcedRebalanceThresholdBP,
            liabilityShares: socket.liabilityShares,
            stEthLiability: lido.getPooledEthByShares(socket.liabilityShares),
            lidoTreasuryFee: socket.treasuryFeeBP,
            nodeOperatorFee: nodeOperatorFee,
            isOwnerDashboard: isDashboard
        });
    }

    /// @notice Returns aggregated data for a batch of connected vaults
    /// @param _from Index to start from inclusive
    /// @param _to Index to end at non-inclusive
    /// @return vaultsData Array of aggregated vault data
    function getVaultsDataBound(uint256 _from, uint256 _to) external view returns (VaultData[] memory vaultsData) {
        (IVault[] memory vaults, uint256 valid) = _vaultsConnected();

        uint256 end = _to > valid ? valid : _to;
        uint256 count = end > _from ? end - _from : 0;

        vaultsData = new VaultData[](count);

        for (uint256 i = 0; i < count; i++) {
            vaultsData[i] = getVaultData(address(vaults[_from + i]));
        }
    }

    /// @notice Returns the owner, nodeOperator, depositor, and members for each specified role on a single vault
    /// @param vaultAddress The address of the vault
    /// @param roles An array of role identifiers (bytes32) to query on the vault’s owner contract
    /// @return owner The owner address of the vault
    /// @return nodeOperator The nodeOperator address of the vault
    /// @return depositor The depositor address of the vault
    /// @return members A 2D array where members[i] contains all accounts that hold roles[i] on the vault’s owner contract
    function getRoleMembers(address vaultAddress, bytes32[] calldata roles) public view returns (
        address owner,
        address nodeOperator,
        address depositor,
        address[][] memory members
    ) {
        IVault vaultContract = IVault(vaultAddress);
        owner = vaultContract.owner();
        nodeOperator = vaultContract.nodeOperator();
        depositor = vaultContract.depositor();

        members = new address[][](roles.length);

        // owner may be an EOA wallet
        if (!isContract(owner)) {
            return (owner, nodeOperator, depositor, members);
        }

        for (uint256 i = 0; i < roles.length; i++) {
            members[i] = _getRoleMember(owner, roles[i]);
        }
        return (owner, nodeOperator, depositor, members);
    }

    /// @notice Returns members for each role on multiple vaults
    /// @param vaultAddresses Array of vault addresses to query
    /// @param roles Array of roles to check for each vault
    /// @return result Array of VaultRoleMembers containing vault address and corresponding role members
    function getRoleMembersBatch(address[] calldata vaultAddresses, bytes32[] calldata roles) external view returns (VaultRoleMembers[] memory result) {
        result = new VaultRoleMembers[](vaultAddresses.length);

        for (uint256 i = 0; i < vaultAddresses.length; i++) {
            (
                address owner,
                address nodeOperator,
                address depositor,
                address[][] memory members
            ) = getRoleMembers(vaultAddresses[i], roles);

            result[i] = VaultRoleMembers({
                vault: vaultAddresses[i],
                owner: owner,
                nodeOperator: nodeOperator,
                depositor: depositor,
                members: members
            });
        }
        return result;
    }

    // ==================== Internal Functions ====================

    /// @dev common logic for vaultsConnected and vaultsConnectedBound
    function _vaultsConnected() internal view returns (IVault[] memory, uint256) {
        // TODO: get vaults by pages, not all vaults
        uint256 count = vaultHub.vaultsCount();
        IVault[] memory vaults = new IVault[](count);

        uint256 valid = 0;
        for (uint256 i = 0; i < count; i++) {
            if (!vaultHub.vaultSocket(i).pendingDisconnect) {
                vaults[valid] = IVault(vaultHub.vault(i));
                valid++;
            }
        }

        return (vaults, valid);
    }

    /// @dev common logic for vaultsByRole and vaultsByRoleBound
    function _vaultsByRole(bytes32 _role, address _member) internal view returns (IVault[] memory, uint256) {
        // TODO: get vaults by pages, not all vaults
        uint256 count = vaultHub.vaultsCount();
        IVault[] memory vaults = new IVault[](count);

        uint256 valid = 0;
        for (uint256 i = 0; i < count; i++) {
            if (hasRole(IVault(vaultHub.vault(i)), _member, _role)) {
                vaults[valid] = IVault(vaultHub.vault(i));
                valid++;
            }
        }

        return (vaults, valid);
    }

    /// @dev common logic for vaultsByOwner and vaultsByOwnerBound
    function _vaultsByOwner(address _owner) internal view returns (IVault[] memory, uint256) {
        // TODO: get vaults by pages, not all vaults
        uint256 count = vaultHub.vaultsCount();
        IVault[] memory vaults = new IVault[](count);

        // Populate the array with the owner's vaults
        uint256 valid = 0;

        // Populate the array with the owner's vaults
        for (uint256 i = 0; i < count; i++) {
            IVault vaultInstance = IVault(vaultHub.vault(i));
            if (isOwner(vaultInstance, _owner)) {
                vaults[valid] = IVault(vaultHub.vault(i));
                valid++;
            }
        }
        return (vaults, valid);
    }

    /// @notice Safely attempt a staticcall to `getRoleMembers(bytes32)` on the owner address.
    /// @dev More gas-efficient to do any `isContract(owner)` check in the caller.
    /// @param owner The address to call (may be a contract or an EOA).
    /// @param role The role identifier.
    /// @return members Array of addresses if the call succeeds; empty array otherwise.
    function _getRoleMember(address owner, bytes32 role) internal view returns (address[] memory members) {
        (bool success, bytes memory data) = owner.staticcall(
            abi.encodeWithSignature("getRoleMembers(bytes32)", role)
        );

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
        IVault[] memory _vaults,
        uint256 _from,
        uint256 _to
    ) internal pure returns (IVault[] memory filtered) {
        if (_to < _from) revert WrongPaginationRange(_from, _to);

        uint256 count = _to - _from;
        filtered = new IVault[](count);
        for (uint256 i = 0; i < count; i++) {
            filtered[i] = _vaults[_from + i];
        }
    }

    /// @notice Tries to fetch nodeOperatorFeeBP() from the vault owner if it's a dashboard contract
    /// @dev Uses low-level staticcall to avoid reverting when the method is missing or the address is an EOA
    /// @param owner The address of the vault owner (can be either a contract or an EOA)
    /// @return fee The decoded fee value if present, otherwise 0
    /// @return isDashboard True if the method exists and returned a valid value, false otherwise
    function _getNodeOperatorFeeIfDashboard(address owner) internal view returns (uint16 fee, bool isDashboard) {
        if (owner.code.length > 0) {
            (bool ok, bytes memory result) = owner.staticcall(
                abi.encodeWithSignature("nodeOperatorFeeBP()")
            );
            if (ok && result.length >= 32) {
                fee = abi.decode(result, (uint16));
                isDashboard = true;
            }
        }
    }

    // ==================== Errors ====================

    /// @notice Error for zero address arguments
    /// @param argName Name of the argument that is zero
    error ZeroArgument(string argName);

    /// @notice Error for wrong pagination range
    /// @param _from Start of the range
    /// @param _to End of the range
    error WrongPaginationRange(uint256 _from, uint256 _to);
}
