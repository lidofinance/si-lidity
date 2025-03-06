import { ContractTransactionReceipt, Interface } from "ethers";
import hre from "hardhat";

import { deployScratchProtocol, deployUpgrade, ether, findEventsWithInterfaces, impersonate, log } from "lib";

import { discover } from "./discover";
import { isNonForkingHardhatNetwork } from "./networks";
import { provision } from "./provision";
import { ProtocolContext, ProtocolContextFlags, ProtocolSigners, Signer } from "./types";

const getSigner = async (signer: Signer, balance = ether("100"), signers: ProtocolSigners) => {
  const signerAddress = signers[signer] ?? signer;
  return impersonate(signerAddress, balance);
};

export const getProtocolContext = async (): Promise<ProtocolContext> => {
  if (isNonForkingHardhatNetwork()) {
    await deployScratchProtocol(hre.network.name);
  } else {
    await deployUpgrade(hre.network.name);
  }

  const { contracts, signers } = await discover();
  const interfaces = Object.values(contracts).map((contract) => contract.interface);

  // By default, all flags are "on"
  const flags = {
    onScratch: process.env.INTEGRATION_ON_SCRATCH === "on",
    withCSM: process.env.INTEGRATION_WITH_CSM !== "off",
  } as ProtocolContextFlags;

  log.debug("Protocol context flags", {
    "On scratch": flags.onScratch,
  });

  const context = {
    contracts,
    signers,
    interfaces,
    flags,
    getSigner: async (signer: Signer, balance?: bigint) => getSigner(signer, balance, signers),
    getEvents: (receipt: ContractTransactionReceipt, eventName: string, extraInterfaces: Interface[] = []) =>
      findEventsWithInterfaces(receipt, eventName, [...interfaces, ...extraInterfaces]),
  } as ProtocolContext;

  await provision(context);

  return context;
};
