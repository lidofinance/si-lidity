// SPDX-License-Identifier: UNLICENSED
// for testing purposes only

pragma solidity 0.8.25;

import {SafeCast} from "@openzeppelin/contracts-v5.2/utils/math/SafeCast.sol";

import {VaultHub} from "contracts/0.8.25/vaults/VaultHub.sol";
import {IStakingVault} from "contracts/0.8.25/vaults/interfaces/IStakingVault.sol";
import {RefSlotCache, DoubleRefSlotCache, DOUBLE_CACHE_LENGTH} from "contracts/0.8.25/vaults/lib/RefSlotCache.sol";
import {ILido} from "contracts/common/interfaces/ILido.sol";
import {ILidoLocator} from "contracts/common/interfaces/ILidoLocator.sol";

contract VaultHub__MockForHubViewer {
    using RefSlotCache for RefSlotCache.Uint104WithCache;
    using DoubleRefSlotCache for DoubleRefSlotCache.Int104WithCache[DOUBLE_CACHE_LENGTH];

    ILido public immutable LIDO;

    // keccak256(abi.encode(uint256(keccak256("VaultHub")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STORAGE_LOCATION = 0xb158a1a9015c52036ff69e7937a7bb424e82a8c4cbec5c5309994af06d825300;

    constructor(ILido _lido) {
        LIDO = _lido;

        _storage().vaults.push(address(0));
    }

    event Mock__VaultDisconnected(address vault);
    event Mock__Rebalanced(uint256 amount);

    function vaultConnection(address _vault) external view returns (VaultHub.VaultConnection memory) {
        return _storage().connections[_vault];
    }

    function vaultByIndex(uint256 _index) external view returns (address) {
        _requireNotZero(_index);
        return _storage().vaults[_index];
    }

    function isVaultConnected(address _vault) external view returns (bool) {
        return _storage().connections[_vault].vaultIndex != 0;
    }

    function vaultRecord(address _vault) external view returns (VaultHub.VaultRecord memory) {
        return _storage().records[_vault];
    }

    function _vaultRecord(address _vault) internal view returns (VaultHub.VaultRecord storage) {
        return _storage().records[_vault];
    }

    function vaultsCount() public view returns (uint256) {
        return _storage().vaults.length - 1;
    }

    function totalValue(address _vault) external view returns (uint256) {
        return _totalValue(_vaultRecord(_vault));
    }

    function _totalValue(VaultHub.VaultRecord storage _record) internal view returns (uint256) {
        VaultHub.Report memory report = _record.report;
        DoubleRefSlotCache.Int104WithCache[DOUBLE_CACHE_LENGTH] memory inOutDelta = _record.inOutDelta;
        return SafeCast.toUint256(int256(uint256(report.totalValue)) + inOutDelta.currentValue() - report.inOutDelta);
    }

    function isReportFresh(address _vault) external view returns (bool) {
        return true;
    }

    function disconnect(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function voluntaryDisconnect(address _vault) external {
        emit Mock__VaultDisconnected(_vault);
    }

    function mock_connectVault(address _vault, address _owner) external {
        VaultHub.Storage storage $ = _storage();

        VaultHub.Report memory report = VaultHub.Report(
            uint104(10), // totalValue
            int104(1), // inOutDelta
            uint48(1749550671) // timestamp
        );

        VaultHub.VaultConnection memory vc = VaultHub.VaultConnection(
            _owner,
            uint96(1), // shareLimit
            uint96($.vaults.length), // vaultIndex
            uint48(type(uint48).max), // disconnectInitiatedTs
            uint16(1), // reserveRatioBP
            uint16(1), // forcedRebalanceThresholdBP
            uint16(1), // infraFeeBP
            uint16(1), // liquidityFeeBP
            uint16(1), // reservationFeeBP
            false // beaconChainDepositsPauseIntent
        );

        $.vaults.push(_vault);
        $.connections[_vault] = vc;

        VaultHub.VaultRecord storage vr = $.records[_vault];

        vr.report = report;
        vr.maxLiabilityShares = uint96(2);
        vr.liabilityShares = uint96(1);

        vr.inOutDelta[0] = DoubleRefSlotCache.Int104WithCache({
            value: int104(0),
            valueOnRefSlot: int104(0),
            refSlot: uint48(0)
        });
        vr.inOutDelta[1] = DoubleRefSlotCache.Int104WithCache({
            value: int104(0),
            valueOnRefSlot: int104(0),
            refSlot: uint48(0)
        });

        vr.minimalReserve = uint128(1);
        vr.redemptionShares = uint128(0);
        vr.cumulativeLidoFees = uint128(0);
        vr.settledLidoFees = uint128(0);
    }

    function _storage() private pure returns (VaultHub.Storage storage $) {
        assembly {
            $.slot := STORAGE_LOCATION
        }
    }

    function _requireNotZero(uint256 _value) internal pure {
        if (_value == 0) revert ZeroArgument();
    }

    function _requireNotZero(address _address) internal pure {
        if (_address == address(0)) revert ZeroAddress();
    }

    error ZeroAddress();
    error ZeroArgument();
}
