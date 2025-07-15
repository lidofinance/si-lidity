// SPDX-FileCopyrightText: 2025 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

// See contracts/COMPILERS.md
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts-v5.2/token/ERC20/IERC20.sol";

interface IWstETH is IERC20 {
    function wrap(uint256) external returns (uint256);

    function unwrap(uint256) external returns (uint256);

    function stETH() external view returns (address);
}

interface IStETH is IERC20 {
    function submit(address _referral) external payable returns (uint256);
}

contract WstETHStaker {
    IWstETH public wstETH;
    IStETH public stETH;

    constructor(IWstETH _wstETH) {
        wstETH = _wstETH;
        stETH = IStETH(wstETH.stETH());
        stETH.approve(address(wstETH), type(uint256).max);
    }

    function wrapETH(address _referral) external payable returns (uint256) {
        // 1. stake ETH and recieve stETH
        // event is emitted inside
        uint256 stETHAmount = stETH.submit{value: msg.value}(_referral);

        // 2. wrap stETH to wstETH
        // unlimited approval is set in constructor
        uint256 wstETHAmount = wstETH.wrap(stETHAmount);

        // 3. transfer wstETH to the user
        wstETH.transfer(msg.sender, wstETHAmount);

        return wstETH.wrap(stETHAmount);
    }
}
