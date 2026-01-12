const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("SettlementOracle - Integration Tests", function () {
  // Constants
  const LOCKUP_PERIOD = 48n * 60n * 60n; // 48 hours
  const MIN_AMOUNT = ethers.parseUnits("10", 6);
  const MAX_AMOUNT = ethers.parseUnits("100000", 6);

  // Test fixture
  async function deployFixture() {
    const [
      admin,
      oracleManager,
      oracle1,
      oracle2,
      oracle3,
      sender1,
      recipient1,
      yaraSettlement,
      unauthorized,
    ] = await ethers.getSigners();

    // Deploy mock USDC
    const MockUSDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy CrossBorderSettlement
    const CrossBorderSettlement = await ethers.getContractFactory("CrossBorderSettlement");
    const settlement = await CrossBorderSettlement.deploy(
      await usdc.getAddress(),
      admin.address,
      yaraSettlement.address
    );

    // Configure settlement
    await settlement.connect(admin).setLockupPeriod(LOCKUP_PERIOD);
    await settlement.connect(admin).setAmountLimits(MIN_AMOUNT, MAX_AMOUNT);

    // Deploy SettlementOracle
    const minimumStake = ethers.parseEther("1"); // 1 PAS native token
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const oracle = await SettlementOracle.deploy(
      await settlement.getAddress(),
      admin.address,
      minimumStake
    );

    // Grant ORACLE_ROLE to SettlementOracle on CrossBorderSettlement
    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    await settlement.connect(admin).grantRole(ORACLE_ROLE, oracle.target);

    // Grant DEFAULT_ADMIN_ROLE to SettlementOracle so it can grant oracle roles
    const DEFAULT_ADMIN_ROLE = await settlement.DEFAULT_ADMIN_ROLE();
    await settlement.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, oracle.target);

    // Grant ORACLE_MANAGER_ROLE to oracleManager
    const ORACLE_MANAGER_ROLE = await oracle.ORACLE_MANAGER_ROLE();
    await oracle.connect(admin).grantRole(ORACLE_MANAGER_ROLE, oracleManager.address);

    // Mint USDC to sender
    const initialBalance = ethers.parseUnits("1000000", 6); // 1M USDC
    await usdc.mint(sender1.address, initialBalance);

    return {
      oracle,
      settlement,
      usdc,
      admin,
      oracleManager,
      oracle1,
      oracle2,
      oracle3,
      sender1,
      recipient1,
      yaraSettlement,
      unauthorized,
      minimumStake,
      ORACLE_ROLE,
      ORACLE_MANAGER_ROLE,
      initialBalance,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct configuration", async function () {
      const { oracle, settlement, admin, minimumStake } = await deployFixture();

      expect(await oracle.crossBorderSettlement()).to.equal(settlement.target);
      expect(await oracle.minimumStake()).to.equal(minimumStake);
      expect(await oracle.approvalThreshold()).to.equal(1);
      expect(await oracle.activeOracleCount()).to.equal(0);

      const DEFAULT_ADMIN_ROLE = await oracle.DEFAULT_ADMIN_ROLE();
      expect(await oracle.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Oracle Registration", function () {
    it("Should register oracle with sufficient stake", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      const tx = await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(oracle, "OracleRegistered")
        .withArgs(oracle1.address, minimumStake, block.timestamp);

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isRegistered).to.be.true;
      expect(info.isActive).to.be.true;
      expect(info.stake).to.equal(minimumStake);
      expect(info.confirmations).to.equal(0);
      expect(info.failures).to.equal(0);

      expect(await oracle.activeOracleCount()).to.equal(1);
    });

    it("Should reject registration with insufficient stake", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      const insufficientStake = minimumStake - 1n;

      await expect(
        oracle.connect(oracleManager).registerOracle(oracle1.address, { value: insufficientStake })
      ).to.be.revertedWith("SettlementOracle: Insufficient stake");
    });

    it("Should reject duplicate registration", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      await expect(
        oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake })
      ).to.be.revertedWith("SettlementOracle: Already registered");
    });

    it("Should reject registration from non-manager", async function () {
      const { oracle, unauthorized, oracle1, minimumStake } = await deployFixture();

      await expect(
        oracle.connect(unauthorized).registerOracle(oracle1.address, { value: minimumStake })
      ).to.be.revertedWithCustomError(oracle, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Oracle Deregistration", function () {
    it("Should deregister oracle and return stake", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      const balanceBefore = await ethers.provider.getBalance(oracle1.address);

      const tx = await oracle.connect(oracleManager).deregisterOracle(oracle1.address);

      await expect(tx).to.emit(oracle, "OracleDeregistered");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isRegistered).to.be.false;
      expect(info.isActive).to.be.false;
      expect(info.stake).to.equal(0);

      expect(await oracle.activeOracleCount()).to.equal(0);

      // Verify stake returned to oracle address
      const balanceAfter = await ethers.provider.getBalance(oracle1.address);
      expect(balanceAfter).to.equal(balanceBefore + minimumStake);
    });

    it("Should reject deregistration if not registered", async function () {
      const { oracle, oracleManager, oracle1 } = await deployFixture();

      await expect(
        oracle.connect(oracleManager).deregisterOracle(oracle1.address)
      ).to.be.revertedWith("SettlementOracle: Not registered");
    });
  });

  describe("Payment Confirmation", function () {
    async function setupWithPayment() {
      const fixture = await deployFixture();
      const { oracle, settlement, usdc, oracleManager, oracle1, sender1, recipient1, minimumStake } = fixture;

      // Register oracle
      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      // Create payment
      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      return { ...fixture, paymentId, amount };
    }

    it("Should confirm payment via oracle", async function () {
      const { oracle, settlement, oracle1, paymentId } = await setupWithPayment();

      const yaraReference = "YARA_12345";
      const tx = await oracle.connect(oracle1).confirmPayment(paymentId, yaraReference);

      await expect(tx).to.emit(oracle, "PaymentConfirmationVoted");
      await expect(tx).to.emit(oracle, "PaymentConfirmed");

      // Verify payment status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(2); // Confirmed

      // Verify oracle stats
      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.confirmations).to.equal(1);
    });

    it("Should reject confirmation from unregistered oracle", async function () {
      const { oracle, oracle2, paymentId } = await setupWithPayment();

      await expect(
        oracle.connect(oracle2).confirmPayment(paymentId, "YARA_REF")
      ).to.be.revertedWith("SettlementOracle: Not active oracle");
    });

    it("Should reject double voting", async function () {
      const { oracle, oracle1, paymentId } = await setupWithPayment();

      await oracle.connect(oracle1).confirmPayment(paymentId, "YARA_REF");

      await expect(
        oracle.connect(oracle1).confirmPayment(paymentId, "YARA_REF_2")
      ).to.be.revertedWith("SettlementOracle: Payment already processed");
    });
  });

  describe("Payment Failure", function () {
    async function setupWithPayment() {
      const fixture = await deployFixture();
      const { oracle, settlement, usdc, oracleManager, oracle1, sender1, recipient1, minimumStake } = fixture;

      // Register oracle
      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      // Create payment
      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("500", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "KES",
        ethers.ZeroHash
      );

      return { ...fixture, paymentId, amount };
    }

    it("Should fail payment via oracle", async function () {
      const { oracle, settlement, oracle1, paymentId } = await setupWithPayment();

      const reason = "Invalid bank details";
      const tx = await oracle.connect(oracle1).failPayment(paymentId, reason);

      await expect(tx).to.emit(oracle, "PaymentFailureVoted");
      await expect(tx).to.emit(oracle, "PaymentFailed");

      // Verify payment status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(3); // Failed

      // Verify oracle stats
      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.failures).to.equal(1);
    });
  });

  describe("Multi-Oracle Consensus", function () {
    async function setupWithMultipleOracles() {
      const fixture = await deployFixture();
      const { oracle, settlement, usdc, oracleManager, oracle1, oracle2, oracle3, sender1, recipient1, minimumStake, admin } = fixture;

      // Register 3 oracles
      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });
      await oracle.connect(oracleManager).registerOracle(oracle2.address, { value: minimumStake });
      await oracle.connect(oracleManager).registerOracle(oracle3.address, { value: minimumStake });

      // Set threshold to 2
      await oracle.connect(oracleManager).setApprovalThreshold(2);

      // Create payment
      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1000", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      return { ...fixture, paymentId, amount };
    }

    it("Should require threshold confirmations before executing", async function () {
      const { oracle, settlement, oracle1, oracle2, paymentId } = await setupWithMultipleOracles();

      // First oracle confirmation
      await oracle.connect(oracle1).confirmPayment(paymentId, "YARA_REF");

      // Payment should still be Locked (not enough confirmations)
      let payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(1); // Locked

      // Second oracle confirmation (reaches threshold)
      await oracle.connect(oracle2).confirmPayment(paymentId, "YARA_REF");

      // Payment should now be Confirmed
      payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(2); // Confirmed

      expect(await oracle.totalConfirmationsProcessed()).to.equal(1);
    });
  });

  describe("Oracle Slashing", function () {
    it("Should slash oracle for malicious behavior", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      const reason = "Provided false data";
      const slashAmount = await oracle.slashAmount();

      const tx = await oracle.connect(oracleManager).slashOracle(oracle1.address, reason);

      await expect(tx).to.emit(oracle, "OracleSlashed");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.stake).to.equal(minimumStake - slashAmount);
      expect(info.slashes).to.equal(1);
    });

    it("Should deactivate oracle if stake falls below minimum", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      const lowStake = minimumStake + ethers.parseEther("0.05");
      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: lowStake });

      expect(await oracle.activeOracleCount()).to.equal(1);

      // Slash will drop stake below minimum
      await oracle.connect(oracleManager).slashOracle(oracle1.address, "Fraud");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.false;
      expect(await oracle.activeOracleCount()).to.equal(0);
    });
  });

  describe("Oracle Activation/Deactivation", function () {
    it("Should activate deactivated oracle with sufficient stake", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });
      await oracle.connect(oracleManager).deactivateOracle(oracle1.address);

      expect(await oracle.activeOracleCount()).to.equal(0);

      const tx = await oracle.connect(oracleManager).activateOracle(oracle1.address);

      await expect(tx).to.emit(oracle, "OracleActivated");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.true;
      expect(await oracle.activeOracleCount()).to.equal(1);
    });

    it("Should deactivate oracle", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      const tx = await oracle.connect(oracleManager).deactivateOracle(oracle1.address);

      await expect(tx).to.emit(oracle, "OracleDeactivated");

      const info = await oracle.getOracleInfo(oracle1.address);
      expect(info.isActive).to.be.false;
      expect(await oracle.activeOracleCount()).to.equal(0);
    });
  });

  describe("Configuration", function () {
    it("Should update approval threshold", async function () {
      const { oracle, oracleManager, oracle1, oracle2, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });
      await oracle.connect(oracleManager).registerOracle(oracle2.address, { value: minimumStake });

      const tx = await oracle.connect(oracleManager).setApprovalThreshold(2);

      await expect(tx).to.emit(oracle, "ApprovalThresholdUpdated");

      expect(await oracle.approvalThreshold()).to.equal(2);
    });

    it("Should reject threshold higher than active oracles", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      await expect(
        oracle.connect(oracleManager).setApprovalThreshold(5)
      ).to.be.revertedWith("SettlementOracle: Threshold too high");
    });

    it("Should update minimum stake", async function () {
      const { oracle, oracleManager } = await deployFixture();

      const newStake = ethers.parseEther("2");

      const tx = await oracle.connect(oracleManager).setMinimumStake(newStake);

      await expect(tx).to.emit(oracle, "MinimumStakeUpdated");

      expect(await oracle.minimumStake()).to.equal(newStake);
      expect(await oracle.slashAmount()).to.equal(newStake / 10n);
    });
  });

  describe("View Functions", function () {
    it("Should return correct oracle count", async function () {
      const { oracle, oracleManager, oracle1, oracle2, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });
      await oracle.connect(oracleManager).registerOracle(oracle2.address, { value: minimumStake });

      const [total, active] = await oracle.getOracleCount();
      expect(total).to.equal(2);
      expect(active).to.equal(2);
    });

    it("Should return payment vote status", async function () {
      const fixture = await deployFixture();
      const { oracle, settlement, usdc, oracleManager, oracle1, sender1, recipient1, minimumStake } = fixture;

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      // Create payment
      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Confirm payment
      await oracle.connect(oracle1).confirmPayment(paymentId, "YARA_REF");

      const [confirmations, failures, processed] = await oracle.getPaymentVoteStatus(paymentId);
      expect(confirmations).to.equal(1);
      expect(failures).to.equal(0);
      expect(processed).to.be.true;
    });

    it("Should return correct metrics", async function () {
      const { oracle, oracleManager, oracle1, minimumStake } = await deployFixture();

      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      const [totalConfirmations, totalFailures, totalSlashed, activeOracles] = await oracle.getMetrics();

      expect(totalConfirmations).to.equal(0);
      expect(totalFailures).to.equal(0);
      expect(totalSlashed).to.equal(0);
      expect(activeOracles).to.equal(1);
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause contract", async function () {
      const { oracle, admin, oracleManager, oracle1, minimumStake } = await deployFixture();

      // Grant EMERGENCY_ROLE to admin
      const EMERGENCY_ROLE = await oracle.EMERGENCY_ROLE();

      await oracle.connect(admin).pause();
      expect(await oracle.paused()).to.be.true;

      // Cannot confirm when paused
      await oracle.connect(oracleManager).registerOracle(oracle1.address, { value: minimumStake });

      // Note: registration might work but confirmPayment should fail when paused
      // (depends on implementation)

      await oracle.connect(admin).unpause();
      expect(await oracle.paused()).to.be.false;
    });
  });
});
