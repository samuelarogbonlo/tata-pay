const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SettlementOracle - Integration Tests", function () {
  // Test fixture
  async function deployFixture() {
    const [
      admin,
      oracle1,
      oracle2,
      oracle3,
      fintech1,
      merchant1,
      merchant2,
    ] = await ethers.getSigners();

    // Deploy mock USDC
    const MockUSDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy CollateralPool
    const CollateralPool = await ethers.getContractFactory("CollateralPool");
    const pool = await CollateralPool.deploy(
      await usdc.getAddress(),
      admin.address,
      admin.address
    );

    // Deploy PaymentSettlement
    const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
    const settlement = await PaymentSettlement.deploy(
      await usdc.getAddress(),
      await pool.getAddress(),
      admin.address
    );

    // Grant SETTLEMENT_ROLE to PaymentSettlement
    const SETTLEMENT_ROLE = await pool.SETTLEMENT_ROLE();
    await pool.connect(admin).grantRole(SETTLEMENT_ROLE, settlement.target);

    // Deploy SettlementOracle
    const minimumStake = ethers.parseEther("1"); // 1 PAS
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const oracle = await SettlementOracle.deploy(
      await settlement.getAddress(),
      admin.address,
      minimumStake
    );

    // Grant ORACLE_ROLE to SettlementOracle on PaymentSettlement
    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    await settlement.connect(admin).grantRole(ORACLE_ROLE, oracle.target);

    // Mint USDC to fintech
    const initialBalance = ethers.parseUnits("1000000", 6); // 1M USDC
    await usdc.mint(fintech1.address, initialBalance);

    return {
      oracle,
      settlement,
      pool,
      usdc,
      admin,
      oracle1,
      oracle2,
      oracle3,
      fintech1,
      merchant1,
      merchant2,
      minimumStake,
      ORACLE_ROLE,
      SETTLEMENT_ROLE,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct configuration", async function () {
      const { oracle, settlement, admin, minimumStake } = await deployFixture();

      expect(await oracle.paymentSettlement()).to.equal(settlement.target);
      expect(await oracle.minimumStake()).to.equal(minimumStake);
      expect(await oracle.approvalThreshold()).to.equal(1);
      expect(await oracle.activeOracleCount()).to.equal(0);

      const DEFAULT_ADMIN_ROLE = await oracle.DEFAULT_ADMIN_ROLE();
      expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Oracle Registration", function () {
    it("Should register oracle with sufficient stake", async function () {
      const { oracle, oracle1, minimumStake } = await deployFixture();

      const tx = await oracle.connect(oracle1).registerOracle({ value: minimumStake });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(oracle, "OracleRegistered")
        .withArgs(oracle1.address, minimumStake, block.timestamp);

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isRegistered).to.be.true;
      expect(info.isActive).to.be.true;
      expect(info.stake).to.equal(minimumStake);
      expect(info.approvals).to.equal(0);
      expect(info.rejections).to.equal(0);

      expect(await oracle.activeOracleCount()).to.equal(1);
    });

    it("Should reject registration with insufficient stake", async function () {
      const { oracle, oracle1, minimumStake } = await deployFixture();

      const insufficientStake = minimumStake - 1n;

      await expect(
        oracle.connect(oracle1).registerOracle({ value: insufficientStake })
      ).to.be.revertedWith("SettlementOracle: Insufficient stake");
    });

    it("Should reject duplicate registration", async function () {
      const { oracle, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      await expect(
        oracle.connect(oracle1).registerOracle({ value: minimumStake })
      ).to.be.revertedWith("SettlementOracle: Already registered");
    });
  });

  describe("Oracle Deregistration", function () {
    it("Should deregister oracle and return stake", async function () {
      const { oracle, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      const balanceBefore = await ethers.provider.getBalance(oracle1.address);

      const tx = await oracle.connect(oracle1).deregisterOracle();
      const receipt = await tx.wait();

      await expect(tx).to.emit(oracle, "OracleDeregistered");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isRegistered).to.be.false;
      expect(info.isActive).to.be.false;
      expect(info.stake).to.equal(0);

      expect(await oracle.activeOracleCount()).to.equal(0);

      // Verify stake returned (accounting for gas)
      const balanceAfter = await ethers.provider.getBalance(oracle1.address);
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      expect(balanceAfter).to.be.closeTo(balanceBefore + minimumStake - gasCost, ethers.parseEther("0.001"));
    });

    it("Should reject deregistration if not registered", async function () {
      const { oracle, oracle1 } = await deployFixture();

      await expect(
        oracle.connect(oracle1).deregisterOracle()
      ).to.be.revertedWith("SettlementOracle: Not registered");
    });
  });

  // NOTE: ECDSA signature-based tests removed for PolkaVM compatibility
  // PolkaVM doesn't support ecrecover opcode, so SettlementOracle now uses
  // role-based authorization (isRegistered && isActive checks) instead of signatures.
  //
  // Original tests expected: approveBatch(batchId, nonce, signature)
  // Current implementation: approveBatch(batchId) - direct role-based call

  describe("Multi-Oracle Consensus", function () {
    async function setupWithMultipleOracles() {
      const fixture = await deployFixture();
      const { oracle, settlement, pool, usdc, oracle1, oracle2, oracle3, fintech1, merchant1, minimumStake, admin } = fixture;

      // Register 3 oracles
      await oracle.connect(oracle1).registerOracle({ value: minimumStake });
      await oracle.connect(oracle2).registerOracle({ value: minimumStake });
      await oracle.connect(oracle3).registerOracle({ value: minimumStake });

      // Set threshold to 2
      await oracle.connect(admin).setApprovalThreshold(2);

      // Create batch
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      return { ...fixture, batchId };
    }

    it("Should require threshold approvals before executing", async function () {
      const { oracle, settlement, oracle1, oracle2, batchId } = await setupWithMultipleOracles();

      // First oracle approval (role-based, no signature)
      await oracle.connect(oracle1).approveBatch(batchId);

      // Batch should still be Pending (not enough approvals)
      let batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(0); // Pending

      // Second oracle approval (reaches threshold)
      await oracle.connect(oracle2).approveBatch(batchId);

      // Batch should now be Processing
      batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(1); // Processing

      expect(await oracle.totalApprovalsProcessed()).to.equal(1);
    });
  });

  describe("Oracle Slashing", function () {
    it("Should slash oracle for malicious behavior", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      const reason = "Provided false data";
      const slashAmount = await oracle.slashAmount();

      const tx = await oracle.connect(admin).slashOracle(oracle1.address, reason);

      await expect(tx).to.emit(oracle, "OracleSlashed").withArgs(oracle1.address, slashAmount, reason, await ethers.provider.getBlock(tx.blockNumber).then(b => b.timestamp));

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.stake).to.equal(minimumStake - slashAmount);
      expect(info.slashes).to.equal(1);
    });

    it("Should deactivate oracle if stake falls below minimum", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      const lowStake = minimumStake + ethers.parseEther("0.05"); // Just above minimum
      await oracle.connect(oracle1).registerOracle({ value: lowStake });

      expect(await oracle.activeOracleCount()).to.equal(1);

      // Slash will drop stake below minimum
      await oracle.connect(admin).slashOracle(oracle1.address, "Fraud");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.false;
      expect(await oracle.activeOracleCount()).to.equal(0);
    });
  });

  describe("Oracle Activation/Deactivation", function () {
    it("Should activate deactivated oracle with sufficient stake", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });
      await oracle.connect(admin).deactivateOracle(oracle1.address);

      expect(await oracle.activeOracleCount()).to.equal(0);

      const tx = await oracle.connect(admin).activateOracle(oracle1.address);

      await expect(tx).to.emit(oracle, "OracleActivated");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.true;
      expect(await oracle.activeOracleCount()).to.equal(1);
    });

    it("Should deactivate oracle", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      const tx = await oracle.connect(admin).deactivateOracle(oracle1.address);

      await expect(tx).to.emit(oracle, "OracleDeactivated");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.false;
      expect(await oracle.activeOracleCount()).to.equal(0);
    });
  });

  describe("Configuration", function () {
    it("Should update approval threshold", async function () {
      const { oracle, admin, oracle1, oracle2, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });
      await oracle.connect(oracle2).registerOracle({ value: minimumStake });

      const tx = await oracle.connect(admin).setApprovalThreshold(2);

      await expect(tx).to.emit(oracle, "ApprovalThresholdUpdated").withArgs(1, 2, await ethers.provider.getBlock(tx.blockNumber).then(b => b.timestamp));

      expect(await oracle.approvalThreshold()).to.equal(2);
    });

    it("Should reject threshold higher than active oracles", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      await expect(
        oracle.connect(admin).setApprovalThreshold(5)
      ).to.be.revertedWith("SettlementOracle: Threshold too high");
    });

    it("Should update minimum stake", async function () {
      const { oracle, admin } = await deployFixture();

      const newStake = ethers.parseEther("2");

      const tx = await oracle.connect(admin).setMinimumStake(newStake);

      await expect(tx).to.emit(oracle, "MinimumStakeUpdated");

      expect(await oracle.minimumStake()).to.equal(newStake);
      expect(await oracle.slashAmount()).to.equal(newStake / 10n);
    });
  });

  describe("View Functions", function () {
    it("Should return correct oracle count", async function () {
      const { oracle, oracle1, oracle2, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });
      await oracle.connect(oracle2).registerOracle({ value: minimumStake });

      const [total, active] = await oracle.getOracleCount();
      expect(total).to.equal(2);
      expect(active).to.equal(2);
    });

    it("Should return batch vote status", async function () {
      const fixture = await deployFixture();
      const { oracle, settlement, pool, usdc, oracle1, fintech1, merchant1, minimumStake } = fixture;

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      // Create batch
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      // Approve batch (role-based, no signature)
      await oracle.connect(oracle1).approveBatch(batchId);

      const [approvals, rejections, processed] = await oracle.getBatchVoteStatus(batchId);
      expect(approvals).to.equal(1);
      expect(rejections).to.equal(0);
      expect(processed).to.be.true;
    });

    it("Should return correct metrics", async function () {
      const { oracle, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracle1).registerOracle({ value: minimumStake });

      const [totalApprovals, totalRejections, totalSlashed, activeOracles] = await oracle.getMetrics();

      expect(totalApprovals).to.equal(0);
      expect(totalRejections).to.equal(0);
      expect(totalSlashed).to.equal(0);
      expect(activeOracles).to.equal(1);
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause contract", async function () {
      const { oracle, admin, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(admin).pause();
      expect(await oracle.paused()).to.be.true;

      // Cannot register when paused
      await expect(
        oracle.connect(oracle1).registerOracle({ value: minimumStake })
      ).to.be.revertedWithCustomError(oracle, "EnforcedPause");

      await oracle.connect(admin).unpause();
      expect(await oracle.paused()).to.be.false;

      // Can register again
      await expect(oracle.connect(oracle1).registerOracle({ value: minimumStake })).to.not.be.reverted;
    });
  });
});
