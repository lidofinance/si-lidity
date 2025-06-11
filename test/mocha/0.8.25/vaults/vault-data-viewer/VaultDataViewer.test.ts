import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";
import type { EthereumProvider } from "hardhat/types/providers";

import type { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import {
  Dashboard,
  DepositContract__MockForStakingVault,
  LidoLocator,
  PredepositGuarantee,
  StakingVault,
  StETHPermit__HarnessForDashboard,
  VaultHub__MockForHubViewer,
  VaultViewer,
  WETH9__MockForVault,
  WstETH__HarnessForVault,
} from "typechain-types";

import { ether, findEvents, impersonate } from "lib";

import { deployLidoLocator } from "test-deploy";
import { Snapshot } from "test-utils/suite";

const NODE_OPERATOR_MANAGER_ROLE = keccak256(toUtf8Bytes("vaults.NodeOperatorFee.NodeOperatorManagerRole"));
const PDG_COMPENSATE_PREDEPOSIT_ROLE = keccak256(toUtf8Bytes("vaults.Permissions.PDGCompensatePredeposit"));

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

describe("VaultViewer", () => {
  let vaultOwner: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  let stranger2: HardhatEthersSigner;
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
  let vaultDashboard1: StakingVault;
  let vaultDashboard2: StakingVault;
  let vaultDashboard3: StakingVault;
  let vaultViewer: VaultViewer;

  let dashboard1: Dashboard;
  // let dashboard2: Dashboard;
  // let dashboard3: Dashboard;

  const vaultDashboardArray: StakingVault[] = [];
  // 3_039_932 gas for 75 vaults
  // 2_020_400 gas for 50 vaults
  const vaultDashboardArrayCount = 75;

  let originalState: string;

  before(async () => {
    const connection = await network.connect();
    ethers = connection.ethers;
    provider = connection.provider;

    snapshot = new Snapshot(provider);

    [, vaultOwner, operator, stranger, factoryOwner, deployerPDG, stranger2] = await ethers.getSigners();

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

    hub = await ethers.deployContract("VaultHub__MockForHubViewer", [locator, steth]);

    depositContract = await ethers.deployContract("DepositContract__MockForStakingVault");
    vaultImpl = await ethers.deployContract("StakingVault", [depositContract]);

    dashboardImpl = await ethers.deployContract("Dashboard", [steth, wsteth, hub, locator]);

    // Dashboard 1 controlled vault
    const dashboard1Result = await deployVaultDashboard(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      factoryOwner,
      vaultOwner,
      operator,
    );
    vaultDashboard1 = dashboard1Result.vaultDashboard;
    dashboard1 = dashboard1Result.dashboard;

    // Dashboard 2 controlled vault
    const dashboard2Result = await deployVaultDashboard(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      factoryOwner,
      vaultOwner, // TODO: vaultOwner2
      operator, // TODO: operator2
    );
    vaultDashboard2 = dashboard2Result.vaultDashboard;
    // dashboard2 = dashboard2Result.dashboard;

    // Dashboard 3 controlled vault
    const dashboard3Result = await deployVaultDashboard(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      factoryOwner,
      vaultOwner, // TODO: vaultOwner3
      operator, // TODO: operator3
    );
    vaultDashboard3 = dashboard3Result.vaultDashboard;
    // dashboard3 = dashboard3Result.dashboard;

    // For "highload" testing
    for (let i = 0; i < vaultDashboardArrayCount; i++) {
      const result = await deployVaultDashboard(vaultImpl, dashboardImpl, pdgStub, factoryOwner, vaultOwner, operator);

      vaultDashboardArray.push(result.vaultDashboard);
    }

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
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnected();
      expect(vaults.length).to.equal(3);
      expect(vaults[0]).to.equal(vaultDashboard1);
      expect(vaults[1]).to.equal(vaultDashboard2);
      expect(vaults[2]).to.equal(vaultDashboard3);
    });
  });

  context("getVaultsDataBound", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns data for a batch of connected vaults with getVaultsDataBound", async () => {
      const vaultsDataBatch = await vaultViewer.getVaultsDataBound(0, 1);

      expect(vaultsDataBatch.length).to.equal(1);
      expect(vaultsDataBatch[0].connection.owner).to.equal(await vaultDashboard1.getAddress());

      // Sanity check: values are returned and types match
      expect(vaultsDataBatch[0].totalValue).to.be.a("bigint");
      expect(vaultsDataBatch[0].connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultsDataBatch[0].record.liabilityShares).to.be.a("bigint");
      expect(vaultsDataBatch[0].liabilityStETH).to.be.a("bigint");
      expect(vaultsDataBatch[0].nodeOperatorFee).to.be.a("bigint");
      expect(vaultsDataBatch[0].connection.infraFeeBP).to.be.a("bigint");
      expect(vaultsDataBatch[0].connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultsDataBatch[0].isOwnerDashboard).to.be.a("boolean");
    });

    it("returns data for one connected vault with getVaultData", async () => {
      const vaultData = await vaultViewer.getVaultData(await vaultDashboard1.getAddress());

      // Sanity check: values are returned and types match
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFee).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.isOwnerDashboard).to.be.a("boolean");
    });

    it(`checks gas estimation for getVaultsDataBound`, async () => {
      const gasEstimate = await ethers.provider.estimateGas({
        to: await vaultViewer.getAddress(),
        data: vaultViewer.interface.encodeFunctionData("getVaultsDataBound", [0, 3]),
      });
      // console.log('gasEstimate:', gasEstimate);
      expect(gasEstimate).to.lte(2_000_000n);
    });
  });

  context("vaultsConnectedBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnectedBound(0, 3);
      expect(vaults[0].length).to.equal(3);
    });

    it(`checks gas estimation for vaultsConnected`, async () => {
      const gasEstimate = await ethers.provider.estimateGas({
        to: await vaultViewer.getAddress(),
        data: vaultViewer.interface.encodeFunctionData("vaultsConnected"),
      });
      // console.log('gasEstimate:', gasEstimate);
      expect(gasEstimate).to.lte(2_000_000n);
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
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all vaults owned by a given address", async () => {
      const vaults = await vaultViewer.vaultsByOwner(vaultOwner.getAddress());
      expect(vaults.length).to.equal(3);
      expect(vaults[0]).to.equal(vaultDashboard1);
      expect(vaults[1]).to.equal(vaultDashboard2);
      expect(vaults[2]).to.equal(vaultDashboard3);
    });
  });

  context("vaultsByOwnerBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 3);
      expect(vaults[0].length).to.equal(3);
    });

    it("returns all vaults owned by a given address in a given range - [0, 2]", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 2);
      expect(vaults[0].length).to.equal(2);
    });

    it("returns all vaults owned by a given address in a given range - [1, 3]", async () => {
      const vaults = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 1, 3);
      expect(vaults[0].length).to.equal(2);
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
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all vaults with a given role on Dashboard", async () => {
      await dashboard1.connect(vaultOwner).grantRole(await dashboard1.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
      const vaults = await vaultViewer.vaultsByRole(await dashboard1.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
      expect(vaults.length).to.equal(1);
      expect(vaults[0]).to.equal(vaultDashboard1);
    });
  });

  context("vaultsByRoleBound", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress());
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress());
    });

    it("returns all vaults with a given role on Dashboard", async () => {
      await dashboard1.connect(vaultOwner).grantRole(await dashboard1.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
      const vaults = await vaultViewer.vaultsByRoleBound(
        await dashboard1.DEFAULT_ADMIN_ROLE(),
        stranger.getAddress(),
        0,
        3,
      );
      expect(vaults[0].length).to.equal(1);
    });
  });

  context("getVaultsDataBound 'highload'", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      for (const vault of vaultDashboardArray) {
        await hub.connect(hubSigner).mock_connectVault(vault.getAddress());
      }
    });

    it("returns data for a batch of connected vaults bounded [0, 50]", async () => {
      const vaultsDataBatch1 = await vaultViewer.getVaultsDataBound(0, 50);
      expect(vaultsDataBatch1.length).to.equal(50);
      expect(vaultsDataBatch1[0].connection.owner).to.equal(await vaultDashboardArray[0].getAddress());
      expect(vaultsDataBatch1[49].connection.owner).to.equal(await vaultDashboardArray[49].getAddress());
    });

    it("returns data for a batch of connected vaults bounded [50, 75]", async () => {
      const vaultsDataBatch3 = await vaultViewer.getVaultsDataBound(50, 75);
      expect(vaultsDataBatch3.length).to.equal(25);
      expect(vaultsDataBatch3[0].connection.owner).to.equal(await vaultDashboardArray[50].getAddress());
    });

    it("returns data for a batch of connected vaults bounded [50, 100]", async () => {
      const vaultsDataBatch3 = await vaultViewer.getVaultsDataBound(50, 100);
      expect(vaultsDataBatch3.length).to.equal(25);
      expect(vaultsDataBatch3[0].connection.owner).to.equal(await vaultDashboardArray[50].getAddress());
    });

    it("returns data for a batch of connected vaults bounded [1000, 0]", async () => {
      const vaultsDataBatch4 = await vaultViewer.getVaultsDataBound(10000, 0);
      expect(vaultsDataBatch4.length).to.equal(0);
    });

    it(`checks gas estimation for getVaultsDataBound`, async () => {
      const gasEstimate = await ethers.provider.estimateGas({
        to: await vaultViewer.getAddress(),
        data: vaultViewer.interface.encodeFunctionData("getVaultsDataBound", [0, vaultDashboardArrayCount]),
      });
      // console.log('gasEstimate:', gasEstimate);
      expect(gasEstimate).to.lte(3_600_000n); // 3_600_000n just for passing this test
    });
  });

  context("getRoleMembers & getRoleMembersBatch", () => {
    beforeEach(async () => {
      await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress());
    });

    it("returns role members for a single vault", async () => {
      const ADMIN_ROLE = await dashboard1.DEFAULT_ADMIN_ROLE();
      // Grant the role
      await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await stranger.getAddress());
      await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await stranger2.getAddress());

      const roleMembers = await vaultViewer.getRoleMembers(await vaultDashboard1.getAddress(), [
        ADMIN_ROLE,
        NODE_OPERATOR_MANAGER_ROLE,
        PDG_COMPENSATE_PREDEPOSIT_ROLE,
      ]);

      // The returned tuple is [owner, nodeOperator, depositor, membersArray]
      expect(roleMembers.length).to.equal(4);

      // 0: owner
      expect(roleMembers[0]).to.equal(await dashboard1.getAddress());

      // 1: nodeOperator
      expect(roleMembers[1]).to.equal(await operator.getAddress());

      // 2: depositor (if set; otherwise you can omit or adjust as needed)
      // expect(roleMembers[2]).to.equal(await someDepositor.getAddress());

      // 3: membersArray => an array of arrays, one per requested role
      const membersArray = roleMembers[3] as string[][];
      expect(membersArray.length).to.equal(3);

      // Role 0 (ADMIN_ROLE) should contain only the vaultOwner
      expect(membersArray[0].length).to.equal(1);
      expect(membersArray[0][0]).to.equal(await vaultOwner.getAddress());

      // Role 1 (NODE_OPERATOR_MANAGER_ROLE) should contain only the operator
      expect(membersArray[1].length).to.equal(1);
      expect(membersArray[1][0]).to.equal(await operator.getAddress());

      // Role 2 (PDG_COMPENSATE_PREDEPOSIT_ROLE) should contain both strangers
      expect(membersArray[2].length).to.equal(2);
      expect(membersArray[2][0]).to.equal(await stranger.getAddress());
      expect(membersArray[2][1]).to.equal(await stranger2.getAddress());
    });

    it("returns role members for multiple vaults", async () => {
      const ADMIN_ROLE = await dashboard1.DEFAULT_ADMIN_ROLE();
      // Grant the role only for vaultDashboard1
      await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await stranger.getAddress());

      const membersBatch = await vaultViewer.getRoleMembersBatch(
        [await vaultDashboard1.getAddress(), await vaultDashboard2.getAddress()],
        [ADMIN_ROLE, NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE],
      );

      // TODO: [owner, nodeOperator, depositor, membersArray]
      expect(membersBatch.length).to.equal(2);
      expect(membersBatch[0].length).to.equal(5);
      expect(membersBatch[1].length).to.equal(5);

      // vaultDashboard1
      expect(membersBatch[0][4][0][0]).to.equal(await vaultOwner.getAddress());
      expect(membersBatch[0][4][1][0]).to.equal(await operator.getAddress());
      expect(membersBatch[0][4][2][0]).to.equal(await stranger.getAddress());

      // vaultDashboard2
      expect(membersBatch[1][4][0][0]).to.equal(await vaultOwner.getAddress());
      expect(membersBatch[1][4][1][0]).to.equal(await operator.getAddress());
      // vaultDashboard2 don't have granted PDG_COMPENSATE_PREDEPOSIT_ROLE
      expect(membersBatch[1][4][2].length).to.equal(0);
    });
  });
});
