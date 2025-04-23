import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VaultViewer", (m) => {
  const vaultViewerContract = m.contract("VaultViewer", [process.env.VAULT_HUB_ADDRESS]);

  return { vaultViewerContract };
});
