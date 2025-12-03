// SPDX-FileCopyrightText: 2025 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.25;

import { Clones } from "@openzeppelin/contracts-v5.2/proxy/Clones.sol";
import { Dashboard } from "contracts/0.8.25/vaults/dashboard/Dashboard.sol";
import { VaultFactory } from "contracts/0.8.25/vaults/VaultFactory.sol";
import { ILidoLocator } from "contracts/common/interfaces/ILidoLocator.sol";
import { IStakingVault } from "contracts/0.8.25/vaults/interfaces/IStakingVault.sol";

/**
 * @title DashboardFactory
 * @author Lido
 * @notice The factory contract for Dashboard
 */
contract DashboardFactory {
    ILidoLocator public immutable LIDO_LOCATOR;

    /// @notice Constructor
    /// @param _lidoLocator Address of the lido locator
    constructor(address _lidoLocator) {
        if (_lidoLocator == address(0)) revert ZeroArgument("_lidoLocator");
        LIDO_LOCATOR = ILidoLocator(_lidoLocator);
    }

    /**
     * @notice Create Dashboard for Staking Vault
     * IMPORTANT: This function does NOT perform any post-deployment initialization
     * Operations such as:
     *  - `dashboard.initialize(...)`
     *  - `dashboard.connectToVaultHub(...)`
     * MUST be executed manually by the caller after the dashboard is created
     */
    /// @param vault The StakingVault for which the Dashboard is being created
    /// @param _defaultAdmin Address that will receive DEFAULT_ADMIN_ROLE on the new Dashboard
    /// @return dashboard The address of the newly created Dashboard
    function createDashboard(IStakingVault vault, address _defaultAdmin) external returns (Dashboard dashboard) {
        VaultFactory factory = VaultFactory(LIDO_LOCATOR.vaultFactory());
        bytes memory immutableArgs = abi.encode(address(vault));
        dashboard = Dashboard(payable(Clones.cloneWithImmutableArgs(factory.DASHBOARD_IMPL(), immutableArgs)));

        dashboard.grantRole(dashboard.DEFAULT_ADMIN_ROLE(), _defaultAdmin);
        dashboard.revokeRole(dashboard.DEFAULT_ADMIN_ROLE(), address(this));

        emit DashboardCreated(address(dashboard), address(vault), _defaultAdmin);
    }

    // ==================== Internal Functions ====================

    /**
     * @notice Event emitted on a Dashboard creation
     * @param dashboard The address of the created Dashboard
     * @param vault The address of the created Vault
     * @param admin The address of the Dashboard admin
     */
    event DashboardCreated(address indexed dashboard, address indexed vault, address indexed admin);

    // ==================== Errors ====================

    /// @notice Error for zero address arguments
    /// @param argName Name of the argument that is zero
    error ZeroArgument(string argName);
}
