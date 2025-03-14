import fs from "node:fs/promises";
import path from "node:path";

import { task } from "hardhat/config";

import { log, yl } from "lib/log";

const ABI_OUTPUT_PATH = path.resolve(process.cwd(), "abi");
const LIDO_ARTIFACT_PREFIX = "si-contracts/";

const SKIP_NAMES_REGEX = /(Mock|Harness|test_helpers|Imports|deposit_contract|Pausable|.dbg.json|build-info)/;

export const abisExtractTask = task("abis:extract", "Extract ABIs from artifacts")
  .setAction(async (_: unknown, hre) => {
    const artifactNames = await hre.artifacts.getAllFullyQualifiedNames();

    const artifactNamesToPublish = [];
    artifactNames.forEach((name) => {
      if (!SKIP_NAMES_REGEX.test(name) && name.startsWith(LIDO_ARTIFACT_PREFIX)) {
        artifactNamesToPublish.push(name);
      }
    });

    await fs.rm(ABI_OUTPUT_PATH, { recursive: true, force: true });
    await fs.mkdir(ABI_OUTPUT_PATH, { recursive: true });

    for (const name of artifactNamesToPublish) {
      const artifact = await hre.artifacts.readArtifact(name);
      if (artifact.abi && artifact.abi.length > 0) {
        const abiData = JSON.stringify(artifact.abi, null, 2);
        await fs.writeFile(path.join(ABI_OUTPUT_PATH, `${artifact.contractName}.json`), abiData);
        log.success(`ABI for ${yl(artifact.contractName)} has been saved!`);
      }
    }

    log.success("All ABIs have been extracted and saved!");
  })
  .build();
