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

type STAKING_VAULT_WRAPPER_TYPE = {
  stakingVault: StakingVault;
  dashboard: Dashboard;
  operator: HardhatEthersSigner;
};

// scope for tests and functions
let ethers: HardhatEthers;
let provider: EthereumProvider;
let snapshot: Snapshot;

const deployStakingVault = async (
  vaultImpl: StakingVault,
  dashboardImpl: Dashboard,
  pdgStub: PredepositGuarantee,
  hub: VaultHub__MockForHubViewer,
  hubSigner: HardhatEthersSigner,
  operator: HardhatEthersSigner,
) => {
  // Dashboard Factory
  const factoryDashboard = await ethers.deployContract("VaultFactory__MockForDashboard", [
    hub,
    vaultImpl,
    dashboardImpl,
    pdgStub,
  ]);
  expect(await factoryDashboard.owner()).to.equal(hubSigner);
  expect(await factoryDashboard.implementation()).to.equal(vaultImpl);
  expect(await factoryDashboard.DASHBOARD_IMPL()).to.equal(dashboardImpl);
  expect(await factoryDashboard.PREDEPOSIT_GUARANTEE()).to.equal(pdgStub);

  // Staking vault (only connected vaults)
  const stakingVaultCreationTx = await factoryDashboard.connect(hubSigner).createVault(operator);
  const stakingVaultCreationReceipt = await stakingVaultCreationTx.wait();
  if (!stakingVaultCreationReceipt) throw new Error("Vault creation receipt not found");

  const stakingVaultCreatedEvents = findEvents(stakingVaultCreationReceipt, "VaultCreated");
  expect(stakingVaultCreatedEvents.length).to.equal(1);
  const stakingVaultAddress = stakingVaultCreatedEvents[0].args.vault;
  const stakingVault = await ethers.getContractAt("StakingVault", stakingVaultAddress, hubSigner);

  const dashboardCreatedEvents = findEvents(stakingVaultCreationReceipt, "DashboardCreated");
  expect(dashboardCreatedEvents.length).to.equal(1);
  const dashboardAddress = dashboardCreatedEvents[0].args.dashboard;
  const dashboard = await ethers.getContractAt("Dashboard", dashboardAddress, hubSigner);

  return { stakingVault, dashboard };
};

const deployPDG = async (deployerPDG: HardhatEthersSigner) => {
  // Just stubs
  const genesisForkVersion = "0x00000000";
  const gIFirstValidator = "0x" + "11".padStart(64, "0");
  const gIFirstValidatorAfterChange = "0x" + "22".padStart(64, "0");
  const changeSlot = BigInt(0);
  return await ethers.deployContract(
    "PredepositGuarantee",
    [genesisForkVersion, gIFirstValidator, gIFirstValidatorAfterChange, changeSlot],
    [deployerPDG],
  );
};

const deployStakingVaults = async (
  vaultImpl,
  dashboardImpl,
  pdgStub,
  hub,
  hubSigner,
  operator,
  secondOperator,
  stakingVaultCount: number,
) => {
  const stakingVaults: STAKING_VAULT_WRAPPER_TYPE[] = [];

  for (let i = 0; i < stakingVaultCount; i++) {
    const _operator = i % 2 === 0 ? operator : secondOperator;

    const { stakingVault, dashboard } = await deployStakingVault(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      hub,
      hubSigner,
      _operator,
    );

    stakingVaults.push({ stakingVault, dashboard, operator: _operator });
  }

  return stakingVaults;
};

describe("VaultViewer", () => {
  let operator: HardhatEthersSigner;
  let secondOperator: HardhatEthersSigner;
  let hubSigner: HardhatEthersSigner;
  let deployerPDG: HardhatEthersSigner;

  let steth: StETHPermit__HarnessForDashboard;
  let weth: WETH9__MockForVault;
  let wsteth: WstETH__HarnessForVault;
  let pdgStub: PredepositGuarantee;
  let locator: LidoLocator;
  let hub: VaultHub__MockForHubViewer;
  let dashboardImpl: Dashboard;
  let depositContract: DepositContract__MockForStakingVault;

  let vaultViewer: VaultViewer;
  let vaultImpl: StakingVault;
  let stakingVaults: STAKING_VAULT_WRAPPER_TYPE[] = [];
  const stakingVaultCount = 13; // 13 is the minimum required vaults for this test suite

  let originalState: string;

  before(async () => {
    const connection = await network.connect();
    ethers = connection.ethers;
    provider = connection.provider;
    snapshot = new Snapshot(provider);
    [, operator, secondOperator, deployerPDG] = await ethers.getSigners();

    // All deploys
    steth = await ethers.deployContract("StETHPermit__HarnessForDashboard");
    weth = await ethers.deployContract("WETH9__MockForVault");
    wsteth = await ethers.deployContract("WstETH__HarnessForVault", [steth]);
    pdgStub = await deployPDG(deployerPDG);

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

    vaultViewer = await ethers.deployContract("VaultViewer", [hub]);
    expect(await vaultViewer.VAULT_HUB()).to.equal(hub);

    hubSigner = await impersonate(ethers, provider, await hub.getAddress(), ether("100"));

    stakingVaults = await deployStakingVaults(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      hub,
      hubSigner,
      operator,
      secondOperator,
      stakingVaultCount,
    );
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
        .withArgs("_vaultHub");
    });
  });

  context(`connected vaults (connected vaults count is ${stakingVaultCount})`, () => {
    beforeEach(async () => {
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnected();
      // check counts
      expect(vaults.length).to.equal(stakingVaultCount);
      expect(vaults.length).to.equal(await hub.vaultsCount());
      // check addresses
      expect(vaults[0]).to.equal(stakingVaults[0].stakingVault);
      expect(vaults[1]).to.equal(stakingVaults[1].stakingVault);
      expect(vaults[2]).to.equal(stakingVaults[2].stakingVault);
      expect(vaults[stakingVaultCount - 1]).to.equal(stakingVaults[stakingVaultCount - 1].stakingVault);
    });
  });

  context(`connected vaults bound (connected vaults count is ${stakingVaultCount})`, () => {
    beforeEach(async () => {
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    [
      { from: 0, to: 0 },
      { from: 0, to: 3 },
      { from: 1, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 6 },
      { from: 2, to: 10 },
      { from: 9, to: 14 },
      { from: 12, to: 16 },
      { from: stakingVaultCount, to: stakingVaultCount },
      { from: 0, to: stakingVaultCount },
      { from: 0, to: stakingVaultCount * 10 },
    ].forEach(({ from, to }) => {
      it(`returns all connected vaults in a given range [${from}, ${to}]`, async () => {
        const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(from, to);

        const expectedLength = Math.max(0, Math.min(to, stakingVaultCount) - from);
        expect(vaults.length).to.equal(expectedLength);

        const expectedRemaining = Math.max(0, stakingVaultCount - to);
        expect(totalCount).to.equal(expectedRemaining);
      });
    });

    it("reverts if given range is out of range - [1000, 10000]", async () => {
      await expect(vaultViewer.vaultsConnectedBound(1_000, 10_000)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });

    it("reverts if `from` is greater than `to` [3, 1]", async () => {
      await expect(vaultViewer.vaultsConnectedBound(3, 1)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });
  });

  context(`vaults by owner (vaults count is ${stakingVaultCount})`, () => {
    const vaultSplitIndex = 5;
    let firstBatchOwner: HardhatEthersSigner;
    let secondBatchOwner: HardhatEthersSigner;
    let ownerWithNoVaults: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstBatchOwner, secondBatchOwner, ownerWithNoVaults] = await ethers.getSigners();

      for (let i = 0; i < stakingVaults.length; i++) {
        const { stakingVault } = stakingVaults[i];
        const owner = i < vaultSplitIndex ? firstBatchOwner : secondBatchOwner;

        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), owner);
      }
    });

    it("returns all vaults owned by a given address (firstBatchOwner)", async () => {
      const vaults = await vaultViewer.vaultsByOwner(firstBatchOwner);
      expect(vaults.length).to.equal(vaultSplitIndex);
      for (let i = 0; i < vaultSplitIndex; i++) {
        expect(vaults[i]).to.equal(stakingVaults[i].stakingVault);
      }
    });

    it("returns all vaults owned by a given address (secondBatchOwner)", async () => {
      const vaults = await vaultViewer.vaultsByOwner(secondBatchOwner);
      const expectedCount = stakingVaults.length - vaultSplitIndex;
      expect(vaults.length).to.equal(expectedCount);
      for (let i = 0; i < expectedCount; i++) {
        expect(vaults[i]).to.equal(stakingVaults[vaultSplitIndex + i].stakingVault);
      }
    });

    it("returns zero vaults for an owner with no vaults", async () => {
      const vaults = await vaultViewer.vaultsByOwner(ownerWithNoVaults);
      expect(vaults.length).to.equal(0);
    });
  });

  context("vaults by owner bound", () => {
    const vaultSplitIndex = 7;
    let firstBatchOwner: HardhatEthersSigner;
    let secondBatchOwner: HardhatEthersSigner;
    let ownerWithNoVaults: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstBatchOwner, secondBatchOwner, ownerWithNoVaults] = await ethers.getSigners();

      for (let i = 0; i < stakingVaults.length; i++) {
        const { stakingVault } = stakingVaults[i];
        const owner = i < vaultSplitIndex ? firstBatchOwner : secondBatchOwner;

        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), owner);
      }
    });

    [
      { from: 0, to: 0 },
      { from: 0, to: 3 },
      { from: 1, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 6 },
      { from: vaultSplitIndex, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex * 10 },
    ].forEach(({ from, to }) => {
      it(`returns all vaults owned by a given address (firstBatchOwner) in a given range - [${from}, ${to}]`, async () => {
        const [vaults, leftover] = await vaultViewer.vaultsByOwnerBound(firstBatchOwner, from, to);

        const ownedVaults = stakingVaults.slice(0, vaultSplitIndex); // only vaults owned by firstBatchOwner
        const expectedLength = Math.max(0, Math.min(to, ownedVaults.length) - from);
        const expectedLeftover = Math.max(0, ownedVaults.length - to);

        expect(vaults.length).to.equal(expectedLength);
        expect(leftover).to.equal(expectedLeftover);

        for (let i = 0; i < expectedLength; i++) {
          expect(vaults[i]).to.equal(ownedVaults[from + i].stakingVault);
        }
      });
    });

    [
      { from: 0, to: 0 },
      { from: 0, to: 3 },
      { from: 1, to: 1 },
      { from: 1, to: 2 },
      { from: 3, to: 6 },
      { from: 0, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex * 10 },
    ].forEach(({ from, to }) => {
      it(`returns all vaults owned by a given address (secondBatchOwner) in a given range - [${from}, ${to}]`, async () => {
        const [vaults, leftover] = await vaultViewer.vaultsByOwnerBound(secondBatchOwner, from, to);

        const owned = stakingVaults.slice(vaultSplitIndex); // only vaults owned by secondBatchOwner
        const expectedLength = Math.max(0, Math.min(to, owned.length) - from);
        const expectedLeftover = Math.max(0, owned.length - to);

        expect(vaults.length).to.equal(expectedLength);
        expect(leftover).to.equal(expectedLeftover);

        for (let i = 0; i < expectedLength; i++) {
          expect(vaults[i]).to.equal(owned[from + i].stakingVault);
        }
      });
    });

    [
      { from: 0, to: 0 },
      { from: 0, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex * 10 },
      // for { from: 1 and more } will be WrongPaginationRange
    ].forEach(({ from, to }) => {
      it(`returns zero vaults owned by a given address (ownerWithNoVaults) in a given range - [${from}, ${to}]`, async () => {
        const [vaults, leftover] = await vaultViewer.vaultsByOwnerBound(ownerWithNoVaults, from, to);
        expect(vaults.length).to.equal(0);
        expect(leftover).to.equal(0);
      });
    });

    it(`reverts with WrongPaginationRange [${vaultSplitIndex}, ${vaultSplitIndex}]`, async () => {
      await expect(
        vaultViewer.vaultsByOwnerBound(secondBatchOwner, vaultSplitIndex, vaultSplitIndex),
      ).to.be.revertedWithCustomError(vaultViewer, "WrongPaginationRange");
    });

    it(`reverts with WrongPaginationRange [${stakingVaultCount * 10}, ${stakingVaultCount * 10}]`, async () => {
      await expect(
        vaultViewer.vaultsByOwnerBound(secondBatchOwner, stakingVaultCount * 10, stakingVaultCount * 10),
      ).to.be.revertedWithCustomError(vaultViewer, "WrongPaginationRange");
    });
  });

  context("vaults by role", () => {
    let grantedDefaultAdmin: HardhatEthersSigner;
    let grantedPdgCompensatePredeposit: HardhatEthersSigner;

    beforeEach(async () => {
      [, grantedDefaultAdmin, grantedPdgCompensatePredeposit] = await ethers.getSigners();
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    [
      {
        label: "DEFAULT_ADMIN_ROLE",
        getRole: async (dashboard: Dashboard) => await dashboard.DEFAULT_ADMIN_ROLE(),
        getGrantee: () => grantedDefaultAdmin,
      },
      {
        label: "PDG_COMPENSATE_PREDEPOSIT_ROLE",
        getRole: async () => PDG_COMPENSATE_PREDEPOSIT_ROLE,
        getGrantee: () => grantedPdgCompensatePredeposit,
      },
      // Add more roles here when needed
    ].forEach(({ label, getRole, getGrantee }) => {
      it(`returns all vaults (1) with a given role (${label}) on Dashboard`, async () => {
        const { stakingVault, dashboard } = stakingVaults[0];
        const role = await getRole(dashboard);
        const grantee = getGrantee();

        await dashboard.connect(hubSigner).grantRole(role, grantee.getAddress());
        const vaults = await vaultViewer.vaultsByRole(role, grantee.getAddress());

        expect(vaults.length).to.equal(1);
        expect(vaults[0]).to.equal(stakingVault);
      });
    });

    [
      {
        label: "DEFAULT_ADMIN_ROLE",
        getRole: async (dashboard: Dashboard) => await dashboard.DEFAULT_ADMIN_ROLE(),
        getGrantee: () => grantedDefaultAdmin,
      },
      {
        label: "PDG_COMPENSATE_PREDEPOSIT_ROLE",
        getRole: async () => PDG_COMPENSATE_PREDEPOSIT_ROLE,
        getGrantee: () => grantedPdgCompensatePredeposit,
      },
      // Add more roles here when needed
    ].forEach(({ label, getRole, getGrantee }) => {
      it(`returns all vaults (${stakingVaultCount}) with a given role (${label}) across all dashboards`, async () => {
        const grantee = getGrantee();

        for (const { dashboard } of stakingVaults) {
          const role = await getRole(dashboard);
          await dashboard.connect(hubSigner).grantRole(role, grantee.getAddress());
        }

        const role = await getRole(stakingVaults[0].dashboard);
        const vaults = await vaultViewer.vaultsByRole(role, grantee.getAddress());

        expect(vaults.length).to.equal(stakingVaults.length);
        expect(vaults.length).to.equal(stakingVaultCount);

        for (let i = 0; i < stakingVaults.length; i++) {
          expect(vaults[i]).to.equal(stakingVaults[i].stakingVault);
        }
      });
    });
  });

  context("vaults by role bound", () => {
    const vaultSplitIndex = 7;
    let firstBatchGrantee: HardhatEthersSigner;
    let secondBatchGrantee: HardhatEthersSigner;
    let granteeWithNoRoles: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstBatchGrantee, secondBatchGrantee, granteeWithNoRoles] = await ethers.getSigners();

      for (let i = 0; i < stakingVaults.length; i++) {
        const { stakingVault, dashboard } = stakingVaults[i];

        // Connect vaults to the VaultHub
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await dashboard.getAddress());

        // Grant roles
        const grantee = i < vaultSplitIndex ? firstBatchGrantee : secondBatchGrantee;
        const role = await dashboard.DEFAULT_ADMIN_ROLE();

        await dashboard.connect(hubSigner).grantRole(role, grantee.getAddress());
      }
    });

    const testCases = [
      { label: "firstBatchGrantee", getGrantee: () => firstBatchGrantee, ownedCount: () => vaultSplitIndex },
      {
        label: "secondBatchGrantee",
        getGrantee: () => secondBatchGrantee,
        ownedCount: () => stakingVaults.length - vaultSplitIndex,
      },
      { label: "granteeWithNoRoles", getGrantee: () => granteeWithNoRoles, ownedCount: () => 0 },
    ];

    const ranges = [
      { from: 0, to: 0 },
      { from: 0, to: 3 },
      { from: 0, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex * 10 },
    ];

    testCases.forEach(({ label, getGrantee, ownedCount }) => {
      ranges.forEach(({ from, to }) => {
        it(`returns vaults for ${label} in range [${from}, ${to})`, async () => {
          const grantee = getGrantee();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();

          const [vaults, leftover] = await vaultViewer.vaultsByRoleBound(role, grantee.getAddress(), from, to);

          const expectedLength = Math.max(0, Math.min(to, ownedCount()) - from);
          const expectedLeftover = Math.max(0, ownedCount() - to);

          expect(vaults.length).to.equal(expectedLength);
          expect(leftover).to.equal(expectedLeftover);
        });
      });
    });

    // TODO: add WrongPaginationRange test cases
  });

  context("get vault data", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    it("returns data for one vault with getVaultData", async () => {
      const vaultData = await vaultViewer.getVaultData(await stakingVaults[0].stakingVault.getAddress());

      // Sanity check: values are returned and types match
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFeeRate).to.be.a("bigint");

      // TODO: Value check
    });

    // TODO: more checks, maybe reverts
  });

  context("get vaults data bound", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    // TODO: parameterized tests
    it("returns data for a batch of vaults with getVaultsDataBound [0, 1]", async () => {
      const { vaultsData, leftover } = await vaultViewer.getVaultsDataBound(0, 1);

      expect(vaultsData.length).to.equal(1);
      expect(leftover).to.equal(12);

      expect(vaultsData[0].vaultAddress).to.equal(await stakingVaults[0].stakingVault.getAddress());

      // Sanity check: values are returned and types match
      expect(vaultsData[0].connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultsData[0].connection.infraFeeBP).to.be.a("bigint");
      expect(vaultsData[0].connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultsData[0].record.liabilityShares).to.be.a("bigint");
      expect(vaultsData[0].totalValue).to.be.a("bigint");
      expect(vaultsData[0].liabilityStETH).to.be.a("bigint");
      expect(vaultsData[0].nodeOperatorFeeRate).to.be.a("bigint");

      // TODO: Value check
    });

    // TODO: more checks, maybe reverts
  });

  context("get role members", () => {
    let firstBatchGrantee: HardhatEthersSigner;
    let secondBatchGrantee: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstBatchGrantee, secondBatchGrantee] = await ethers.getSigners();
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    it("returns role members for a single vault", async () => {
      const _stakingVault = stakingVaults[0].stakingVault;
      const _dashboard = stakingVaults[0].dashboard;
      const _operator = stakingVaults[0].operator;

      await _dashboard
        .connect(hubSigner)
        .grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await firstBatchGrantee.getAddress());
      await _dashboard
        .connect(hubSigner)
        .grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await secondBatchGrantee.getAddress());

      const roleMembers = await vaultViewer.getRoleMembers(await _stakingVault.getAddress(), [
        NODE_OPERATOR_MANAGER_ROLE,
        PDG_COMPENSATE_PREDEPOSIT_ROLE,
      ]);

      // The returned tuple is [vault, owner, nodeOperator, members]
      expect(roleMembers.length).to.equal(4);

      // 0: vault
      expect(roleMembers.vault).to.equal(await _stakingVault.getAddress());

      // 1: owner (see: connection.owner)
      expect(roleMembers.owner).to.equal(_dashboard);

      // 2: nodeOperator
      expect(roleMembers.nodeOperator).to.equal(_operator);

      // 3: membersArray => an array of arrays, one per requested role
      const membersArray = roleMembers[3] as string[][];
      expect(membersArray.length).to.equal(2);

      // Role 0 (NODE_OPERATOR_MANAGER_ROLE) should contain only the operator
      expect(membersArray[0].length).to.equal(1);
      expect(membersArray[0][0]).to.equal(_operator);

      // Role 1 (PDG_COMPENSATE_PREDEPOSIT_ROLE) should contain the stranger and secondStranger
      expect(membersArray[1].length).to.equal(2);
      expect(membersArray[1][0]).to.equal(await firstBatchGrantee.getAddress());
      expect(membersArray[1][1]).to.equal(await secondBatchGrantee.getAddress());
    });

    // TODO: more checks, maybe reverts
  });

  context("get role members batch", () => {
    let firstBatchGrantee: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstBatchGrantee] = await ethers.getSigners();
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    it("returns role members for multiple vaults", async () => {
      const _stakingVault = stakingVaults[0].stakingVault;
      const _dashboard = stakingVaults[0].dashboard;

      const _stakingVault2 = stakingVaults[1].stakingVault;
      const _dashboard2 = stakingVaults[1].dashboard;

      await _dashboard
        .connect(hubSigner)
        .grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await firstBatchGrantee.getAddress());

      const membersBatch = await vaultViewer.getRoleMembersBatch(
        [await _stakingVault.getAddress(), await _stakingVault2.getAddress()],
        [NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE],
      );

      expect(membersBatch.length).to.equal(2);
      expect(membersBatch[0].length).to.equal(4);
      expect(membersBatch[1].length).to.equal(4);

      // Staking Vault 1
      expect(membersBatch[0].vault).to.equal(await _stakingVault.getAddress());
      expect(membersBatch[0].owner).to.equal(await _dashboard.getAddress());
      expect(membersBatch[0].nodeOperator).to.equal(await operator.getAddress());
      expect(membersBatch[0].members[0][0]).to.equal(await operator.getAddress());
      expect(membersBatch[0].members[1][0]).to.equal(await firstBatchGrantee.getAddress());

      // Staking Vault 2
      expect(membersBatch[1].vault).to.equal(await _stakingVault2.getAddress());
      expect(membersBatch[1].owner).to.equal(await _dashboard2.getAddress());
      expect(membersBatch[1].nodeOperator).to.equal(await secondOperator.getAddress());
      expect(membersBatch[1].members[0][0]).to.equal(await secondOperator.getAddress());
      // // Staking Vault 2 don't have granted PDG_COMPENSATE_PREDEPOSIT_ROLE
      expect(membersBatch[1].members[1].length).to.equal(0);
    });

    // TODO: more checks, maybe reverts
  });
});
