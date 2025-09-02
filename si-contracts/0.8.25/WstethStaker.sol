// SPDX-FileCopyrightText: 2025 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.25;

import {Math} from "@openzeppelin/contracts-v5.2/utils/math/Math.sol";

import {IERC20} from "@openzeppelin/contracts-v5.2/token/ERC20/IERC20.sol";

interface IWstETH is IERC20 {
    function wrap(uint256) external returns (uint256);

    function stETH() external view returns (address);
}

interface IStETH is IERC20 {
    function submit(address _referral) external payable returns (uint256);

    function getPooledEthBySharesRoundUp(uint256 _sharesAmount) external view returns (uint256);

    function totalShares() external view returns (uint256);

    function getTotalPooledEther() external view returns (uint256);
}

contract WstETHReferralStaker {
    IWstETH public immutable wstETH;
    IStETH public immutable stETH;

    constructor(IWstETH _wstETH) {
        wstETH = _wstETH;
        stETH = IStETH(wstETH.stETH());
        stETH.approve(address(wstETH), type(uint256).max);
    }

    /**
     * @notice stakes ETH directly into wstETH with stETH referral
     * @param _referral The address used for the stETH referral program
     * @return amount of wstETH received
     */
    function stakeETH(address _referral) external payable returns (uint256) {
        // 1. stake ETH and recieve stETH
        // referral event and 0 check inside
        uint256 stethAmount = _getPooledEthBySharesRoundUp(stETH.submit{value: msg.value}(_referral));

        // 2. wrap stETH to wstETH
        // unlimited approval is set in constructor, 0 wstETH check inside
        uint256 wstETHAmount = wstETH.wrap(stethAmount);

        // 3. transfer wstETH to the caller
        wstETH.transfer(msg.sender, wstETHAmount);

        // 4. return the amount of wstETH
        return wstETHAmount;
    }

    /**
     * @notice A ported function from Lido V3 to get the amount of pooled ETH for a given amount of stETH shares 
     * @param _sharesAmount The amount of stETH shares to convert
     */
    function _getPooledEthBySharesRoundUp(uint256 _sharesAmount) internal view returns (uint256) {
        uint256 numeratorInEther = stETH.getTotalPooledEther();
        uint256 denominatorInShares = stETH.totalShares();

        return Math.ceilDiv(_sharesAmount * numeratorInEther, denominatorInShares);
    }
}
