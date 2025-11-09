import { expect } from "chai";
import { keccak256, toUtf8Bytes } from "ethers";
import { network } from "hardhat";
import type { EthereumProvider } from "hardhat/types/providers";

import type { HardhatEthers, HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

import {
  Dashboard,
  DepositContract__MockForStakingVault,
  LazyOracle__MockForHubViewer,
  LidoLocator,
  PredepositGuarantee,
  StakingVault,
  StETHPermit__HarnessForDashboard,
  VaultHub__MockForHubViewer,
  VaultViewer,
  WETH9__MockForVault,
  WstETH__Harness,
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
  vaultImpl: StakingVault,
  dashboardImpl: Dashboard,
  pdgStub: PredepositGuarantee,
  hub: VaultHub__MockForHubViewer,
  hubSigner: HardhatEthersSigner,
  operator: HardhatEthersSigner,
  secondOperator: HardhatEthersSigner,
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
  let wsteth: WstETH__Harness;
  let pdgStub: PredepositGuarantee;
  let locator: LidoLocator;
  let hub: VaultHub__MockForHubViewer;
  let lazyOracle: LazyOracle__MockForHubViewer;
  let dashboardImpl: Dashboard;
  let depositContract: DepositContract__MockForStakingVault;

  let vaultViewer: VaultViewer;
  let vaultImpl: StakingVault;
  let stakingVaults: STAKING_VAULT_WRAPPER_TYPE[] = [];
  // 3 is the minimum required number of vaults for tests.
  const stakingVaultCount = 30;
  const gasLimit = 500_000_000n; // Alchemy view gas limit is 550 million, DRPC view gas limit is 600 million

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
    totalValue: 9n,
    liabilityStETH: 1n,
    nodeOperatorFeeRate: 0n,
    isReportFresh: true,
    quarantineInfo: {
      isActive: false,
      pendingTotalValueIncrease: 0n,
      startTimestamp: 0n,
      endTimestamp: 0n,
      totalValueRemainder: 0n,
    },
  };

  const quarantinePeriod = 10_000_000n;
  const startTimestampMs = BigInt(Date.now());
  const mockVaultToQuarantineExpectedData = {
    isActive: true,
    pendingTotalValueIncrease: 100n,
    startTimestamp: startTimestampMs,
    endTimestamp: startTimestampMs + quarantinePeriod,
    totalValueRemainder: 1n,
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
    wsteth = await ethers.deployContract("WstETH__Harness", [steth]);
    pdgStub = await deployPDG(deployerPDG);

    lazyOracle = await ethers.deployContract("LazyOracle__MockForHubViewer", [quarantinePeriod]);

    hub = await ethers.deployContract("VaultHub__MockForHubViewer", [steth]);

    locator = await deployLidoLocator(ethers, {
      lido: steth,
      weth: weth,
      wstETH: wsteth,
      predepositGuarantee: pdgStub,
      lazyOracle: lazyOracle,
      vaultHub: hub,
    });

    depositContract = await ethers.deployContract("DepositContract__MockForStakingVault");
    vaultImpl = await ethers.deployContract("StakingVault", [depositContract]);
    dashboardImpl = await ethers.deployContract("Dashboard", [steth, wsteth, hub, locator]);

    vaultViewer = await ethers.deployContract("VaultViewer", [locator]);
    expect(await vaultViewer.VAULT_HUB()).to.equal(hub);
    expect(await vaultViewer.LIDO_LOCATOR()).to.equal(locator);
    expect(await vaultViewer.LAZY_ORACLE()).to.equal(lazyOracle);

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
        .withArgs("_lidoLocator");
    });
  });

  context(`vault addresses bound`, () => {
    beforeEach(async () => {
      for (const { stakingVault, dashboard } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(
          await stakingVault.getAddress(),
          // dashboard is owner of staking vault
          await dashboard.getAddress(),
        );
      }
    });

    // [
    //   { from: 1, to: 1 },
    //   { from: 1, to: 2 },
    //   { from: 2, to: 3 },
    //   { from: 1, to: stakingVaultCount },
    //   { from: 3, to: stakingVaultCount },
    //   { from: stakingVaultCount, to: stakingVaultCount },
    //   { from: 1, to: stakingVaultCount }, // All
    //   { from: 1, to: stakingVaultCount + 1 }, // more that all
    //   { from: 1, to: stakingVaultCount + stakingVaultCount }, // more that all
    // ].forEach(({ from, to }) => {
    //   it(`returns vault contracts in a given range [${from}, ${to}]`, async () => {
    //     const [vaults, leftover] = await vaultViewer.vaultAddressesBound(from, to);
    //
    //     const safeTo = Math.min(to, stakingVaultCount);
    //     const expectedLength = from > safeTo ? 0 : safeTo - from + 1;
    //     expect(vaults.length).to.equal(expectedLength);
    //
    //     const expectedLeftover = Math.max(0, stakingVaultCount - safeTo);
    //     expect(leftover).to.equal(expectedLeftover);
    //   });
    // });

    // [
    //   { from: 1_000, to: 10_000 },
    //   { from: 3, to: 1 },
    //   { from: stakingVaultCount, to: 1 },
    //   { from: stakingVaultCount * 10, to: stakingVaultCount * 10 },
    //   { from: stakingVaultCount * 10, to: stakingVaultCount * 100 },
    //   { from: stakingVaultCount * 100, to: stakingVaultCount },
    // ].forEach(({ from, to }) => {
    //   it(`reverts if given range is invalid [${from}, ${to}]`, async () => {
    //     await expect(vaultViewer.vaultAddressesBound(from, to)).to.be.revertedWithCustomError(
    //       vaultViewer,
    //       "WrongPaginationRange",
    //     );
    //   });
    // });

    //   [
    //     { from: 0, to: 0 },
    //     { from: 0, to: 1 },
    //     { from: 0, to: 2 },
    //     { from: stakingVaultCount, to: 0 },
    //   ].forEach(({ from, to }) => {
    //     it(`reverts with ZeroArgument for invalid range [${from}, ${to}]`, async () => {
    //       await expect(vaultViewer.vaultAddressesBound(from, to)).to.be.revertedWithCustomError(
    //         vaultViewer,
    //         "ZeroArgument",
    //       );
    //     });
    //   });
  });

  context("vaults by owner", () => {
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

    const ownersTestCases = [
      { label: "firstBatchOwner", getOwner: () => firstBatchOwner },
      { label: "secondBatchOwner", getOwner: () => secondBatchOwner },
    ];

    ownersTestCases.forEach(({ label, getOwner }) => {
      [
        { cursor: 1, limit: 1 },
        { cursor: 1, limit: 2 },
        { cursor: 3, limit: 6 },
        { cursor: vaultSplitIndex, limit: vaultSplitIndex },
        { cursor: 1, limit: vaultSplitIndex },
      ].forEach(({ cursor, limit }) => {
        it(`returns all vaults owned by a given address ${label} where cursor=${cursor}, limit=${limit}`, async () => {
          const owner = getOwner();
          const [vaults, nextCursor] = await vaultViewer.vaultsByOwner(owner, cursor, limit);

          const total = stakingVaults.length;
          const remaining = total - cursor + 1;
          const maxScan = Math.min(limit, Math.max(remaining, 0));

          const expectedVaults: string[] = [];
          for (let gi = cursor; gi <= total && gi < cursor + maxScan; gi++) {
            // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
            const idx = gi - 1;
            const { stakingVault } = stakingVaults[idx];
            const ownerAtGi = idx < vaultSplitIndex ? firstBatchOwner : secondBatchOwner;
            if (ownerAtGi.address === owner.address) {
              expectedVaults.push(await stakingVault.getAddress());
            }
          }

          // ✅ Check vaults
          expect(vaults.length).to.equal(expectedVaults.length);
          for (let i = 0; i < expectedVaults.length; i++) {
            expect(vaults[i]).to.equal(expectedVaults[i]);
          }

          // ✅ Check nextCursor
          const expectedNextCursor = cursor + maxScan <= total ? BigInt(cursor + maxScan) : 0;
          expect(nextCursor).to.equal(expectedNextCursor);
        });
      });
    });

    [
      { cursor: 1, limit: 1 },
      { cursor: 1, limit: 2 },
      { cursor: 1, limit: vaultSplitIndex },
      { cursor: 1, limit: vaultSplitIndex * 10 },
    ].forEach(({ cursor, limit }) => {
      it(`returns zero vaults owned by a given address (ownerWithNoVaults) where cursor=${cursor}, limit=${limit}`, async () => {
        const [vaults, nextCursor] = await vaultViewer.vaultsByOwner(ownerWithNoVaults, cursor, limit);

        const total = stakingVaults.length;
        const remaining = total - cursor + 1;
        const maxScan = Math.min(limit, Math.max(remaining, 0));

        // ✅ Check vaults
        expect(vaults.length).to.equal(0);

        // ✅ Check nextCursor
        const expectedNextCursor = cursor + maxScan <= total ? BigInt(cursor + maxScan) : 0n;
        expect(nextCursor).to.equal(expectedNextCursor);
      });
    });

    [
      { cursor: stakingVaultCount + 1, limit: 2 },
      { cursor: stakingVaultCount * 10, limit: stakingVaultCount * 10 },
    ].forEach(({ cursor, limit }) => {
      it(`reverts with WrongCursorPagination where cursor=${cursor}, limit=${limit}`, async () => {
        await expect(vaultViewer.vaultsByOwner(secondBatchOwner, cursor, limit)).to.be.revertedWithCustomError(
          vaultViewer,
          "WrongCursorPagination",
        );
      });
    });

    [
      { cursor: 0, limit: 0 },
      { cursor: 0, limit: 2 },
      { cursor: 2, limit: 0 },
    ].forEach(({ cursor, limit }) => {
      it(`reverts with ZeroArgument where cursor=${cursor}, limit=${limit}`, async () => {
        await expect(vaultViewer.vaultsByOwner(secondBatchOwner, cursor, limit)).to.be.revertedWithCustomError(
          vaultViewer,
          "ZeroArgument",
        );
      });
    });

    ownersTestCases.forEach(({ label, getOwner }) => {
      [
        { cursor: 1, limit: 1 },
        { cursor: 1, limit: 2 },
        { cursor: 1, limit: 3 },
        { cursor: 1, limit: stakingVaultCount },
      ].forEach(({ cursor, limit }) => {
        it(`walks all pages(cursor=${cursor}, limit=${limit}) for ${label} via nextCursor and returns exactly his vaults in order`, async () => {
          const maxIters = 100;
          const collected: string[] = [];

          const owner = getOwner();

          for (let i = 0; i < maxIters; i++) {
            const [page, nextCursor] = await vaultViewer.vaultsByOwner(owner, cursor, limit);
            collected.push(...page);

            if (nextCursor === 0n) break;
            cursor = Number(nextCursor);
          }

          const expected: string[] = [];
          for (let gi = 1; gi <= stakingVaults.length; gi++) {
            // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
            const idx = gi - 1;
            const { stakingVault } = stakingVaults[idx];
            const ownerAtGi = idx < vaultSplitIndex ? firstBatchOwner : secondBatchOwner;
            if (ownerAtGi.address === owner.address) {
              expected.push(await stakingVault.getAddress());
            }
          }

          expect(collected).to.deep.equal(expected);
        });
      });
    });
  });

  context("vaults by role", () => {
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

    const granteesTestCases = [
      { label: "firstBatchGrantee", getGrantee: () => firstBatchGrantee },
      { label: "secondBatchGrantee", getGrantee: () => secondBatchGrantee },
      { label: "granteeWithNoRoles", getGrantee: () => granteeWithNoRoles },
    ];

    const successRanges = [
      { cursor: 1, limit: 1 },
      { cursor: 1, limit: 2 },
      { cursor: 3, limit: 6 },
      { cursor: vaultSplitIndex, limit: vaultSplitIndex },
    ];

    granteesTestCases.forEach(({ label, getGrantee }) => {
      successRanges.forEach(({ cursor, limit }) => {
        it(`returns vaults for ${label} where cursor=${cursor}, limit=${limit}`, async () => {
          const grantee = getGrantee();
          const granteeAddr = await grantee.getAddress();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();

          const [vaults, nextCursor] = await vaultViewer.vaultsByRole(role, granteeAddr, cursor, limit);

          const total = stakingVaults.length;
          const remaining = total - cursor + 1;
          const scan = Math.min(limit, Math.max(remaining, 0));

          let expectedCount = 0;
          for (let gi = cursor; gi <= total && gi < cursor + scan; gi++) {
            // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
            const idx = gi - 1;
            const grantedTo = idx < vaultSplitIndex ? firstBatchGrantee : secondBatchGrantee;
            const grantedAddr = await grantedTo.getAddress();
            if (granteeAddr === grantedAddr) expectedCount++;
          }

          // ✅ Check vaults count
          expect(vaults.length).to.equal(expectedCount);

          // ✅ Check nextCursor
          const expectedNextCursor = cursor + scan <= total ? BigInt(cursor + scan) : 0n;
          expect(nextCursor).to.equal(expectedNextCursor);
        });
      });
    });

    granteesTestCases.forEach(({ label, getGrantee }) => {
      const failedRanges = [
        { cursor: 0, limit: 0 },
        { cursor: 0, limit: 3 },
        { cursor: 0, limit: vaultSplitIndex },
        { cursor: 0, limit: vaultSplitIndex * 10 },
      ];

      failedRanges.forEach(({ cursor, limit }) => {
        it(`reverts with ZeroArgument for ${label} where cursor=${cursor}, limit=${limit}`, async () => {
          const grantee = getGrantee();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();
          await expect(
            vaultViewer.vaultsByRole(role, grantee.getAddress(), cursor, limit),
          ).to.be.revertedWithCustomError(vaultViewer, "ZeroArgument");
        });
      });
    });

    granteesTestCases.forEach(({ label, getGrantee }) => {
      const failedRanges = [
        { cursor: stakingVaultCount + 1, limit: 2 },
        { cursor: stakingVaultCount * 10, limit: stakingVaultCount * 10 },
      ];

      failedRanges.forEach(({ cursor, limit }) => {
        it(`reverts with WrongCursorPagination for ${label} where cursor=${cursor}, limit=${limit}`, async () => {
          const grantee = getGrantee();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();
          await expect(
            vaultViewer.vaultsByRole(role, grantee.getAddress(), cursor, limit),
          ).to.be.revertedWithCustomError(vaultViewer, "WrongCursorPagination");
        });
      });
    });

    granteesTestCases.forEach(({ label, getGrantee }) => {
      [
        { cursor: 1, limit: 1 },
        { cursor: 1, limit: 2 },
        { cursor: 1, limit: 3 },
        { cursor: 1, limit: stakingVaultCount },
      ].forEach(({ cursor, limit }) => {
        it(`walks all pages(cursor=${cursor}, limit=${limit}) for ${label} via nextCursor and returns exactly matching vaults in order`, async () => {
          const maxIters = 100;
          const collected: string[] = [];

          const grantee = getGrantee();
          const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();

          for (let i = 0; i < maxIters; i++) {
            const [page, nextCursor] = await vaultViewer.vaultsByRole(role, grantee, cursor, limit);
            collected.push(...page);

            if (nextCursor === 0n) break;
            cursor = Number(nextCursor);
          }

          const expected: string[] = [];
          for (let gi = 1; gi <= stakingVaults.length; gi++) {
            // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
            const idx = gi - 1;
            const { stakingVault } = stakingVaults[idx];
            const grantedAtGi = idx < vaultSplitIndex ? firstBatchGrantee : secondBatchGrantee;
            if (grantedAtGi.address === grantee.address) {
              expected.push(await stakingVault.getAddress());
            }
          }

          expect(collected).to.deep.equal(expected);
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

    it("returns data for first vault with vaultData", async () => {
      const vaultData = await vaultViewer.vaultData(await stakingVaults[0].stakingVault.getAddress());

      // ✅ Sanity check: values are returned and types match
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFeeRate).to.be.a("bigint");
      expect(vaultData.isReportFresh).to.be.a("boolean");
      expect(vaultData.quarantineInfo.isActive).to.be.a("boolean");
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.be.a("bigint");
      expect(vaultData.quarantineInfo.startTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.endTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.totalValueRemainder).to.be.a("bigint");

      // ✅ Value check
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
      expect(vaultData.isReportFresh).to.equal(expectedVaultsData.isReportFresh);
      expect(vaultData.quarantineInfo.isActive).to.equal(expectedVaultsData.quarantineInfo.isActive);
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.equal(
        expectedVaultsData.quarantineInfo.pendingTotalValueIncrease,
      );
      expect(vaultData.quarantineInfo.startTimestamp).to.equal(expectedVaultsData.quarantineInfo.startTimestamp);
      expect(vaultData.quarantineInfo.endTimestamp).to.equal(expectedVaultsData.quarantineInfo.endTimestamp);
      expect(vaultData.quarantineInfo.totalValueRemainder).to.equal(
        expectedVaultsData.quarantineInfo.totalValueRemainder,
      );
    });

    it("returns default values for zero address", async () => {
      const vaultData = await vaultViewer.vaultData(ethers.ZeroAddress);

      // ✅ Sanity check: values are returned and types match
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.be.a("bigint");
      expect(vaultData.connection.infraFeeBP).to.be.a("bigint");
      expect(vaultData.connection.liquidityFeeBP).to.be.a("bigint");
      expect(vaultData.record.liabilityShares).to.be.a("bigint");
      expect(vaultData.totalValue).to.be.a("bigint");
      expect(vaultData.liabilityStETH).to.be.a("bigint");
      expect(vaultData.nodeOperatorFeeRate).to.be.a("bigint");
      expect(vaultData.isReportFresh).to.be.a("boolean");
      expect(vaultData.quarantineInfo.isActive).to.be.a("boolean");
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.be.a("bigint");
      expect(vaultData.quarantineInfo.startTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.endTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.totalValueRemainder).to.be.a("bigint");

      // ✅ Value check
      expect(vaultData.vaultAddress).to.equal(ethers.ZeroAddress);
      expect(vaultData.connection.forcedRebalanceThresholdBP).to.equal(0n);
      expect(vaultData.connection.infraFeeBP).to.equal(0n);
      expect(vaultData.connection.liquidityFeeBP).to.equal(0n);
      expect(vaultData.record.liabilityShares).to.equal(0n);
      expect(vaultData.totalValue).to.equal(0n);
      expect(vaultData.liabilityStETH).to.equal(0n);
      expect(vaultData.nodeOperatorFeeRate).to.equal(0n);
      expect(vaultData.isReportFresh).to.equal(true);
      expect(vaultData.quarantineInfo.isActive).to.equal(false);
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.equal(0n);
      expect(vaultData.quarantineInfo.startTimestamp).to.equal(0n);
      expect(vaultData.quarantineInfo.endTimestamp).to.equal(0n);
      expect(vaultData.quarantineInfo.totalValueRemainder).to.equal(0n);
    });
  });

  context("get vault data with mocked quarantine info", () => {
    beforeEach(async () => {
      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      await hub.connect(hubSigner).mock_connectVault(
        await stakingVaults[0].stakingVault.getAddress(),
        // dashboard is owner of staking vault
        await stakingVaults[0].dashboard.getAddress(),
      );

      await lazyOracle.mock_addVaultToQuarantine(
        await stakingVaults[0].stakingVault.getAddress(),
        mockVaultToQuarantineExpectedData.pendingTotalValueIncrease,
        mockVaultToQuarantineExpectedData.totalValueRemainder,
        mockVaultToQuarantineExpectedData.startTimestamp,
      );
    });

    it("returns data for first vault with vaultData", async () => {
      const vaultData = await vaultViewer.vaultData(await stakingVaults[0].stakingVault.getAddress());

      // ✅ Sanity check: values are returned and types match
      expect(vaultData.quarantineInfo.isActive).to.be.a("boolean");
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.be.a("bigint");
      expect(vaultData.quarantineInfo.startTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.endTimestamp).to.be.a("bigint");
      expect(vaultData.quarantineInfo.totalValueRemainder).to.be.a("bigint");

      // ✅ Value check
      expect(vaultData.vaultAddress).to.equal(await stakingVaults[0].stakingVault.getAddress());

      expect(vaultData.quarantineInfo.isActive).to.equal(mockVaultToQuarantineExpectedData.isActive);
      expect(vaultData.quarantineInfo.pendingTotalValueIncrease).to.equal(
        mockVaultToQuarantineExpectedData.pendingTotalValueIncrease,
      );
      expect(vaultData.quarantineInfo.startTimestamp).to.equal(mockVaultToQuarantineExpectedData.startTimestamp);
      expect(vaultData.quarantineInfo.endTimestamp).to.equal(mockVaultToQuarantineExpectedData.endTimestamp);
      expect(vaultData.quarantineInfo.totalValueRemainder).to.equal(
        mockVaultToQuarantineExpectedData.totalValueRemainder,
      );
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
      { offset: 0, limit: 1 },
      { offset: 0, limit: 2 },
      { offset: 1, limit: 2 },
      // all
      { offset: 0, limit: stakingVaultCount },
      { offset: 2, limit: stakingVaultCount },
      // only last
      { offset: stakingVaultCount - 1, limit: stakingVaultCount },
      { offset: 0, limit: stakingVaultCount + 1 },
      { offset: 0, limit: stakingVaultCount * 2 },
      // empty
      { offset: stakingVaultCount, limit: 10 },
      // empty
      { offset: stakingVaultCount + 5, limit: 10 },
    ].forEach(({ offset, limit }) => {
      it(`returns data for a batch of vaults with vaultsDataBound(offset=${offset}, limit=${limit})`, async () => {
        const totalVaults = stakingVaults.length;
        const vaultsData = await vaultViewer.vaultsDataBound(offset, limit);

        // ✅ Length check
        const expectedLength = offset >= totalVaults ? 0 : Math.min(limit, totalVaults - offset);
        expect(vaultsData.length).to.equal(expectedLength);

        for (let i = 0; i < vaultsData.length; i++) {
          // ✅ Address ordering check
          // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
          expect(vaultsData[i].vaultAddress).to.equal(await stakingVaults[offset + i].stakingVault.getAddress());

          // ✅ Sanity check: values are returned and types match
          expect(vaultsData[i].connection.forcedRebalanceThresholdBP).to.be.a("bigint");
          expect(vaultsData[i].connection.infraFeeBP).to.be.a("bigint");
          expect(vaultsData[i].connection.liquidityFeeBP).to.be.a("bigint");
          expect(vaultsData[i].record.liabilityShares).to.be.a("bigint");
          expect(vaultsData[i].totalValue).to.be.a("bigint");
          expect(vaultsData[i].liabilityStETH).to.be.a("bigint");
          expect(vaultsData[i].nodeOperatorFeeRate).to.be.a("bigint");
          expect(vaultsData[i].isReportFresh).to.be.a("boolean");
          expect(vaultsData[i].quarantineInfo.isActive).to.be.a("boolean");
          expect(vaultsData[i].quarantineInfo.pendingTotalValueIncrease).to.be.a("bigint");
          expect(vaultsData[i].quarantineInfo.startTimestamp).to.be.a("bigint");
          expect(vaultsData[i].quarantineInfo.endTimestamp).to.be.a("bigint");
          expect(vaultsData[i].quarantineInfo.totalValueRemainder).to.be.a("bigint");

          // ✅ Value check
          expect(vaultsData[i].connection.forcedRebalanceThresholdBP).to.equal(
            expectedVaultsData.connection.forcedRebalanceThresholdBP,
          );
          expect(vaultsData[i].connection.infraFeeBP).to.equal(expectedVaultsData.connection.infraFeeBP);
          expect(vaultsData[i].connection.liquidityFeeBP).to.equal(expectedVaultsData.connection.liquidityFeeBP);
          expect(vaultsData[i].record.liabilityShares).to.equal(expectedVaultsData.record.liabilityShares);
          expect(vaultsData[i].totalValue).to.equal(expectedVaultsData.totalValue);
          expect(vaultsData[i].liabilityStETH).to.equal(expectedVaultsData.liabilityStETH);
          expect(vaultsData[i].nodeOperatorFeeRate).to.equal(expectedVaultsData.nodeOperatorFeeRate);
          expect(vaultsData[i].isReportFresh).to.equal(expectedVaultsData.isReportFresh);
          expect(vaultsData[i].quarantineInfo.isActive).to.equal(expectedVaultsData.quarantineInfo.isActive);
          expect(vaultsData[i].quarantineInfo.pendingTotalValueIncrease).to.equal(
            expectedVaultsData.quarantineInfo.pendingTotalValueIncrease,
          );
          expect(vaultsData[i].quarantineInfo.startTimestamp).to.equal(
            expectedVaultsData.quarantineInfo.startTimestamp,
          );
          expect(vaultsData[i].quarantineInfo.endTimestamp).to.equal(expectedVaultsData.quarantineInfo.endTimestamp);
          expect(vaultsData[i].quarantineInfo.totalValueRemainder).to.equal(
            expectedVaultsData.quarantineInfo.totalValueRemainder,
          );
        }
      });
    });

    [
      { startOffset: 0, pageSize: 1 },
      { startOffset: 0, pageSize: 2 },
      { startOffset: 0, pageSize: 3 },
      { startOffset: 1, pageSize: 1 },
      { startOffset: 1, pageSize: 2 },
      { startOffset: 1, pageSize: 3 },
      // all
      { startOffset: 0, pageSize: stakingVaultCount },
      { startOffset: 0, pageSize: stakingVaultCount / 2 },
      { startOffset: 0, pageSize: stakingVaultCount / 3 },
      { startOffset: 1, pageSize: stakingVaultCount },
      { startOffset: 1, pageSize: stakingVaultCount / 2 },
      { startOffset: 1, pageSize: stakingVaultCount / 3 },
      { startOffset: 0, pageSize: stakingVaultCount + stakingVaultCount },
      { startOffset: 1, pageSize: stakingVaultCount + stakingVaultCount },
      // /all
      // only last
      { startOffset: stakingVaultCount - 1, pageSize: stakingVaultCount },
      { startOffset: stakingVaultCount - 1, pageSize: 1 },
      { startOffset: stakingVaultCount - 1, pageSize: 2 },
      { startOffset: stakingVaultCount - 1, pageSize: 3 },
      // /only last
      // empty
      { startOffset: stakingVaultCount, pageSize: 1 },
      { startOffset: stakingVaultCount, pageSize: stakingVaultCount },
      // /empty
    ].forEach(({ startOffset, pageSize }) => {
      it(`walks pages with vaultsDataBound(offset=${startOffset}, limit=${pageSize}) and preserves order`, async () => {
        const collected: string[] = [];
        const total = stakingVaults.length;

        let offset = startOffset;
        // safe
        const maxPages = Math.ceil(Math.max(0, total - startOffset) / Math.max(1, pageSize)) + 2;

        for (let page = 0; page < maxPages; page++) {
          const batch = await vaultViewer.vaultsDataBound(offset, pageSize);

          // ✅ Length check
          const expectedSize = offset >= total ? 0 : Math.min(pageSize, total - offset);
          expect(batch.length).to.equal(expectedSize);

          for (let i = 0; i < batch.length; i++) {
            // ✅ Address ordering check
            // vaultHub uses 1-based indexing, but stakingVaults is a regular 0-based JS array.
            expect(batch[i].vaultAddress).to.equal(await stakingVaults[offset + i].stakingVault.getAddress());
            collected.push(batch[i].vaultAddress);
          }

          // last page
          if (batch.length < pageSize) break;

          offset += batch.length;
        }

        // ✅ Address ordering check
        const expectedAll = await Promise.all(
          stakingVaults.slice(startOffset).map(({ stakingVault }) => stakingVault.getAddress()),
        );
        expect(collected).to.deep.equal(expectedAll);
      });
    });

    [
      { offset: stakingVaultCount + 1, limit: stakingVaultCount * 10 },
      { offset: stakingVaultCount * 10, limit: stakingVaultCount * 10 },
      { offset: stakingVaultCount * 100, limit: stakingVaultCount * 10 },
      { offset: stakingVaultCount * 10, limit: stakingVaultCount * 100 },
    ].forEach(({ offset, limit }) => {
      it(`returns empty array for out-of-range (offset=${offset}, limit=${limit})`, async () => {
        const result = await vaultViewer.vaultsDataBound(offset, limit);
        expect(result.length).to.equal(0);
      });
    });

    [
      { offset: 0, limit: 0 },
      { offset: 1, limit: 0 },
      { offset: stakingVaultCount, limit: 0 },
      { offset: stakingVaultCount * 10, limit: 0 },
    ].forEach(({ offset, limit }) => {
      it(`reverts with ZeroArgument when limit == 0 [${offset}, ${limit}]`, async () => {
        await expect(vaultViewer.vaultsDataBound(offset, limit)).to.be.revertedWithCustomError(
          vaultViewer,
          "ZeroArgument",
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

        const roleMembers = await vaultViewer.roleMembers(vaultAddress, [
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
        const membersArray = roleMembers.members;
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

        const roleMembers = await vaultViewer.roleMembers(vaultAddress, roles);

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
        const roleMembers = await vaultViewer.roleMembers(vaultAddress, [
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

        const membersBatch = await vaultViewer.roleMembersBatch(vaultAddresses, roles);

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

  context(`gas estimation check (vaults: ${stakingVaultCount})`, () => {
    const formatWithSpaces = (n: bigint | number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    let someGrantee: HardhatEthersSigner;
    let allStakingVaultsOwnerAddr: string;

    before(async () => {
      [, someGrantee] = await ethers.getSigners();

      await steth.mock__setTotalPooledEther(100n);
      await steth.mock__setTotalShares(100n);

      const dashboard = stakingVaults[0].dashboard;
      const role = await dashboard.DEFAULT_ADMIN_ROLE();
      allStakingVaultsOwnerAddr = await dashboard.getAddress();
      for (const { stakingVault } of stakingVaults) {
        await hub.connect(hubSigner).mock_connectVault(await stakingVault.getAddress(), allStakingVaultsOwnerAddr);
        await dashboard.connect(hubSigner).grantRole(role, allStakingVaultsOwnerAddr);
      }
    });

    // const cases = [
    //   {
    //     label: "vaultsByOwner",
    //     args: async (owner: string) => [owner, 1, stakingVaultCount],
    //   },
    //   {
    //     label: "vaultsDataBound",
    //     args: () => [1, stakingVaultCount],
    //   },
    //   {
    //     label: "vaultsByRole",
    //     args: async () => {
    //       const role = await stakingVaults[0].dashboard.DEFAULT_ADMIN_ROLE();
    //       return [role, allStakingVaultsOwnerAddr, 1, stakingVaultCount];
    //     },
    //   },
    // ];

    // cases.forEach(({ label, args }) => {
    //   it(`${label} gas estimation`, async () => {
    //     const resolvedArgs = typeof args === "function" ? await args(allStakingVaultsOwnerAddr) : args;
    //
    //     const gasEstimate = await ethers.provider.estimateGas({
    //       to: await vaultViewer.getAddress(),
    //       data: vaultViewer.interface.encodeFunctionData(label, resolvedArgs),
    //     });
    //
    //     console.log(`⛽️ ${label} gas estimate (vaults: ${stakingVaultCount}):`);
    //     console.log(`   ${formatWithSpaces(gasEstimate)}`);
    //     expect(gasEstimate).to.lte(gasLimit);
    //   });
    // });

    // role grants here do not affect tests above
    it("roleMembersBatch gas estimation (with role grants)", async () => {
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
        data: vaultViewer.interface.encodeFunctionData("roleMembersBatch", [vaultAddresses, roles]),
      });

      console.log("⛽️ roleMembersBatch gas estimate (vaults: %d):", stakingVaultCount);
      console.log("   %s", formatWithSpaces(gasEstimate));
      expect(gasEstimate).to.lte(gasLimit);
    });
  });
});
