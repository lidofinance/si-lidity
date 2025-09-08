// SPDX-License-Identifier: UNLICENSED
// for testing purposes only

pragma solidity 0.8.25;

contract LazyOracle__MockForHubViewer {
    /// @notice Internal quarantine record
    struct Quarantine {
        uint128 pendingTotalValueIncrease;
        uint64 startTimestamp;
    }

    /// @notice Public view struct returned by vaultQuarantine
    struct QuarantineInfo {
        bool isActive;
        uint256 pendingTotalValueIncrease;
        uint256 startTimestamp;
        uint256 endTimestamp;
    }

    /// @notice Quarantine period used to compute endTimestamp
    uint64 public quarantinePeriod;

    /// @dev mapping from vault address to its Quarantine record
    mapping(address => Quarantine) private vaultQuarantines;

    /// @param _quarantinePeriod seconds duration for any quarantine
    constructor(uint64 _quarantinePeriod) {
        quarantinePeriod = _quarantinePeriod;
    }

    /// @notice Mock adding or updating a vault's quarantine
    /// @param _vault Address of the vault to quarantine
    /// @param _pending Total value increase under quarantine
    /// @param _startTimestamp When the quarantine starts (unix seconds)
    function mock_addVaultToQuarantine(address _vault, uint128 _pending, uint64 _startTimestamp) external {
        vaultQuarantines[_vault] = Quarantine({pendingTotalValueIncrease: _pending, startTimestamp: _startTimestamp});
    }

    /// @notice Returns the quarantine info for a given vault
    /// @param _vault Address of the vault
    /// @dev Returns zeroed structure if there is no active quarantine
    function vaultQuarantine(address _vault) external view returns (QuarantineInfo memory) {
        Quarantine storage q = vaultQuarantines[_vault];
        if (q.pendingTotalValueIncrease == 0) {
            return QuarantineInfo(false, 0, 0, 0);
        }

        return
            QuarantineInfo({
                isActive: true,
                pendingTotalValueIncrease: q.pendingTotalValueIncrease,
                startTimestamp: q.startTimestamp,
                endTimestamp: q.startTimestamp + quarantinePeriod
            });
    }
}
