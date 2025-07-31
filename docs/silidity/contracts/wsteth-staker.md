---
sidebar_position: 3
---

# WstETHReferralStaker

- [Source code](https://github.com/lidofinance/si-lidity/blob/develop/si-contracts/0.8.25/WstETHReferralStaker.sol)

**WstETHReferralStaker** is a utility contract that allows users to stake ETH into the Lido protocol with referral address, then automatically wrap the received stETH into wstETH and transfer it back to the user in a single transaction.

## Upgradability

This contract is **not upgradable**.

## Interfaces

### IWstETH

| Function                                                | Description                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `wrap(uint256 _stETHAmount) external returns (uint256)` | Wraps `_stETHAmount` of stETH into wstETH and returns the amount of wstETH minted. [More here](https://docs.lido.fi/contracts/wsteth#wrap) |
| `stETH() external view returns (address)`               | Returns the underlying stETH token address.                                                                                                |

### IStETH

| Function                                                                             | Description                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit(address _referral) external payable returns (uint256)`                       | Stakes ETH, optionally credits a referral, and mints stETH shares for the caller; returns the number of shares minted. [More here](https://docs.lido.fi/contracts/lido#submit-1) |
| `getPooledEthBySharesRoundUp(uint256 _sharesAmount) external view returns (uint256)` | Converts a given `_sharesAmount` of stETH shares into the ETH-equivalent amount, rounding up. [More here](https://github.com/lidofinance/core/pull/874)                          |

## Methods

### stakeETH

Stake ETH with `referral` address.

```solidity
function stakeETH(address _referral) external payable returns (uint256)
```

**Parameters**

| Parameter Name | Type      | Description                                   |
| -------------- | --------- | --------------------------------------------- |
| `_referral`    | `address` | Referral address for Lido's referral program. |

**Returns**

Amount of wstETH user receives after wrap.
