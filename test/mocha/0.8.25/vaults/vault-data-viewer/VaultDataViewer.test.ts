import { expect } from "chai";
// import { keccak256, toUtf8Bytes } from "ethers";
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

// const NODE_OPERATOR_MANAGER_ROLE = keccak256(toUtf8Bytes("vaults.NodeOperatorFee.NodeOperatorManagerRole"));
// const PDG_COMPENSATE_PREDEPOSIT_ROLE = keccak256(toUtf8Bytes("vaults.Permissions.PDGCompensatePredeposit"));

// scope for tests and functions
let ethers: HardhatEthers;
let provider: EthereumProvider;
let snapshot: Snapshot;

const deployStakingVault = async (
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

  // Staking vault (only connected vaults)
  const stakingVaultCreationTx = await factoryDashboard.connect(vaultOwner).createVault(operator);
  const stakingVaultCreationReceipt = await stakingVaultCreationTx.wait();
  if (!stakingVaultCreationReceipt) throw new Error("Vault creation receipt not found");

  const stakingVaultCreatedEvents = findEvents(stakingVaultCreationReceipt, "VaultCreated");
  expect(stakingVaultCreatedEvents.length).to.equal(1);
  const stakingVaultAddress = stakingVaultCreatedEvents[0].args.vault;
  const stakingVault = await ethers.getContractAt("StakingVault", stakingVaultAddress, vaultOwner);

  const dashboardCreatedEvents = findEvents(stakingVaultCreationReceipt, "DashboardCreated");
  expect(dashboardCreatedEvents.length).to.equal(1);
  const dashboardAddress = dashboardCreatedEvents[0].args.dashboard;
  const dashboard = await ethers.getContractAt("Dashboard", dashboardAddress, vaultOwner);

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
  factoryOwner,
  vaultOwner,
  secondVaultOwner,
  operator,
  secondOperator,
  stakingVaultCount: number,
) => {
  const stakingVaults: {
    stakingVault: StakingVault;
    dashboard: Dashboard;
    owner: HardhatEthersSigner;
    operator: HardhatEthersSigner;
  }[] = [];

  for (let i = 0; i < stakingVaultCount; i++) {
    const _vaultOwner = i % 2 === 0 ? vaultOwner : secondVaultOwner;
    const _operator = i % 2 === 0 ? operator : secondOperator;

    const { stakingVault, dashboard } = await deployStakingVault(
      vaultImpl,
      dashboardImpl,
      pdgStub,
      factoryOwner,
      _vaultOwner,
      _operator,
    );

    stakingVaults.push({ stakingVault, dashboard, owner: _vaultOwner, operator: _operator });
  }

  return stakingVaults;
};

// const deployStakingVaultsForHL = async (
//   vaultImpl,
//   dashboardImpl,
//   pdgStub,
//   factoryOwner,
//   vaultOwner,
//   operator,
//   stakingVaultHLCount: number,
// ) => {
//   // All staking vaults controlled by Dashboard
//   const stakingVaultsHL = [];
//
//   // For "highload" testing
//   for (let i = 0; i < stakingVaultHLCount; i++) {
//     const { stakingVault } = await deployStakingVault(vaultImpl, dashboardImpl, pdgStub, factoryOwner, vaultOwner, operator);
//     stakingVaultsHL.push(stakingVault);
//   }
//
//   return stakingVaultsHL;
// };

describe("VaultViewer", () => {
  // Owner of any staking vault
  let vaultOwner: HardhatEthersSigner;
  let secondVaultOwner: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let secondOperator: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;
  // let secondStranger: HardhatEthersSigner;
  let factoryOwner: HardhatEthersSigner;
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
  let stakingVaults: {
    stakingVault: StakingVault;
    dashboard: Dashboard;
    owner: HardhatEthersSigner;
    operator: HardhatEthersSigner;
  }[] = [];
  const stakingVaultCount = 3;

  // let stakingVaultsHL: StakingVault[] = [];
  // const stakingVaultHLCount = 75;

  let originalState: string;

  before(async () => {
    const connection = await network.connect();
    ethers = connection.ethers;
    provider = connection.provider;
    snapshot = new Snapshot(provider);
    // [, vaultOwner, secondVaultOwner, operator, secondOperator, stranger, secondStranger, factoryOwner, deployerPDG] = await ethers.getSigners();
    [, vaultOwner, secondVaultOwner, operator, secondOperator, stranger, factoryOwner, deployerPDG] =
      await ethers.getSigners();

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
      factoryOwner,
      vaultOwner,
      secondVaultOwner,
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
      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
      }
    });

    it("returns all connected vaults", async () => {
      const vaults = await vaultViewer.vaultsConnected();
      expect(vaults.length).to.equal(3);
      expect(vaults[0]).to.equal(stakingVaults[0].stakingVault);
      expect(vaults[1]).to.equal(stakingVaults[1].stakingVault);
      expect(vaults[2]).to.equal(stakingVaults[2].stakingVault);
    });
  });

  context(`connected vaults bound (connected vaults count is ${stakingVaultCount})`, () => {
    beforeEach(async () => {
      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
      }
    });

    it("returns all connected vaults in a given range [0, 0]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(0, 0);
      expect(vaults.length).to.equal(0);
      // check the remaining
      expect(totalCount).to.equal(3);
    });

    it("returns all connected vaults in a given range [0, 3]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(0, 3);
      expect(vaults.length).to.equal(3);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("returns all connected vaults in a given range [1, 1]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(1, 1);
      expect(vaults.length).to.equal(0);
      // check the remaining
      expect(totalCount).to.equal(2);
    });

    it("returns all connected vaults in a given range [1, 2]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(1, 2);
      expect(vaults.length).to.equal(1);
      // check the remaining
      expect(totalCount).to.equal(1);
    });

    it("returns all connected vaults in a given range [0, 1000]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsConnectedBound(0, 1000);
      expect(vaults.length).to.equal(3);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("reverts if given range [1000, 10000]", async () => {
      await expect(vaultViewer.vaultsConnectedBound(1_000, 10_000)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });

    it("reverts if from is greater than to [3, 1]", async () => {
      await expect(vaultViewer.vaultsConnectedBound(3, 1)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });
  });

  context("vaults by owner", () => {
    beforeEach(async () => {
      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
      }
    });

    it("returns all vaults owned by a given address 1", async () => {
      // vaultOwner corresponds to the odd-numbered staking vaults: 1, 3, 5...
      const vaults = await vaultViewer.vaultsByOwner(vaultOwner.getAddress());
      expect(vaults.length).to.equal(2);
      expect(vaults[0]).to.equal(stakingVaults[0].stakingVault);
      expect(vaults[1]).to.equal(stakingVaults[2].stakingVault);
    });

    it("returns all vaults owned by a given address 2", async () => {
      // vaultOwner corresponds to the even-numbered staking vaults: 0, 2, 4...
      const vaults = await vaultViewer.vaultsByOwner(secondVaultOwner.getAddress());
      expect(vaults.length).to.equal(1);
      expect(vaults[0]).to.equal(stakingVaults[1].stakingVault);
    });

    it("returns zero vaults", async () => {
      const vaults = await vaultViewer.vaultsByOwner(stranger.getAddress());
      expect(vaults.length).to.equal(0);
    });
  });

  context("vaults by owner bound", () => {
    beforeEach(async () => {
      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
      }
    });

    it("returns all vaults owned by a given address 1 in a given range - [0, 3]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 3);
      expect(vaults.length).to.equal(2);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("returns all vaults owned by a given address 1 in a given range - [0, 1]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 0, 1);
      expect(vaults.length).to.equal(1);
      // check the remaining
      expect(totalCount).to.equal(1);
    });

    it("returns all vaults owned by a given address 1 in a given range - [1, 3]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 1, 3);
      expect(vaults.length).to.equal(1);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("returns all vaults owned by a given address 2 in a given range - [0, 3]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(secondVaultOwner.getAddress(), 0, 3);
      expect(vaults.length).to.equal(1);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("returns all vaults owned by a given address 2 in a given range - [0, 1]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(secondVaultOwner.getAddress(), 0, 1);
      expect(vaults.length).to.equal(1);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    // TODO: check vaultsByOwnerBound
    it("returns all vaults owned by a given address 2 in a given range - [1, 3]", async () => {
      const [vaults, totalCount] = await vaultViewer.vaultsByOwnerBound(secondVaultOwner.getAddress(), 1, 3);
      expect(vaults.length).to.equal(0);
      // check the remaining
      expect(totalCount).to.equal(0);
    });

    it("reverts if given range [1000, 10000]", async () => {
      await expect(
        vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 1_000, 10_000),
      ).to.be.revertedWithCustomError(vaultViewer, "WrongPaginationRange");
    });

    it("reverts if from is greater than to", async () => {
      await expect(vaultViewer.vaultsByOwnerBound(vaultOwner.getAddress(), 3, 1)).to.be.revertedWithCustomError(
        vaultViewer,
        "WrongPaginationRange",
      );
    });
  });

  // context("vaultsByRole", () => {
  //   beforeEach(async () => {
  //     for (const { stakingVault, owner } of stakingVaults) {
  //       await hub.connect(hubSigner).mock_connectVault(
  //         await stakingVault.getAddress(),
  //         await owner.getAddress(),
  //       );
  //     }
  //   });
  //
  //   it("returns all vaults with a given role on Dashboard", async () => {
  //     const _stakingVault = stakingVaults[0].stakingVault;
  //     const _dashboard = stakingVaults[0].dashboard;
  //     const _owner = stakingVaults[0].owner;
  //
  //     await _dashboard.connect(_owner).grantRole(await _dashboard.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
  //     const vaults = await vaultViewer.vaultsByRole(await _dashboard.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
  //
  //     console.log('vaults:', vaults);
  //     expect(vaults.length).to.equal(1);
  //     expect(vaults[0]).to.equal(_stakingVault);
  //   });
  // });

  // context("vaultsByRoleBound", () => {
  //   beforeEach(async () => {
  //     await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress(), vaultOwner.getAddress());
  //     await hub.connect(hubSigner).mock_connectVault(vaultDashboard2.getAddress(), vaultOwner.getAddress());
  //     await hub.connect(hubSigner).mock_connectVault(vaultDashboard3.getAddress(), vaultOwner.getAddress());
  //   });
  //
  //   it("returns all vaults with a given role on Dashboard", async () => {
  //     await dashboard1.connect(vaultOwner).grantRole(await dashboard1.DEFAULT_ADMIN_ROLE(), stranger.getAddress());
  //     const vaults = await vaultViewer.vaultsByRoleBound(
  //       await dashboard1.DEFAULT_ADMIN_ROLE(),
  //       stranger.getAddress(),
  //       0,
  //       3,
  //     );
  //     expect(vaults[0].length).to.equal(1);
  //   });
  // });

  context("get vault data", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
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
  });

  context("get vaults data bound", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      for (const { stakingVault, owner } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), await owner.getAddress());
      }
    });

    it("returns data for a batch of vaults with getVaultsDataBound [0, 1]", async () => {
      const { vaultsData, leftover } = await vaultViewer.getVaultsDataBound(0, 1);

      expect(vaultsData.length).to.equal(1);
      expect(leftover).to.equal(2);

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
  });
  //
  //
  // context("getVaultsDataBound 'highload'", () => {
  //   beforeEach(async () => {
  //     await steth.mock__setTotalPooledEther(100n);
  //     await steth.mock__setTotalShares(100n);
  //
  //     for (const vault of vaultDashboardArray) {
  //       await hub.connect(hubSigner).mock_connectVault(vault.getAddress(), vaultOwner.getAddress());
  //     }
  //   });
  //
  //   it("returns data for a batch of connected vaults bounded [0, 50]", async () => {
  //     const vaultsDataBatch1 = await vaultViewer.getVaultsDataBound(0, 50);
  //     expect(vaultsDataBatch1.length).to.equal(50);
  //     expect(vaultsDataBatch1[0].vaultAddress).to.equal(await vaultDashboardArray[0].getAddress());
  //     expect(vaultsDataBatch1[49].vaultAddress).to.equal(await vaultDashboardArray[49].getAddress());
  //   });
  //
  //   it("returns data for a batch of connected vaults bounded [50, 75]", async () => {
  //     const vaultsDataBatch3 = await vaultViewer.getVaultsDataBound(50, 75);
  //     expect(vaultsDataBatch3.length).to.equal(25);
  //     expect(vaultsDataBatch3[0].vaultAddress).to.equal(await vaultDashboardArray[50].getAddress());
  //   });
  //
  //   it("returns data for a batch of connected vaults bounded [50, 100]", async () => {
  //     const vaultsDataBatch3 = await vaultViewer.getVaultsDataBound(50, 100);
  //     expect(vaultsDataBatch3.length).to.equal(25);
  //     expect(vaultsDataBatch3[0].vaultAddress).to.equal(await vaultDashboardArray[50].getAddress());
  //   });
  //
  //   it("returns data for a batch of connected vaults bounded [1000, 0]", async () => {
  //     const vaultsDataBatch4 = await vaultViewer.getVaultsDataBound(10000, 0);
  //     expect(vaultsDataBatch4.length).to.equal(0);
  //   });
  //
  //   it(`checks gas estimation for getVaultsDataBound`, async () => {
  //     const gasEstimate = await ethers.provider.estimateGas({
  //       to: await vaultViewer.getAddress(),
  //       data: vaultViewer.interface.encodeFunctionData("getVaultsDataBound", [0, vaultDashboardArrayCount]),
  //     });
  //     // console.log('gasEstimate:', gasEstimate);
  //     expect(gasEstimate).to.lte(3_600_000n); // 3_600_000n just for passing this test
  //   });
  // });
  //
  // context("getRoleMembers & getRoleMembersBatch", () => {
  //   beforeEach(async () => {
  //     await hub.connect(hubSigner).mock_connectVault(vaultDashboard1.getAddress(), vaultOwner.getAddress());
  //   });
  //
  //   it("returns role members for a single vault", async () => {
  //     const ADMIN_ROLE = await dashboard1.DEFAULT_ADMIN_ROLE();
  //     await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await stranger.getAddress());
  //     await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await secondStranger.getAddress());
  //
  //     const roleMembers = await vaultViewer.getRoleMembers(await vaultDashboard1.getAddress(), [
  //       ADMIN_ROLE,
  //       NODE_OPERATOR_MANAGER_ROLE,
  //       PDG_COMPENSATE_PREDEPOSIT_ROLE,
  //     ]);
  //
  //     // The returned tuple is [owner, nodeOperator, depositor, membersArray]
  //     expect(roleMembers.length).to.equal(4);
  //
  //     // 0: owner
  //     expect(roleMembers[0]).to.equal(await vaultOwner.getAddress());
  //
  //     // 1: nodeOperator
  //     expect(roleMembers[1]).to.equal(await operator.getAddress());
  //
  //     // 2: depositor (if set; otherwise you can omit or adjust as needed)
  //     // expect(roleMembers[2]).to.equal(await someDepositor.getAddress());
  //
  //     // 3: membersArray => an array of arrays, one per requested role
  //     const membersArray = roleMembers[3] as string[][];
  //     expect(membersArray.length).to.equal(3);
  //
  //     // Role 0 (ADMIN_ROLE) should contain only the vaultOwner
  //     expect(membersArray[0].length).to.equal(1);
  //     expect(membersArray[0][0]).to.equal(await vaultOwner.getAddress());
  //
  //     // Role 1 (NODE_OPERATOR_MANAGER_ROLE) should contain only the operator
  //     expect(membersArray[1].length).to.equal(1);
  //     expect(membersArray[1][0]).to.equal(await operator.getAddress());
  //
  //     // Role 2 (PDG_COMPENSATE_PREDEPOSIT_ROLE) should contain both strangers
  //     expect(membersArray[2].length).to.equal(2);
  //     expect(membersArray[2][0]).to.equal(await stranger.getAddress());
  //     expect(membersArray[2][1]).to.equal(await secondStranger.getAddress());
  //   });
  //
  //   it("returns role members for multiple vaults", async () => {
  //     const ADMIN_ROLE = await dashboard1.DEFAULT_ADMIN_ROLE();
  //     // Grant the role only for vaultDashboard1
  //     await dashboard1.connect(vaultOwner).grantRole(PDG_COMPENSATE_PREDEPOSIT_ROLE, await stranger.getAddress());
  //
  //     const membersBatch = await vaultViewer.getRoleMembersBatch(
  //       [await vaultDashboard1.getAddress(), await vaultDashboard2.getAddress()],
  //       [ADMIN_ROLE, NODE_OPERATOR_MANAGER_ROLE, PDG_COMPENSATE_PREDEPOSIT_ROLE],
  //     );
  //
  //     expect(membersBatch.length).to.equal(2);
  //     expect(membersBatch[0].length).to.equal(5);
  //     expect(membersBatch[1].length).to.equal(5);
  //
  //     // vaultDashboard1
  //     expect(membersBatch[0][4][0][0]).to.equal(await vaultOwner.getAddress());
  //     expect(membersBatch[0][4][1][0]).to.equal(await operator.getAddress());
  //     expect(membersBatch[0][4][2][0]).to.equal(await stranger.getAddress());
  //
  //     // vaultDashboard2
  //     expect(membersBatch[1][4][0][0]).to.equal(await vaultOwner.getAddress());
  //     expect(membersBatch[1][4][1][0]).to.equal(await operator.getAddress());
  //     // vaultDashboard2 don't have granted PDG_COMPENSATE_PREDEPOSIT_ROLE
  //     expect(membersBatch[1][4][2].length).to.equal(0);
  //   });
  // });
});
