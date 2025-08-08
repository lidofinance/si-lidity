import { expect } from "chai";
import { MaxUint256 } from "ethers";
import { network } from "hardhat";
import type { EthereumProvider } from "hardhat/types/providers";

import type { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { Steth__MockForWstethStaker, WstETH__HarnessForVault, WstETHReferralStaker } from "typechain-types";

import { ether } from "lib";

import { Snapshot } from "test-utils/suite";

// scope for tests and functions
let ethers: HardhatEthers;
let provider: EthereumProvider;
let snapshot: Snapshot;

describe("WstethRefferalStaker", () => {
  let user: HardhatEthersSigner;
  let refferalHandler: HardhatEthersSigner;
  let refferal: string;

  let wsteth: WstETH__HarnessForVault;
  let steth: Steth__MockForWstethStaker;
  let wrapper: WstETHReferralStaker;

  let originalState: string;

  before(async () => {
    const connection = await network.connect();
    ethers = connection.ethers;
    provider = connection.provider;
    snapshot = new Snapshot(provider);
    [user, refferalHandler] = await ethers.getSigners();

    refferal = refferalHandler.getAddress(); // All deploys
    steth = await ethers.deployContract("Steth__MockForWstethStaker");

    const totalEther = ether("1200000");
    const totalShares = ether("1000000");

    await steth.mock__setTotalPooledEther(totalEther);
    await steth.mock__setTotalShares(totalShares);

    wsteth = await ethers.deployContract("WstETH__HarnessForVault", [steth]);

    wrapper = await ethers.deployContract("WstETHReferralStaker", [wsteth]);
    wrapper = wrapper.connect(user);
  });

  beforeEach(async () => {
    originalState = await snapshot.take();
  });

  afterEach(async () => {
    await snapshot.restore(originalState);
  });

  context("constructor", () => {
    it("correctly deploys wrapper", async () => {
      const newWrapper: WstETHReferralStaker = await ethers.deployContract("WstETHReferralStaker", [wsteth]);
      expect(await newWrapper.wstETH()).to.equal(await wsteth.getAddress());
      expect(await newWrapper.stETH()).to.equal(await steth.getAddress());
      expect(await steth.allowance(newWrapper.getAddress(), wsteth.getAddress())).to.equal(MaxUint256);
    });
  });

  context("staking", () => {
    it("can stake to wstETH", async () => {
      const amount = ether("1");
      const wstethAmount = await steth.getSharesByPooledEth(amount);

      const tx = await (await wrapper.stakeETH(refferal, { value: amount })).wait();

      expect(await wsteth.balanceOf(user.getAddress())).to.equal(wstethAmount);

      await expect(tx)
        .to.emit(steth, "Submitted")
        .withArgs(await wrapper.getAddress(), amount, refferal);
    });

    it("revert on zero ether", async () => {
      await expect(wrapper.stakeETH(refferal, { value: 0 })).to.be.revertedWith("ZERO_DEPOSIT");
    });

    it("reverts on zero shares", async () => {
      await expect(wrapper.stakeETH(refferal, { value: 1n })).to.be.revertedWith("wstETH: can't wrap zero stETH");
    });
  });
});
