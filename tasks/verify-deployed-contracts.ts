import path from "node:path";

import { AbiCoder } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import readline from "readline";

import { log } from "lib/log";

// The HardhatVerify haven't been ported to Hardhat 3 yet
// This is a temporary solution until HardhatVerify is migrated to Hardhat 3.
export const verifyDeployedContracts = task(
  "verify:deployed-contracts",
  "Verifies deployed contracts based on state file",
)
  // TODO: contractName as option
  .addOption({
    name: "chainId",
    description: "Chain ID (e.g., 560048)",
    type: ArgumentType.INT,
    defaultValue: 560048,
  })
  .setAction(async ({ chainId }) => {
    const contractName = "VaultViewer";

    try {
      log(`Starting to verify the ${contractName} contract for chainId:`, chainId);

      const deployedFile = path.resolve(`./ignition/deployments/chain-${chainId}/deployed_addresses.json`);
      const journalFile = path.resolve(`./ignition/deployments/chain-${chainId}/journal.jsonl`);
      const artifactFile = path.resolve(
        `./ignition/deployments/chain-${chainId}/artifacts/${contractName}#${contractName}.json`,
      );

      const contractAddress = await getDeployedAddress(contractName, deployedFile);
      const constructorArguments = await getConstructorArgs(contractName, journalFile);
      const buildInfoId = await getBuildInfoId(contractName, artifactFile);
      console.log("contractAddress:", contractAddress);
      console.log("constructorArguments:", constructorArguments);
      console.log("buildInfoId:", buildInfoId);

      log(
        `🔍 Verifying the ${contractName} [buildInfoId: ${buildInfoId}] at ${contractAddress} with args:`,
        constructorArguments,
      );

      await verifyOnEtherscan(chainId, buildInfoId, contractAddress, contractName, constructorArguments);

      // TODO: check status with &action=checkverifystatus

      log("✅ Verification complete!");
    } catch (error) {
      log.error(`Error verifying the ${contractName} contract:`, error);
      throw error;
    }
  })
  .build();

const getDeployedAddress = async (contractName: string, deployedFilePath: string): Promise<string> => {
  const json = JSON.parse(fs.readFileSync(deployedFilePath, "utf-8"));
  const key = `${contractName}#${contractName}`;
  const address = json[key];
  if (!address) throw new Error(`[getDeployedAddress] Contract ${key} not found in ${deployedFilePath}`);
  return address;
};

const getConstructorArgs = async (contractName: string, journalFilePath: string): Promise<unknown[]> => {
  const fileStream = fs.createReadStream(journalFilePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue; // skip empty string

    const entry = JSON.parse(line);
    if (
      entry.type === "DEPLOYMENT_EXECUTION_STATE_INITIALIZE" &&
      entry.contractName === contractName &&
      entry.constructorArgs
    ) {
      return entry.constructorArgs;
    }
  }

  throw new Error(`[getConstructorArgs] Constructor args for ${contractName} not found in ${journalFilePath}`);
};

const getBuildInfoId = async (contractName: string, artifactFilePath: string): Promise<string> => {
  if (!fs.existsSync(artifactFilePath)) {
    throw new Error(`[getBuildInfoId] Artifact not found for contract: ${contractName} in ${artifactFilePath}`);
  }

  const json = JSON.parse(fs.readFileSync(artifactFilePath, "utf-8"));
  const buildInfoId = json.buildInfoId;
  if (!buildInfoId) {
    throw new Error(`[getBuildInfoId] The buildInfoId not found in artifact for contract: ${contractName}`);
  }

  return buildInfoId;
};

const verifyOnEtherscan = async (
  chainId: number,
  buildInfoId: string,
  contractAddress: string,
  contractName: string,
  constructorArguments: string[],
): Promise<void> => {
  const API_URL = "https://api.etherscan.io/api";

  try {
    const buildInfoFilePath = path.resolve(`./ignition/deployments/chain-${chainId}/build-info/${buildInfoId}.json`);

    const jsoned = JSON.parse(fs.readFileSync(buildInfoFilePath, "utf-8"));

    // TODO:
    const abi = new AbiCoder();
    const types = ["address"];
    const abiEncoded = abi.encode(types, constructorArguments);
    const encodedWithout0x = abiEncoded.slice(2); // remove "0x"
    //

    const formData = new FormData();
    formData.append("apikey", process.env.ETHERSCAN_API_KEY);
    formData.append("module", "contract");
    formData.append("action", "verifysourcecode");
    formData.append("chainId", chainId.toString());
    formData.append("codeformat", "solidity-standard-json-input");
    formData.append("contractaddress", contractAddress);
    // TODO
    // "sourceName": "si-contracts/0.8.25/VaultViewer.sol",
    formData.append("contractname", `si-contracts/0.8.25/${contractName}.sol:${contractName}`);
    // https://etherscan.io/solcversions
    formData.append("compilerversion", `v${jsoned.solcLongVersion}`);
    formData.append("constructorArguements", encodedWithout0x);
    formData.append("sourceCode", JSON.stringify(jsoned.input));

    console.log("formData:", formData);

    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
      headers: formData.getHeaders?.(),
    });
    //
    const data = await response.json();
    log("Etherscan response:", data);
  } catch (err) {
    throw new Error(`[verifyOnEtherscan] Error: ${err}`);
  }
};
