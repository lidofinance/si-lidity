import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("WstETHReferralStaker", (m) => {
  const wstETHReferralStakerContract = m.contract("WstETHReferralStaker", [process.env.WSTETH_ADDRESS_32382]);

  return { wstETHReferralStakerContract };
});
