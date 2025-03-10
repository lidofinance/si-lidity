import { bigintToHex } from "bigint-conversion";
import type { EthereumProvider } from "hardhat/types/providers";

import { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { getNetworkName } from "./network";

export async function impersonate(
  ethers: HardhatEthers,
  provider: EthereumProvider,
  address: string,
  balance?: bigint,
): Promise<HardhatEthersSigner> {
  // TODO: can get from connection
  const networkName = await getNetworkName(provider);

  await provider.send(`${networkName}_impersonateAccount`, [address]);

  if (balance) {
    await updateBalance(provider, address, balance);
  }

  return ethers.getSigner(address);
}

export async function updateBalance(provider: EthereumProvider, address: string, balance: bigint): Promise<void> {
  // TODO: can get from connection
  const networkName = await getNetworkName(provider);

  await provider.send(`${networkName}_setBalance`, [address, "0x" + bigintToHex(balance)]);
}
