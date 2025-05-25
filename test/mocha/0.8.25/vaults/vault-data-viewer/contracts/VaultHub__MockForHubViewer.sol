// SPDX-License-Identifier: UNLICENSED
// for testing purposes only

pragma solidity 0.8.25;

import {VaultHub} from "contracts/0.8.25/vaults/VaultHub.sol";
import {IStakingVault} from "contracts/0.8.25/vaults/interfaces/IStakingVault.sol";
import {ILido} from "contracts/0.8.25/interfaces/ILido.sol";
import {ILidoLocator} from "contracts/common/interfaces/ILidoLocator.sol";

contract VaultHub__MockForHubViewer {
    ILido public immutable LIDO;
    ILidoLocator public immutable LIDO_LOCATOR;

    uint256 internal constant BPS_BASE = 100_00;
    // keccak256(abi.encode(uint256(keccak256("VaultHub")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant VAULT_HUB_STORAGE_LOCATION =
        0xb158a1a9015c52036ff69e7937a7bb424e82a8c4cbec5c5309994af06d825300;

    constructor(ILidoLocator _locator, ILido _lido) {
        LIDO_LOCATOR = _locator;
        LIDO = _lido;
    }

    event Mock__VaultDisconnected(address vault);
    event Mock__Rebalanced(uint256 amount);

    //    mapping(address => VaultHub.VaultSocket) public vaultSockets;

    //    function mock__setVaultSocket(address _vault, VaultHub.VaultSocket memory socket) external {
    //        vaultSockets[_vault] = socket;
    //    }

    function mock_vaultLock(address _vault, uint256 amount) external {
        IStakingVault(_vault).lock(amount);
    }

    //    function vaultSocket(address _vault) external view returns (VaultHub.VaultSocket memory) {
    //        return vaultSockets[_vault];
    //    }
    function vaultSocket(address _vault) external view returns (VaultHub.VaultSocket memory) {
        VaultHub.VaultHubStorage storage $ = _getVaultHubStorage();
        return $.sockets[$.vaultIndex[_vault]];
    }

    function vaultSocket(uint256 _index) external view returns (VaultHub.VaultSocket memory) {
        return _getVaultHubStorage().sockets[_index];
    }

    function vaultSocketIndex(address _vault) public view returns (uint256) {
        return _getVaultHubStorage().vaultIndex[_vault];
    }

    function vaultsCount() public view returns (uint256) {
        return _getVaultHubStorage().sockets.length;
    }

    function vault(uint256 _index) public view returns (address) {
        return _getVaultHubStorage().sockets[_index].vault;
    }

    function mock_vaultSocket() public view returns (VaultHub.VaultSocket[] memory) {
        return _getVaultHubStorage().sockets;
    }

    function disconnectVault(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function mintSharesBackedByVault(address /* vault */, address recipient, uint256 amount) external {
        LIDO.mintExternalShares(recipient, amount);
    }

    function burnSharesBackedByVault(address /* vault */, uint256 amount) external {
        LIDO.burnExternalShares(amount);
    }

    function voluntaryDisconnect(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function rebalance() external payable {
        emit Mock__Rebalanced(msg.value);
    }

    function mock_connectVault(address _vault) external {
        VaultHub.VaultHubStorage storage $ = _getVaultHubStorage();

        VaultHub.VaultSocket memory vr = VaultHub.VaultSocket(
            _vault,
            1, // liabilityShares
            uint96(1), // shareLimit,
            uint16(1), // reserveRatioBP
            uint16(1), // forcedRebalanceThresholdBP
            uint16(1), // treasuryFeeBP
            false, // pendingDisconnect
            uint96(1) // feeSharesCharged
        );

        $.vaultIndex[_vault] = $.sockets.length;
        $.sockets.push(vr);
    }

    function _getVaultHubStorage() private pure returns (VaultHub.VaultHubStorage storage $) {
        assembly {
            $.slot := VAULT_HUB_STORAGE_LOCATION
        }
    }
}
