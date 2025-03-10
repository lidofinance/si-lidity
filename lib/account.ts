import { bigintToHex } from "bigint-conversion";

import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { getNetworkName } from "./network";

export async function impersonate(ethers, provider, address: string, balance?: bigint): Promise<HardhatEthersSigner> {
  const networkName = await getNetworkName(provider);

  await provider.send(`${networkName}_impersonateAccount`, [address]);

  if (balance) {
    await updateBalance(provider, address, balance);
  }

  return ethers.getSigner(address);
}

export async function updateBalance(provider, address: string, balance: bigint): Promise<void> {
  const networkName = await getNetworkName(provider);

  await provider.send(`${networkName}_setBalance`, [address, "0x" + bigintToHex(balance)]);
}
