import path from "node:path";

import { AbiCoder, Interface, type ParamType } from "ethers";
import * as fs from "fs";
import { task } from "hardhat/config";
import { ArgumentType } from "hardhat/types/arguments";
import readline from "readline";

import { log } from "lib/log";

const API_URL = "https://api.etherscan.io/api";

// The HardhatVerify haven't been ported to Hardhat 3 yet
// This is a temporary solution until HardhatVerify is migrated to Hardhat 3.
export const verifyDeployedContracts = task(
  "verify:deployed-contracts",
  "Verifies deployed contracts based on state file",
)
  .addOption({
    name: "contractName",
    description: "Contract name (e.g., VaultViewer)",
    type: ArgumentType.STRING,
    defaultValue: "VaultViewer",
  })
  .addOption({
    name: "chainId",
    description: "Chain ID (e.g., 560048)",
    type: ArgumentType.INT,
    defaultValue: 560048,
  })
  .setAction(async ({ chainId, contractName }) => {
    try {
      log(`🚀 Starting to verify the ${contractName} contract for chainId:`, chainId);

      const deployedFilePath = path.resolve(`./ignition/deployments/chain-${chainId}/deployed_addresses.json`);
      const journalFilePath = path.resolve(`./ignition/deployments/chain-${chainId}/journal.jsonl`);
      const artifactFilePath = path.resolve(
        `./ignition/deployments/chain-${chainId}/artifacts/${contractName}#${contractName}.json`,
      );

      const contractAddress = await getDeployedAddress(contractName as string, deployedFilePath);
      const artifactData = await getArtifactData(contractName as string, artifactFilePath);
      const constructorArguments = (await getConstructorArgs(contractName as string, journalFilePath)) as string[];
      const encodedConstructorArgs = await encodeConstructorArgs(
        contractName as string,
        artifactFilePath,
        constructorArguments,
      );

      log(
        `🔍 Verifying the ${artifactData.inputSourceName} [buildInfoId: ${artifactData.buildInfoId}] at ${contractAddress} with args:`,
        constructorArguments,
      );

      const verificationStatusGuid = await verifyOnEtherscan(
        chainId as number,
        artifactData.buildInfoId,
        contractAddress,
        contractName as string,
        artifactData.inputSourceName,
        encodedConstructorArgs,
      );

      log("⏱ Waiting 5 seconds before checking verification status...");
      await new Promise((resolve) => setTimeout(resolve, 10_000));

      await checkVerificationStatus(verificationStatusGuid);
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

const getArtifactData = async (
  contractName: string,
  artifactFilePath: string,
): Promise<{ buildInfoId: string; inputSourceName: string }> => {
  if (!fs.existsSync(artifactFilePath)) {
    throw new Error(`[getArtifactData] Artifact not found for contract: ${contractName} in ${artifactFilePath}`);
  }

  const jsoned = JSON.parse(fs.readFileSync(artifactFilePath, "utf-8"));

  const buildInfoId = jsoned.buildInfoId;
  if (!buildInfoId) {
    throw new Error(`[getArtifactData] The buildInfoId not found in artifact for contract: ${contractName}`);
  }

  const inputSourceName = jsoned.inputSourceName;
  if (!inputSourceName) {
    throw new Error(`[getArtifactData] The inputSourceName not found in artifact for contract: ${contractName}`);
  }

  return { buildInfoId, inputSourceName };
};

const encodeConstructorArgs = async (
  contractName: string,
  artifactFilePath: string,
  constructorArguments: unknown[],
): Promise<string> => {
  if (!fs.existsSync(artifactFilePath)) {
    throw new Error(`[encodeConstructorArgs] Artifact not found for contract: ${contractName} in ${artifactFilePath}`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactFilePath, "utf-8"));

  const abi = artifact.abi;
  if (!abi) {
    throw new Error(`[encodeConstructorArgs] ABI not found in artifact for ${contractName} in ${artifactFilePath}`);
  }

  const interfaceOfAbi = new Interface(abi);
  const constructor = interfaceOfAbi.deploy;

  if (!constructor || constructor.inputs.length === 0) {
    if (constructorArguments.length > 0) {
      throw new Error(
        `[encodeConstructorArgs] Contract ${contractName} has no constructor args, but some were provided.`,
      );
    }
    return ""; // no args - no encoding
  }

  const types = (constructor.inputs as ParamType[]).map((input) => input.type);

  const abiEncoded = new AbiCoder().encode(types, constructorArguments);
  return abiEncoded.slice(2); // remove "0x"
};

const verifyOnEtherscan = async (
  chainId: number,
  buildInfoId: string,
  contractAddress: string,
  contractName: string,
  contractInputSourceName: string,
  encodedConstructorArgs: string,
): Promise<string> => {
  try {
    const buildInfoFilePath = path.resolve(`./ignition/deployments/chain-${chainId}/build-info/${buildInfoId}.json`);

    const jsoned = JSON.parse(fs.readFileSync(buildInfoFilePath, "utf-8"));

    const formData = new FormData();
    formData.append("apikey", process.env.ETHERSCAN_API_KEY);
    formData.append("module", "contract");
    formData.append("action", "verifysourcecode");
    formData.append("chainId", chainId.toString());
    formData.append("codeformat", "solidity-standard-json-input");
    formData.append("contractaddress", contractAddress);
    // Make as "si-contracts/0.8.25/VaultViewer.sol:VaultViewer"
    formData.append("contractname", `${contractInputSourceName}:${contractName}`);
    // https://etherscan.io/solcversions
    formData.append("compilerversion", `v${jsoned.solcLongVersion}`);
    formData.append("constructorArguements", encodedConstructorArgs);
    formData.append("sourceCode", JSON.stringify(jsoned.input));

    const response = await fetch(API_URL, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!data || data.status === "0") {
      throw Error(`[verifyOnEtherscan] Bad response: ${data}`);
    }

    log("⏳ Etherscan has queued the verification. Response:", data);

    return data.result; // guid for check a verification status
  } catch (err) {
    throw new Error(`[verifyOnEtherscan] Error: ${err}`);
  }
};

const checkVerificationStatus = async (guid: string): Promise<void> => {
  try {
    const params = new URLSearchParams({
      apikey: process.env.ETHERSCAN_API_KEY,
      module: "contract",
      action: "checkverifystatus",
      guid,
    });

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (data.status === "1") {
      log("✅ Verification complete:", data.result);
    } else if (typeof data.result === "string" && data.result.includes("Already Verified")) {
      log("✅ Already verified:", data.result);
    } else if (typeof data.result === "string" && data.result.includes("Pending")) {
      log("⏳ Verification still pending:", data.result);
    } else {
      throw new Error(`[checkVerificationStatus] Failed: ${data.result}`);
    }
  } catch (err) {
    throw new Error(`[checkVerificationStatus] Error: ${err}`);
  }
};
