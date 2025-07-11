import type { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import { LidoLocator, LidoLocator__factory, OssifiableProxy, OssifiableProxy__factory } from "typechain-types";

import { certainAddress } from "lib";

async function deployDummyLocator(
  ethers: HardhatEthers,
  config?: Partial<LidoLocator.ConfigStruct>,
  deployer?: HardhatEthersSigner,
) {
  if (!deployer) {
    [deployer] = await ethers.getSigners();
  }

  const factory = new LidoLocator__factory(deployer);

  const locator = await factory.deploy({
    accountingOracle: certainAddress("dummy-locator:accountingOracle"),
    burner: certainAddress("dummy-locator:burner"),
    depositSecurityModule: certainAddress("dummy-locator:depositSecurityModule"),
    elRewardsVault: certainAddress("dummy-locator:elRewardsVault"),
    legacyOracle: certainAddress("dummy-locator:legacyOracle"),
    lido: certainAddress("dummy-locator:lido"),
    oracleDaemonConfig: certainAddress("dummy-locator:oracleDaemonConfig"),
    oracleReportSanityChecker: certainAddress("dummy-locator:oracleReportSanityChecker"),
    postTokenRebaseReceiver: certainAddress("dummy-locator:postTokenRebaseReceiver"),
    stakingRouter: certainAddress("dummy-locator:stakingRouter"),
    treasury: certainAddress("dummy-locator:treasury"),
    validatorsExitBusOracle: certainAddress("dummy-locator:validatorsExitBusOracle"),
    withdrawalQueue: certainAddress("dummy-locator:withdrawalQueue"),
    withdrawalVault: certainAddress("dummy-locator:withdrawalVault"),
    accounting: certainAddress("dummy-locator:withdrawalVault"),
    wstETH: certainAddress("dummy-locator:wstETH"),
    vaultHub: certainAddress("dummy-locator:vaultHub"),
    vaultFactory: certainAddress("dummy-locator:vaultFactory"),
    lazyOracle: certainAddress("dummy-locator:lazyOracle"),
    predepositGuarantee: certainAddress("dummy-locator:predepositGuarantee"),
    operatorGrid: certainAddress("dummy-locator:operatorGrid"),
    validatorExitDelayVerifier: certainAddress("dummy-locator:validatorExitDelayVerifier"),
    triggerableWithdrawalsGateway: certainAddress("dummy-locator:triggerableWithdrawalsGateway"),
    ...config,
  });

  return locator as LidoLocator;
}

export async function deployLidoLocator(
  ethers: HardhatEthers,
  config?: Partial<LidoLocator.ConfigStruct>,
  deployer?: HardhatEthersSigner,
) {
  if (!deployer) {
    [deployer] = await ethers.getSigners();
  }

  const locator = await deployDummyLocator(ethers, config, deployer);
  const proxyFactory = new OssifiableProxy__factory(deployer);
  const proxy = await proxyFactory.deploy(await locator.getAddress(), await deployer.getAddress(), new Uint8Array());

  return locator.attach(await proxy.getAddress()) as LidoLocator;
}

async function updateImplementation(
  ethers: HardhatEthers,
  proxyAddress: string,
  config: LidoLocator.ConfigStruct,
  customLocator?: string,
  proxyOwner?: HardhatEthersSigner,
) {
  if (!proxyOwner) {
    [proxyOwner] = await ethers.getSigners();
  }

  const proxyFactory = new OssifiableProxy__factory(proxyOwner);
  const proxy = proxyFactory.attach(proxyAddress) as OssifiableProxy;

  let implementation;
  if (customLocator) {
    const contractFactory = await ethers.getContractFactory(customLocator);
    implementation = await contractFactory.connect(proxyOwner).deploy(config);
  } else {
    implementation = await deployDummyLocator(config, proxyOwner);
  }

  const implementationAddress = await implementation.getAddress();
  await proxy.proxy__upgradeTo(implementationAddress);
}

export async function updateLidoLocatorImplementation(
  ethers: HardhatEthers,
  locatorAddress: string,
  configUpdate = {},
  customLocator?: string,
  admin?: HardhatEthersSigner,
) {
  const config = await getLocatorConfig(locatorAddress);

  Object.assign(config, configUpdate);

  await updateImplementation(locatorAddress, config, customLocator, admin);
}

async function getLocatorConfig(ethers: HardhatEthers, locatorAddress: string) {
  const locator = await ethers.getContractAt("LidoLocator", locatorAddress);

  const addresses = [
    "accountingOracle",
    "depositSecurityModule",
    "elRewardsVault",
    "legacyOracle",
    "lido",
    "oracleReportSanityChecker",
    "postTokenRebaseReceiver",
    "burner",
    "stakingRouter",
    "treasury",
    "validatorsExitBusOracle",
    "withdrawalQueue",
    "withdrawalVault",
    "oracleDaemonConfig",
    "accounting",
    "wstETH",
    "vaultHub",
    "predepositGuarantee",
    "operatorGrid",
  ] as Partial<keyof LidoLocator.ConfigStruct>[];

  const configPromises = addresses.map((name) => locator[name]());

  const config = await Promise.all(configPromises);

  return Object.fromEntries(addresses.map((n, i) => [n, config[i]])) as LidoLocator.ConfigStruct;
}
