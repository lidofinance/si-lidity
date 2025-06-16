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

        _getVaultHubStorage().vaults.push(address(0));
    }

    event Mock__VaultDisconnected(address vault);
    event Mock__Rebalanced(uint256 amount);

    //    function initialize(address _admin) external initializer {
    //        // the stone in the elevator. index 0 is reserved for not connected vaults
    //        _getVaultHubStorage().vaults.push(address(0));
    //    }

    function vaultConnection(address _vault) external view returns (VaultHub.VaultConnection memory) {
        return _getVaultHubStorage().connections[_vault];
    }

    function vaultByIndex(uint256 _index) external view returns (address) {
        return _getVaultHubStorage().vaults[_index];
    }

    function isVaultConnected(address _vault) external view returns (bool) {
        return _getVaultHubStorage().connections[_vault].vaultIndex != 0;
    }

    function vaultRecord(address _vault) external view returns (VaultHub.VaultRecord memory) {
        return _getVaultHubStorage().records[_vault];
    }

    function vaultsCount() public view returns (uint256) {
        return _getVaultHubStorage().vaults.length;
    }

    function vault(uint256 _index) public view returns (address) {
        return _getVaultHubStorage().vaults[_index];
    }

    function totalValue(address _vault) external view returns (uint256) {
        return _totalValue(_vaultRecord(_vault));
    }

    function _vaultRecord(address _vault) internal view returns (VaultHub.VaultRecord storage) {
        return _getVaultHubStorage().records[_vault];
    }

    function _totalValue(VaultHub.VaultRecord storage _record) internal view returns (uint256) {
        VaultHub.Report memory report = _record.report;
        return uint256(int256(uint256(report.totalValue)) + _record.inOutDelta - report.inOutDelta);
    }

    function disconnect(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function voluntaryDisconnect(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function rebalance() external payable {
        emit Mock__Rebalanced(msg.value);
    }

    function mock_connectVault(address _vault) external {
        VaultHub.Storage storage $ = _getVaultHubStorage();

        VaultHub.Report memory report = VaultHub.Report(
            uint128(10), // totalValue
            int128(10) // inOutDelta
        );

        VaultHub.VaultRecord memory vr = VaultHub.VaultRecord(
            report,
            uint128(0), // locked
            uint96(1), // liabilityShares
            uint64(1749550671), // reportTimestamp
            int128(1), // inOutDelta
            uint96(1) // feeSharesCharged
        );

        VaultHub.VaultConnection memory vc = VaultHub.VaultConnection(
            _vault,
            uint96(1), // shareLimit,
            uint96($.vaults.length), // vaultIndex
            false, // pendingDisconnect
            uint16(1), // reserveRatioBP
            uint16(1), // forcedRebalanceThresholdBP
            uint16(1), // infraFeeBP
            uint16(1), // liquidityFeeBP
            uint16(1) // reservationFeeBP
        );

        $.vaults.push(_vault);
        $.connections[_vault] = vc;
        $.records[_vault] = vr;
    }

    function _getVaultHubStorage() private pure returns (VaultHub.Storage storage $) {
        assembly {
            $.slot := VAULT_HUB_STORAGE_LOCATION
        }
    }
}
