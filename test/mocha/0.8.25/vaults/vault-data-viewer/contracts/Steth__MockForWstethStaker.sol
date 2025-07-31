// SPDX-License-Identifier: UNLICENSED
// for testing purposes only

pragma solidity 0.4.24;

import {StETHPermit} from "contracts/0.4.24/StETHPermit.sol";

contract Steth__MockForWstethStaker is StETHPermit {
    uint256 public totalPooledEther;
    uint256 public totalShares;

    constructor() public {
        _resume();
    }

    function initializeEIP712StETH(address _eip712StETH) external {
        _initializeEIP712StETH(_eip712StETH);
    }

    function _getTotalPooledEther() internal view returns (uint256) {
        return totalPooledEther;
    }

    // StETH::_getTotalShares
    function _getTotalShares() internal view returns (uint256) {
        return totalShares;
    }

    // StETH::getSharesByPooledEth
    function getSharesByPooledEth(uint256 _ethAmount) public view returns (uint256) {
        return (_ethAmount * _getTotalShares()) / _getTotalPooledEther();
    }

    // StETH::getPooledEthByShares
    function getPooledEthByShares(uint256 _sharesAmount) public view returns (uint256) {
        return (_sharesAmount * _getTotalPooledEther()) / _getTotalShares();
    }

    function submit(address _referral) public payable returns (uint256) {
        require(msg.value != 0, "ZERO_DEPOSIT");

        uint256 sharesAmount = getSharesByPooledEth(msg.value);

        _mintShares(msg.sender, sharesAmount);

        totalPooledEther = totalPooledEther + msg.value;
        totalShares = totalShares + sharesAmount;

        emit Submitted(msg.sender, msg.value, _referral);

        _emitTransferAfterMintingShares(msg.sender, sharesAmount);
        return sharesAmount;
    }

    event Submitted(address indexed sender, uint256 amount, address referral);

    // Mock functions
    function mock__setTotalPooledEther(uint256 _totalPooledEther) external {
        totalPooledEther = _totalPooledEther;
    }

    function mock__setTotalShares(uint256 _totalShares) external {
        totalShares = _totalShares;
    }
}
