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
const CHANGE_TIER_ROLE = keccak256(toUtf8Bytes("vaults.Permissions.ChangeTier"));
const WITHDRAW_ROLE = keccak256(toUtf8Bytes("vaults.Permissions.Withdraw"));

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
  // 13 is the minimum required number of vaults for tests,
  // due to hardcoded ranges like { from: 12, to: 16 } used in success cases.
  const stakingVaultCount = 30;
  const gasLimit = 2_000_000n;

  // See the `mock_connectVault` in the `test/mocha/0.8.25/vaults/vault-data-viewer/contracts/VaultHub__MockForHubViewer.sol`
  const expectedVaultsData = {
    connection: {
      forcedRebalanceThresholdBP: 1n,
      infraFeeBP: 1n,
      liquidityFeeBP: 1n,
    },
    record: {
      liabilityShares: 1n,
    },
    totalValue: 10n,
    liabilityStETH: 1n,
    nodeOperatorFeeRate: 0n,
  };

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

    [
      { from: 1_000, to: 10_000 },
      { from: 3, to: 1 },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 10 },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 100 },
      { from: stakingVaultCount * 100, to: stakingVaultCount },
    ].forEach(({ from, to }) => {
      it(`reverts if given range is invalid [${from}, ${to}]`, async () => {
        await expect(vaultViewer.vaultsConnectedBound(from, to)).to.be.revertedWithCustomError(
          vaultViewer,
          "WrongPaginationRange",
        );
      });
    });
  });

  context(`vaults by owner (vaults count is ${stakingVaultCount})`, () => {
    const vaultSplitIndex = Math.ceil(stakingVaultCount / 2);
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
    const vaultSplitIndex = Math.ceil(stakingVaultCount / 3);
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

    [
      { from: stakingVaultCount, to: vaultSplitIndex },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 10 },
    ].forEach(({ from, to }) => {
      it(`reverts with WrongPaginationRange [${from}, ${to}]`, async () => {
        await expect(vaultViewer.vaultsByOwnerBound(secondBatchOwner, from, to)).to.be.revertedWithCustomError(
          vaultViewer,
          "WrongPaginationRange",
        );
      });
    });
  });

  context("vaults by role", () => {
    let grantedDefaultAdmin: HardhatEthersSigner;
    let grantedPdgCompensatePredeposit: HardhatEthersSigner;
    let userWithoutRole: HardhatEthersSigner;

    beforeEach(async () => {
      [, grantedDefaultAdmin, grantedPdgCompensatePredeposit, userWithoutRole] = await ethers.getSigners();
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
      it(`returns all vaults (1) with a given role (${label}) on Dashboard (roles was granted)`, async () => {
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
      it(`returns all vaults (${stakingVaultCount}) with a given role (${label}) across all dashboards (roles was granted)`, async () => {
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

    [
      {
        label: "DEFAULT_ADMIN_ROLE",
        getRole: async (dashboard: Dashboard) => await dashboard.DEFAULT_ADMIN_ROLE(),
        getGrantee: () => userWithoutRole,
      },
      {
        label: "PDG_COMPENSATE_PREDEPOSIT_ROLE",
        getRole: async () => PDG_COMPENSATE_PREDEPOSIT_ROLE,
        getGrantee: () => userWithoutRole,
      },
    ].forEach(({ label, getRole, getGrantee }) => {
      it(`returns zero vaults with a given role (${label}) on Dashboard (roles wasn't granted)`, async () => {
        const grantee = getGrantee();
        const role = await getRole(stakingVaults[0].dashboard);

        const vaults = await vaultViewer.vaultsByRole(role, grantee.getAddress());
        expect(vaults.length).to.equal(0);
      });
    });
  });

  context("vaults by role bound", () => {
    const vaultSplitIndex = Math.ceil(stakingVaultCount / 3);
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

    const successRanges = [
      { from: 0, to: 0 },
      { from: 0, to: 3 },
      { from: 0, to: vaultSplitIndex },
      { from: 0, to: vaultSplitIndex * 10 },
    ];

    testCases.forEach(({ label, getGrantee, ownedCount }) => {
      successRanges.forEach(({ from, to }) => {
        it(`returns vaults for ${label} in range [${from}, ${to}]`, async () => {
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

    const failedRanges = [
      { from: stakingVaultCount, to: vaultSplitIndex },
      { from: stakingVaultCount, to: vaultSplitIndex * 10 },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 10 },
    ];

    testCases.forEach(({ label, getGrantee }) => {
      failedRanges.forEach(({ from, to }) => {
        it(`reverts with WrongPaginationRange for ${label} in range [${from}, ${to}]`, async () => {
          const grantee = getGrantee();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();

          await expect(
            vaultViewer.vaultsByRoleBound(role, grantee.getAddress(), from, to),
          ).to.be.revertedWithCustomError(vaultViewer, "WrongPaginationRange");
        });
      });
    });
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

    it("returns data for first vault with getVaultData", async () => {
      const vaultData = await vaultViewer.getVaultData(await stakingVaults[0].stakingVault.getAddress());

      // Sanity check: values are returned and types match
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFeeRate).to.be.a("bigint");

      // Value check
      expect(vaultData.vaultAddress).to.equal(await stakingVaults[0].stakingVault.getAddress());
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.equal(
        expectedVaultsData.connection.forcedRebalanceThresholdBP,
      );
      expect(vaultData.connection.infraFeeBP).to.equal(expectedVaultsData.connection.infraFeeBP);
      expect(vaultData.connection.liquidityFeeBP).to.equal(expectedVaultsData.connection.liquidityFeeBP);
      expect(vaultData.record.liabilityShares).to.equal(expectedVaultsData.record.liabilityShares);
      expect(vaultData.totalValue).to.equal(expectedVaultsData.totalValue);
      expect(vaultData.liabilityStETH).to.equal(expectedVaultsData.liabilityStETH);
      expect(vaultData.nodeOperatorFeeRate).to.equal(expectedVaultsData.nodeOperatorFeeRate);
    });

    it("returns default values for zero address", async () => {
      const vaultData = await vaultViewer.getVaultData(ethers.ZeroAddress);

      // Sanity check: values are returned and types match
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFeeRate).to.be.a("bigint");

      // Value check
      expect(vaultData.vaultAddress).to.equal(ethers.ZeroAddress);
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.equal(0n);
      expect(vaultData.connection.infraFeeBP).to.equal(0n);
      expect(vaultData.connection.liquidityFeeBP).to.equal(0n);
      expect(vaultData.record.liabilityShares).to.equal(0n);
      expect(vaultData.totalValue).to.equal(0n);
      expect(vaultData.liabilityStETH).to.equal(0n);
      expect(vaultData.nodeOperatorFeeRate).to.equal(0n);
    });
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

    [
      { from: 0, to: 1 },
      { from: 0, to: 2 },
      { from: 1, to: 3 },
      { from: 0, to: stakingVaultCount },
      { from: 2, to: stakingVaultCount },
      { from: stakingVaultCount, to: stakingVaultCount },
    ].forEach(({ from, to }) => {
      it(`returns data for a batch of vaults with getVaultsDataBound [${from}, ${to}]`, async () => {
        const expectedLength = to >= from ? to - from : 0;
        const totalVaults = stakingVaults.length;
        const expectedLeftover = totalVaults > to ? totalVaults - to : 0;

        const { vaultsData, leftover } = await vaultViewer.getVaultsDataBound(from, to);

        expect(vaultsData.length).to.equal(expectedLength);
        expect(leftover).to.equal(expectedLeftover);

        for (let i = 0; i < vaultsData.length; i++) {
          expect(vaultsData[i].vaultAddress).to.equal(await stakingVaults[from + i].stakingVault.getAddress());

          // Sanity check: values are returned and types match
          expect(vaultsData[i].connection.forcedRebalanceThresholdBP).to.be.a("bigint");
          expect(vaultsData[i].connection.infraFeeBP).to.be.a("bigint");
          expect(vaultsData[i].connection.liquidityFeeBP).to.be.a("bigint");
          expect(vaultsData[i].record.liabilityShares).to.be.a("bigint");
          expect(vaultsData[i].totalValue).to.be.a("bigint");
          expect(vaultsData[i].liabilityStETH).to.be.a("bigint");
          expect(vaultsData[i].nodeOperatorFeeRate).to.be.a("bigint");

          // Value check
          expect(vaultsData[i].connection.forcedRebalanceThresholdBP).to.equal(
            expectedVaultsData.connection.forcedRebalanceThresholdBP,
          );
          expect(vaultsData[i].connection.infraFeeBP).to.equal(expectedVaultsData.connection.infraFeeBP);
          expect(vaultsData[i].connection.liquidityFeeBP).to.equal(expectedVaultsData.connection.liquidityFeeBP);
          expect(vaultsData[i].record.liabilityShares).to.equal(expectedVaultsData.record.liabilityShares);
          expect(vaultsData[i].totalValue).to.equal(expectedVaultsData.totalValue);
          expect(vaultsData[i].liabilityStETH).to.equal(expectedVaultsData.liabilityStETH);
          expect(vaultsData[i].nodeOperatorFeeRate).to.equal(expectedVaultsData.nodeOperatorFeeRate);
        }
      });
    });

    [
      { from: stakingVaultCount + 1, to: stakingVaultCount * 10 },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 10 },
      { from: stakingVaultCount * 100, to: stakingVaultCount * 10 },
      { from: stakingVaultCount * 10, to: stakingVaultCount * 100 },
    ].forEach(({ from, to }) => {
      it(`reverts with WrongPaginationRange for invalid range [${from}, ${to}]`, async () => {
        await expect(vaultViewer.getVaultsDataBound(from, to)).to.be.revertedWithCustomError(
          vaultViewer,
          "WrongPaginationRange",
        );
      });
    });
  });

  context("get role members", () => {
    let firstGrantee: HardhatEthersSigner;
    let secondGrantee: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstGrantee, secondGrantee] = await ethers.getSigners();
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    it("returns role members for all staking vaults", async () => {
      for (const { stakingVault, dashboard, operator: _operator } of stakingVaults) {
        const vaultAddress = await stakingVault.getAddress();
        const dashboardAddress = await dashboard.getAddress();
        const operatorAddress = await _operator.getAddress();

        await dashboard.connect(hubSigner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await firstGrantee.getAddress());
        await dashboard.connect(hubSigner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await secondGrantee.getAddress());

        const roleMembers = await vaultViewer.getRoleMembers(vaultAddress, [
          NODE_OPERATOR_MANAGER_ROLE,
          PDG_COMPENSATE_PREDEPOSIT_ROLE,
        ]);

        expect(roleMembers.length).to.equal(4);

        // 0: vault
        expect(roleMembers.vault).to.equal(vaultAddress);

        // 1: owner (dashboard)
        expect(roleMembers.owner).to.equal(dashboardAddress);

        // 2: nodeOperator
        expect(roleMembers.nodeOperator).to.equal(operatorAddress);

        // 3: membersArray — array of arrays
        const membersArray = roleMembers[3] as string[][];
        expect(membersArray.length).to.equal(2);

        // Role 0: NODE_OPERATOR_MANAGER_ROLE
        expect(membersArray[0].length).to.equal(1);
        expect(membersArray[0][0]).to.equal(operatorAddress);

        // Role 1: PDG_COMPENSATE_PREDEPOSIT_ROLE
        expect(membersArray[1].length).to.equal(2);
        expect(membersArray[1][0]).to.equal(await firstGrantee.getAddress());
        expect(membersArray[1][1]).to.equal(await secondGrantee.getAddress());
      }
    });

    it("returns role members for all staking vaults (with role variations)", async () => {
      for (let i = 0; i < stakingVaults.length; i++) {
        const { stakingVault, dashboard, operator: _operator } = stakingVaults[i];
        const vaultAddress = await stakingVault.getAddress();
        const dashboardAddress = await dashboard.getAddress();
        const operatorAddress = await _operator.getAddress();

        const roles = [NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE];

        await dashboard.connect(hubSigner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await firstGrantee.getAddress());
        await dashboard.connect(hubSigner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await secondGrantee.getAddress());

        // From i >= 5 add more roles
        if (i >= 5) {
          roles.push(CHANGE_TIER_ROLE, WITHDRAW_ROLE);

          await dashboard.connect(hubSigner).grantRole(CHANGE_TIER_ROLE, await firstGrantee.getAddress());
          await dashboard.connect(hubSigner).grantRole(WITHDRAW_ROLE, await secondGrantee.getAddress());
        }

        const roleMembers = await vaultViewer.getRoleMembers(vaultAddress, roles);

        expect(roleMembers.length).to.equal(4);

        // 0: vault
        expect(roleMembers.vault).to.equal(vaultAddress);

        // 1: owner (dashboard)
        expect(roleMembers.owner).to.equal(dashboardAddress);

        // 2: nodeOperator
        expect(roleMembers.nodeOperator).to.equal(operatorAddress);

        // 3: membersArray — array of arrays
        const membersArray = roleMembers[3] as string[][];
        expect(membersArray.length).to.equal(roles.length);

        // Check roles
        for (let j = 0; j < roles.length; j++) {
          const role = roles[j];
          const members = membersArray[j];

          if (role === NODE_OPERATOR_MANAGER_ROLE) {
            expect(members.length).to.equal(1);
            expect(members[0]).to.equal(operatorAddress);
          } else if (role === PDG_COMPENSATE_PREDEPOSIT_ROLE) {
            expect(members.length).to.equal(2);
            expect(members).to.include(await firstGrantee.getAddress());
            expect(members).to.include(await secondGrantee.getAddress());
          } else if (role === CHANGE_TIER_ROLE) {
            expect(members).to.include(await firstGrantee.getAddress());
          } else if (role === WITHDRAW_ROLE) {
            expect(members).to.include(await secondGrantee.getAddress());
          }
        }
      }
    });

    it("returns default role members for zero addresses", async () => {
      const zeroAddresses = [ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress];

      for (const vaultAddress of zeroAddresses) {
        const roleMembers = await vaultViewer.getRoleMembers(vaultAddress, [
          NODE_OPERATOR_MANAGER_ROLE,
          PDG_COMPENSATE_PREDEPOSIT_ROLE,
        ]);

        expect(roleMembers.vault).to.equal(ethers.ZeroAddress);
        expect(roleMembers.owner).to.equal(ethers.ZeroAddress);
        expect(roleMembers.nodeOperator).to.equal(ethers.ZeroAddress);

        const membersArray = roleMembers.members;
        expect(membersArray.length).to.equal(2);

        expect(membersArray[0].length).to.equal(0);
        expect(membersArray[1].length).to.equal(0);
      }
    });
  });

  context("get role members batch", () => {
    let firstGrantee: HardhatEthersSigner;

    beforeEach(async () => {
      [, firstGrantee] = await ethers.getSigners();
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    [
      2,
      Math.ceil(stakingVaultCount / 2),
      stakingVaultCount - 1,
      stakingVaultCount,
      // stakingVaultCount is max here
    ].forEach((count) => {
      it(`returns role members for a batch of ${count} vaults`, async () => {
        const roles = [NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE];

        // Grant roles
        for (let i = 0; i < count; i++) {
          await stakingVaults[i].dashboard
            .connect(hubSigner)
            .grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await firstGrantee.getAddress());
        }

        const vaultsSubset = stakingVaults.slice(0, count);

        const vaultAddresses = await Promise.all(vaultsSubset.map(({ stakingVault }) => stakingVault.getAddress()));
        const expectedDashboards = await Promise.all(vaultsSubset.map(({ dashboard }) => dashboard.getAddress()));
        const expectedOperators = await Promise.all(
          vaultsSubset.map(({ operator: _operator }) => _operator.getAddress()),
        );

        const membersBatch = await vaultViewer.getRoleMembersBatch(vaultAddresses, roles);

        expect(membersBatch.length).to.equal(count);

        for (let i = 0; i < count; i++) {
          const entry = membersBatch[i];

          expect(entry.vault).to.equal(vaultAddresses[i]);
          expect(entry.owner).to.equal(expectedDashboards[i]);
          expect(entry.nodeOperator).to.equal(expectedOperators[i]);

          const members = entry.members;
          expect(members.length).to.equal(roles.length);

          // NODE_OPERATOR_MANAGER_ROLE
          expect(members[0].length).to.equal(1);
          expect(members[0][0]).to.equal(expectedOperators[i]);

          // PDG_COMPENSATE_PREDEPOSIT_ROLE
          expect(members[1].length).to.equal(1);
          expect(members[1][0]).to.equal(await firstGrantee.getAddress());
        }
      });
    });
  });

  context(`gas estimation check (connected vaults: ${stakingVaultCount})`, () => {
    const formatWithSpaces = (n: bigint | number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

    let allStakingVaultsOwner: HardhatEthersSigner;

    let someGrantee: HardhatEthersSigner;

    before(async () => {
      [, allStakingVaultsOwner, someGrantee] = await ethers.getSigners();

      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      const ownerAddr = await allStakingVaultsOwner.getAddress();

      for (const { stakingVault } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), ownerAddr);
      }
    });

    const cases = [
      {
        label: "vaultsConnected",
        args: [],
      },
      {
        label: "vaultsConnectedBound",
        args: () => [0, stakingVaultCount],
      },
      {
        label: "vaultsByOwner",
        args: async (owner: string) => [owner],
      },
      {
        label: "vaultsByOwnerBound",
        args: async (owner: string) => [owner, 0, stakingVaultCount],
      },
      {
        label: "getVaultsDataBound",
        args: () => [0, stakingVaultCount],
      },
      {
        label: "vaultsByRoleBound",
        args: async () => {
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();
          return [role, await allStakingVaultsOwner.getAddress(), 0, stakingVaultCount];
        },
      },
    ];

    cases.forEach(({ label, args }) => {
      it(`${label} gas estimation`, async () => {
        const ownerAddr = await allStakingVaultsOwner.getAddress();
        const resolvedArgs = typeof args === "function" ? await args(ownerAddr) : args;

        const gasEstimate = await ethers.provider.estimateGas({
          to: await vaultViewer.getAddress(),
          data: vaultViewer.interface.encodeFunctionData(label, resolvedArgs),
        });

        console.log(`⛽️ ${label} gas estimate (vaults: ${stakingVaultCount}):`);
        console.log(`   ${formatWithSpaces(gasEstimate)}`);
        expect(gasEstimate).to.lte(gasLimit);
      });
    });

    // role grants here do not affect tests above
    it("getRoleMembersBatch gas estimation (with role grants)", async () => {
      const roles = [NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE, CHANGE_TIER_ROLE, WITHDRAW_ROLE];

      for (let i = 0; i < stakingVaults.length; i++) {
        await stakingVaults[i].dashboard
          .connect(hubSigner)
          .grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await someGrantee.getAddress());

        await stakingVaults[i].dashboard.connect(hubSigner).grantRole(CHANGE_TIER_ROLE, await someGrantee.getAddress());

        await stakingVaults[i].dashboard.connect(hubSigner).grantRole(WITHDRAW_ROLE, await someGrantee.getAddress());
      }

      const vaultAddresses = await Promise.all(stakingVaults.map(({ stakingVault }) => stakingVault.getAddress()));

      const gasEstimate = await ethers.provider.estimateGas({
        to: await vaultViewer.getAddress(),
        data: vaultViewer.interface.encodeFunctionData("getRoleMembersBatch", [vaultAddresses, roles]),
      });

      console.log("⛽️ getRoleMembersBatch gas estimate (vaults: %d):", stakingVaultCount);
      console.log("   %s", formatWithSpaces(gasEstimate));
      expect(gasEstimate).to.lte(gasLimit);
    });
  });
});
