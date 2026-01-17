import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("DashboardFactory", (m) => {
  const dashboardFactoryContract = m.contract("DashboardFactory", [process.env.LIDO_LOCATOR_ADDRESS_560048]);

  return { dashboardFactoryContract };
});
