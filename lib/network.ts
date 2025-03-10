import type { EthereumProvider } from "hardhat/types/providers";

export async function getNetworkName(provider: EthereumProvider): Promise<string> {
  let clientVersion = await provider.send("web3_clientVersion");

  if (typeof clientVersion !== "string") {
    throw new Error("Failed to retrieve client version!");
  }

  clientVersion = clientVersion.toLowerCase();
  if (clientVersion.includes("hardhat")) return "hardhat";
  if (clientVersion.includes("anvil")) return "anvil";

  throw new Error("Unexpected client!");
}
