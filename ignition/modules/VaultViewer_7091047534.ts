import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VaultViewer", (m) => {
  const vaultViewerContract = m.contract("VaultViewer", [process.env.LIDO_LOCATOR_ADDRESS_7091047534]);

  return { vaultViewerContract };
});
