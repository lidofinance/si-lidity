import { expect } from "chai";
import { network } from "hardhat";
import type { EthereumProvider } from "hardhat/types/providers";

import type { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import {
  CustomOwner__MockForHubViewer,
  Dashboard,
  DepositContract__MockForStakingVault,
  LidoLocator,
  PredepositGuarantee,
  StakingVault,
  StakingVault__factory,
  StETHPermit__HarnessForDashboard,
  VaultHub__MockForHubViewer,
  VaultViewer,
  WETH9__MockForVault,
  WstETH__HarnessForVault,
} from "typechain-types";

import { ether, findEvents, impersonate } from "lib";

import { deployLidoLocator } from "test-deploy";
import { Snapshot } from "test-utils/suite";

// scope for tests and functions
let ethers: HardhatEthers;
let provider: EthereumProvider;
let snapshot: Snapshot;

const deployVaultDashboard = async (
  vaultImpl: StakingVault,
  dashboardImpl: Dashboard,
  pdgStub: PredepositGuarantee,
  factoryOwner: HardhatEthersSigner,
  vaultOwner: HardhatEthersSigner,
  operator: HardhatEthersSigner,
) => {
  // Dashboard Factory
  const factoryDashboard = await ethers.deployContract("VaultFactory__MockForDashboard", [
    factoryOwner,
    vaultImpl,
    dashboardImpl,
    pdgStub,
  ]);
  expect(await factoryDashboard.owner()).to.equal(factoryOwner);
  expect(await factoryDashboard.implementation()).to.equal(vaultImpl);
  expect(await factoryDashboard.DASHBOARD_IMPL()).to.equal(dashboardImpl);
  expect(await factoryDashboard.PREDEPOSIT_GUARANTEE()).to.equal(pdgStub);

  // Dashboard Vault
  const vaultDashboardCreationTx = await factoryDashboard.connect(vaultOwner).createVault(operator);
  const vaultDashboardCreationReceipt = await vaultDashboardCreationTx.wait();
  if (!vaultDashboardCreationReceipt) throw new Error("Vault creation receipt not found");

  const vaultDashboardCreatedEvents = findEvents(vaultDashboardCreationReceipt, "VaultCreated");
  expect(vaultDashboardCreatedEvents.length).to.equal(1);
  const vaultDashboardAddress = vaultDashboardCreatedEvents[0].args.vault;
  const vaultDashboard = await ethers.getContractAt("StakingVault", vaultDashboardAddress, vaultOwner);

  const dashboardCreatedEvents = findEvents(vaultDashboardCreationReceipt, "DashboardCreated");
  expect(dashboardCreatedEvents.length).to.equal(1);
  const dashboardAddress = dashboardCreatedEvents[0].args.dashboard;
  const dashboard = await ethers.getContractAt("Dashboard", dashboardAddress, vaultOwner);

  return { vaultDashboard, dashboard };
};

const deployCustomOwner = async (
  vaultImpl: StakingVault,
  operator: HardhatEthersSigner,
  pdgStub: PredepositGuarantee,
) => {
  const customOwner = await ethers.deployContract("CustomOwner__MockForHubViewer");
  // deploying factory/beacon
  const factoryStakingVault = await ethers.deployContract("VaultFactory__MockForStakingVault", [
    await vaultImpl.getAddress(),
  ]);
  const vaultCreation = await factoryStakingVault
    .createVault(await customOwner.getAddress(), await operator.getAddress(), await pdgStub.getAddress())
    .then((tx) => tx.wait());
  if (!vaultCreation) throw new Error("Vault creation failed");
  const events = findEvents(vaultCreation, "VaultCreated");
  if (events.length != 1) throw new Error("There should be exactly one VaultCreated event");
  const vaultCreatedEvent = events[0];

  const stakingVault = StakingVault__factory.connect(vaultCreatedEvent.args.vault);
  return { stakingVault, customOwner };
};

const deployStakingVault = async (
  vaultImpl: StakingVault,
  vaultOwner: HardhatEthersSigner,
  operator: HardhatEthersSigner,
  pdgStub: PredepositGuarantee,
) => {
  // deploying factory/beacon
  const factoryStakingVault = await ethers.deployContract("VaultFactory__MockForStakingVault", [
    await vaultImpl.getAddress(),
  ]);

  // deploying beacon proxy
  const vaultCreation = await factoryStakingVault
    .createVault(await vaultOwner.getAddress(), await operator.getAddress(), await pdgStub.getAddress())
    .then((tx) => tx.wait());
  if (!vaultCreation) throw new Error("Vault creation failed");
  const events = findEvents(vaultCreation, "VaultCreated");
  if (events.length != 1) throw new Error("There should be exactly one VaultCreated event");
  const vaultCreatedEvent = events[0];

  const stakingVault = StakingVault__factory.connect(vaultCreatedEvent.args.vault, vaultOwner);
  expect(await stakingVault.owner()).to.equal(await vaultOwner.getAddress());

  return stakingVault;
};

describe("VaultViewer", () => {
  let vaultOwner: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let factoryOwner: HardhatEthersSigner;
  let hubSigner: HardhatEthersSigner;
  let deployerPDG: HardhatEthersSigner;

  let steth: StETHPermit__HarnessForDashboard;
  let weth: WETH9__MockForVault;
  let wsteth: WstETH__HarnessForVault;

  let vaultImpl: StakingVault;
  let dashboardImpl: Dashboard;
  let pdgStub: PredepositGuarantee;

  let locator: LidoLocator;

  let hub: VaultHub__MockForHubViewer;
  let depositContract: DepositContract__MockForStakingVault;
  let stakingVault: StakingVault;
  let vaultDashboard: StakingVault;
  let vaultCustom: StakingVault;
  let vaultViewer: VaultViewer;

  let dashboard: Dashboard;
  let customOwnerContract: CustomOwner__MockForHubViewer;

  let originalState: string;

  before(async () => {
    const connection = await network.connect();
    ethers = connection.ethers;
    provider = connection.provider;

    snapshot = new Snapshot(provider);

    [, vaultOwner, operator, stranger, factoryOwner, deployerPDG] = await ethers.getSigners();

    steth = await ethers.deployContract("StETHPermit__HarnessForDashboard");
    weth = await ethers.deployContract("WETH9__MockForVault");
    wsteth = await ethers.deployContract("WstETH__HarnessForVault", [steth]);

    // PDG
    const GENESIS_FORK_VERSION = "0x00000000";
    const gIFirstValidator = "0x" + "11".padStart(64, "0");
    const gIFirstValidatorAfterChange = "0x" + "22".padStart(64, "0");
    const changeSlot = BigInt(0);
    pdgStub = await ethers.deployContract(
      "PredepositGuarantee",
      [GENESIS_FORK_VERSION, gIFirstValidator, gIFirstValidatorAfterChange, changeSlot],
      [deployerPDG],
    );

    locator = await deployLidoLocator(ethers, {
      lido: steth,
      weth: weth,
      wstETH: wsteth,
      predepositGuarantee: pdgStub,
    });

    hub = await ethers.deployContract("VaultHub__MockForHubViewer", [steth, locator]);

    depositContract = await ethers.deployContract("DepositContract__MockForStakingVault");
    vaultImpl = await ethers.deployContract("StakingVault", [hub, depositContract]);
    expect(await vaultImpl.vaultHub()).to.equal(hub);

    // beacon
    // beacon = await ethers.deployContract("UpgradeableBeacon", [vaultImpl, beaconOwner]);

    dashboardImpl = await ethers.deployContract("Dashboard", [steth, wsteth, hub]);

    // Dashboard controlled vault
    const dashboardResult = await deployVaultDashboard(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      factoryOwner,
      vaultOwner,
      operator,
    );
    vaultDashboard = dashboardResult.vaultDashboard;
    dashboard = dashboardResult.dashboard;

    // EOA controlled vault
    stakingVault = await deployStakingVault(vaultImpl, vaultOwner, operator, pdgStub);

    // Custom owner controlled vault
    const customdResult = await deployCustomOwner(vaultImpl, operator, pdgStub);
    vaultCustom = customdResult.stakingVault;
    customOwnerContract = customdResult.customOwner;

    vaultViewer = await ethers.deployContract("VaultViewer", [hub]);
    expect(await vaultViewer.vaultHub()).to.equal(hub);

    hubSigner = await impersonate(ethers, provider, await hub.getAddress(), ether("100"));
  });

  beforeEach(async () => {
    originalState = await snapshot.take();
  });

  afterEach(async () => {
    await snapshot.restore(originalState);
  });

  context("constructor", () => {
    it("reverts if vault hub is zero address", async () => {
      await expect(ethers.deployContract("VaultViewer", [ethers.ZeroAddress]))
        .to.be.revertedWithCustomError(vaultViewer, "ZeroArgument")
        .withArgs("_vaultHubAddress");
    });
  });

  context("vaultsConnected", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnected();
      expect(vaults.length).to.equal(3);
      expect(vaults[0]).to.equal(vaultDashboard);
      expect(vaults[1]).to.equal(stakingVault);
      expect(vaults[2]).to.equal(vaultCustom);
    });
  });

  // context("getVaultsDataBatch", () => {
  //   beforeEach(async () => {
  //     await hub.connect(hubSigner).mock_connectVault(vaultDelegation.getAddress());
  //     await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
  //     await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
  //     await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
  //   });
  //
  //   it("returns data for a batch of connected vaults", async () => {
  //     const result = await vaultViewer.getVaultsDataBatch(0, 2);
  //
  //     expect(result.length).to.equal(2);
  //     expect(result[0].vault).to.equal(await vaultDelegation.getAddress());
  //     expect(result[1].vault).to.equal(await vaultDashboard.getAddress());
  //
  //     // Sanity check: values are returned and types match
  //     expect(result[0].totalValue).to.be.a("bigint");
  //     expect(result[0].stEthLiability).to.be.a("bigint");
  //     expect(result[0].nodeOperatorFee).to.be.a("bigint");
  //     expect(result[0].lidoTreasuryFee).to.be.a("bigint");
  //   });
  // });

  context("vaultsConnectedBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnectedBound(0, 3);
      expect(vaults[0].length).to.equal(3);
    });

    it("returns all connected vaults in a given range", async () => {
      const vaults = await vaultViewer.vaultsConnectedBound(1, 2);
      expect(vaults[0].length).to.equal(1);
    });

    it("reverts if from is greater than to", async () => {
      await expect(vaultViewer.vaultsConnectedBound(3, 1)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });
  });

  context("vaultsByOwner", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });

    it("returns all vaults owned by a given address", async () => {
      const vaults = await vaultViewer.vaultsByOwner(vaultOwner.getAddress());
      expect(vaults.length).to.equal(2);
      expect(vaults[0]).to.equal(vaultDashboard);
      expect(vaults[1]).to.equal(stakingVault);
    });

    it("returns correct owner for custom vault", async () => {
      const vaults = await vaultViewer.vaultsByOwner(customOwnerContract.getAddress());
      expect(vaults.length).to.equal(1);
      expect(vaults[0]).to.equal(vaultCustom);
    });
  });

  context("vaultsByOwnerBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 3);
      expect(vaults[0].length).to.equal(2);
    });

    it("returns all vaults owned by a given address in a given range - [0, 2]", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 2);
      expect(vaults[0].length).to.equal(2);
    });

    it("returns all vaults owned by a given address in a given range - [1, 3]", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 1, 3);
      expect(vaults[0].length).to.equal(1);
    });

    it("reverts if from is greater than to", async () => {
      await expect(vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 3, 1)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });
  });

  context("vaultsByRole", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });

    it("returns all vaults with a given role on Dashboard", async () => {
      await dashboard.connect(vaultOwner).grantRole(await dashboard.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
      const vaults = await vaultViewer.vaultsByRole(await dashboard.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
      expect(vaults.length).to.equal(1);
      expect(vaults[0]).to.equal(vaultDashboard);
    });
  });

  context("vaultsByRoleBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard.getAddress());
      await hub.connect(hubSigner).mock_connectVault(stakingVault.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultCustom.getAddress());
    });
  });
});
