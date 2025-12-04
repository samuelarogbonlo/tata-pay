const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PaymentSettlement - Integration Tests", function () {
  // Constants
  const MAX_BATCH_SIZE = 100n;
  const SETTLEMENT_TIMEOUT = 48n * 60n * 60n; // 48 hours

  // Test fixture
  async function deployFixture() {
    const [admin, fintech1, fintech2, oracle, fraud, merchant1, merchant2, merchant3, merchant4] =
      await ethers.getSigners();

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

    // Grant roles
    const SETTLEMENT_ROLE = await pool.SETTLEMENT_ROLE();
    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    const FRAUD_ROLE = await settlement.FRAUD_ROLE();

    await pool.connect(admin).grantRole(SETTLEMENT_ROLE, settlement.target);
    await settlement.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
    await settlement.connect(admin).grantRole(FRAUD_ROLE, fraud.address);

    // Mint USDC to fintechs
    const initialBalance = ethers.parseUnits("1000000", 6); // 1M USDC
    await usdc.mint(fintech1.address, initialBalance);
    await usdc.mint(fintech2.address, initialBalance);

    return {
      settlement,
      pool,
      usdc,
      admin,
      fintech1,
      fintech2,
      oracle,
      fraud,
      merchant1,
      merchant2,
      merchant3,
      merchant4,
      SETTLEMENT_ROLE,
      ORACLE_ROLE,
      FRAUD_ROLE,
      initialBalance,
    };
  }

  describe("Batch Creation", function () {
    it("Should create batch and lock collateral", async function () {
      const { settlement, pool, usdc, fintech1, merchant1, merchant2 } = await deployFixture();

      const merchants = [merchant1.address, merchant2.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
      ];
      const totalAmount = ethers.parseUnits("3000", 6);

      // Deposit collateral
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      // Create batch
      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Extract batch ID from event
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === "BatchCreated"
      );
      const batchId = event.args[0];

      // Verify event
      await expect(tx)
        .to.emit(settlement, "BatchCreated")
        .withArgs(batchId, fintech1.address, 2, totalAmount, block.timestamp);

      // Verify batch details
      const batch = await settlement.getBatch(batchId);
      expect(batch.fintech).to.equal(fintech1.address);
      expect(batch.totalAmount).to.equal(totalAmount);
      expect(batch.status).to.equal(0); // Pending
      expect(batch.merchantCount).to.equal(2);
      expect(batch.claimedCount).to.equal(0);

      // Verify collateral locked
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(totalAmount);
      expect(poolBalance.availableBalance).to.equal(0);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalBatches).to.equal(1);
    });

    it("Should reject empty batch", async function () {
      const { settlement, fintech1 } = await deployFixture();

      await expect(
        settlement.connect(fintech1).createBatch([], [])
      ).to.be.revertedWith("PaymentSettlement: Empty batch");
    });

    it("Should reject batch exceeding max size", async function () {
      const { settlement, pool, usdc, fintech1 } = await deployFixture();

      const merchants = Array(101).fill(ethers.ZeroAddress);
      const amounts = Array(101).fill(ethers.parseUnits("1", 6));

      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWith("PaymentSettlement: Batch too large");
    });

    it("Should reject mismatched arrays", async function () {
      const { settlement, fintech1, merchant1 } = await deployFixture();

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("100", 6), ethers.parseUnits("200", 6)];

      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWith("PaymentSettlement: Length mismatch");
    });

    it("Should reject zero address merchant", async function () {
      const { settlement, fintech1 } = await deployFixture();

      const merchants = [ethers.ZeroAddress];
      const amounts = [ethers.parseUnits("100", 6)];

      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWith("PaymentSettlement: Invalid merchant");
    });

    it("Should reject zero amount", async function () {
      const { settlement, fintech1, merchant1 } = await deployFixture();

      const merchants = [merchant1.address];
      const amounts = [0];

      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWith("PaymentSettlement: Zero amount");
    });

    it("Should reject when insufficient collateral", async function () {
      const { settlement, fintech1, merchant1 } = await deployFixture();

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("100", 6)];

      // No collateral deposited
      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWith("CollateralPool: Insufficient available balance");
    });
  });

  describe("Batch Approval", function () {
    async function setupWithBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1, merchant2 } = fixture;

      const merchants = [merchant1.address, merchant2.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
      ];
      const totalAmount = ethers.parseUnits("3000", 6);

      // Deposit and create batch
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      return { ...fixture, batchId, totalAmount };
    }

    it("Should approve batch and transition to Processing", async function () {
      const { settlement, oracle, fintech1, batchId } = await setupWithBatch();

      const tx = await settlement.connect(oracle).approveBatch(batchId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(settlement, "BatchApproved")
        .withArgs(batchId, oracle.address, block.timestamp);

      // Verify status changed
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(1); // Processing
    });

    it("Should reject approval by non-oracle", async function () {
      const { settlement, fintech1, batchId } = await setupWithBatch();

      await expect(
        settlement.connect(fintech1).approveBatch(batchId)
      ).to.be.reverted;
    });

    it("Should reject approval of non-existent batch", async function () {
      const { settlement, oracle } = await setupWithBatch();

      const fakeBatchId = ethers.keccak256(ethers.toUtf8Bytes("fake"));

      await expect(
        settlement.connect(oracle).approveBatch(fakeBatchId)
      ).to.be.revertedWith("PaymentSettlement: Batch not found");
    });

    it("Should reject double approval", async function () {
      const { settlement, oracle, batchId } = await setupWithBatch();

      await settlement.connect(oracle).approveBatch(batchId);

      await expect(
        settlement.connect(oracle).approveBatch(batchId)
      ).to.be.revertedWith("PaymentSettlement: Invalid status");
    });

    it("Should reject approval after timeout", async function () {
      const { settlement, oracle, batchId } = await setupWithBatch();

      // Fast forward past timeout
      await time.increase(SETTLEMENT_TIMEOUT + 1n);

      await expect(
        settlement.connect(oracle).approveBatch(batchId)
      ).to.be.revertedWith("PaymentSettlement: Batch timeout");
    });
  });

  describe("Merchant Claims", function () {
    async function setupWithApprovedBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1, merchant2, oracle } = fixture;

      const merchants = [merchant1.address, merchant2.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
      ];
      const totalAmount = ethers.parseUnits("3000", 6);

      // Deposit, create, and approve batch
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      await settlement.connect(oracle).approveBatch(batchId);

      return { ...fixture, batchId, totalAmount, merchants, amounts };
    }

    it("Should allow merchant to claim payment", async function () {
      const { settlement, usdc, fintech1, merchant1, batchId, amounts } = await setupWithApprovedBatch();

      const merchant1Before = await usdc.balanceOf(merchant1.address);

      const tx = await settlement.connect(merchant1).claimPayment(batchId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(settlement, "PaymentClaimed")
        .withArgs(batchId, merchant1.address, amounts[0], block.timestamp);

      // Verify USDC transferred
      expect(await usdc.balanceOf(merchant1.address)).to.equal(merchant1Before + amounts[0]);

      // Verify payment marked as claimed
      const payment = await settlement.getPayment(batchId, 0);
      expect(payment.claimed).to.be.true;

      // Verify batch updated
      const batch = await settlement.getBatch(batchId);
      expect(batch.claimedCount).to.equal(1);
    });

    it("Should complete batch after all claims", async function () {
      const { settlement, pool, usdc, fintech1, merchant1, merchant2, batchId, totalAmount, amounts } =
        await setupWithApprovedBatch();

      // Merchant1 claims
      await settlement.connect(merchant1).claimPayment(batchId);

      // Verify not completed yet
      let batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(1); // Still Processing

      // Merchant2 claims
      const tx = await settlement.connect(merchant2).claimPayment(batchId);

      // Verify batch completed
      await expect(tx).to.emit(settlement, "BatchCompleted");

      batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(2); // Completed
      expect(batch.claimedCount).to.equal(2);

      // Verify collateral status
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);
      // Available balance should be 0 because all funds were paid out to merchants
      expect(poolBalance.availableBalance).to.equal(0);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalCompleted).to.equal(1);
      expect(metrics._totalSettled).to.equal(totalAmount);
    });

    it("Should reject claim from non-processing batch", async function () {
      const { settlement, merchant1, batchId } = await setupWithApprovedBatch();

      // Cancel batch first
      // Need to create new pending batch for fintech to cancel
      const fixture = await deployFixture();
      const { settlement: newSettlement, pool, usdc, fintech1, merchant1: newMerchant } = fixture;

      const merchants = [newMerchant.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await newSettlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const newBatchId = event.args[0];

      await expect(
        newSettlement.connect(newMerchant).claimPayment(newBatchId)
      ).to.be.revertedWith("PaymentSettlement: Not processing");
    });

    it("Should reject claim by non-merchant", async function () {
      const { settlement, merchant3, batchId } = await setupWithApprovedBatch();

      await expect(
        settlement.connect(merchant3).claimPayment(batchId)
      ).to.be.revertedWith("PaymentSettlement: Not in batch");
    });

    it("Should reject double claim", async function () {
      const { settlement, usdc, fintech1, merchant1, batchId, amounts } =
        await setupWithApprovedBatch();

      await settlement.connect(merchant1).claimPayment(batchId);

      await expect(
        settlement.connect(merchant1).claimPayment(batchId)
      ).to.be.revertedWith("PaymentSettlement: Already claimed");
    });

    it("Should check canClaim view function", async function () {
      const { settlement, merchant1, merchant2, merchant3, batchId, amounts } =
        await setupWithApprovedBatch();

      // Merchant1 can claim
      let [canClaim, amount] = await settlement.canClaim(batchId, merchant1.address);
      expect(canClaim).to.be.true;
      expect(amount).to.equal(amounts[0]);

      // Merchant3 cannot claim (not in batch)
      [canClaim, amount] = await settlement.canClaim(batchId, merchant3.address);
      expect(canClaim).to.be.false;
      expect(amount).to.equal(0);
    });
  });

  describe("Batch Cancellation", function () {
    async function setupWithBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1 } = fixture;

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      return { ...fixture, batchId, totalAmount };
    }

    it("Should cancel pending batch and unlock collateral", async function () {
      const { settlement, pool, fintech1, batchId, totalAmount } = await setupWithBatch();

      const tx = await settlement.connect(fintech1).cancelBatch(batchId);

      await expect(tx).to.emit(settlement, "BatchCancelled");

      // Verify status
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(3); // Failed

      // Verify collateral unlocked
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);
      expect(poolBalance.availableBalance).to.equal(totalAmount);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalFailed).to.equal(1);
    });

    it("Should reject cancellation by non-owner", async function () {
      const { settlement, fintech2, batchId } = await setupWithBatch();

      await expect(
        settlement.connect(fintech2).cancelBatch(batchId)
      ).to.be.revertedWith("PaymentSettlement: Not batch owner");
    });

    it("Should reject cancellation of approved batch", async function () {
      const { settlement, oracle, fintech1, batchId } = await setupWithBatch();

      await settlement.connect(oracle).approveBatch(batchId);

      await expect(
        settlement.connect(fintech1).cancelBatch(batchId)
      ).to.be.revertedWith("PaymentSettlement: Cannot cancel");
    });
  });

  describe("Batch Failure", function () {
    async function setupWithApprovedBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1, oracle } = fixture;

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      await settlement.connect(oracle).approveBatch(batchId);

      return { ...fixture, batchId, totalAmount };
    }

    it("Should fail batch by oracle with reason", async function () {
      const { settlement, pool, oracle, fintech1, batchId, totalAmount } =
        await setupWithApprovedBatch();

      const reason = "Fraud detected";

      const tx = await settlement.connect(oracle).failBatch(batchId, reason);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(settlement, "BatchFailed")
        .withArgs(batchId, fintech1.address, reason, block.timestamp);

      // Verify status
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(3); // Failed

      // Verify collateral unlocked
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalFailed).to.equal(1);
    });

    it("Should fail batch by fraud role", async function () {
      const { settlement, fraud, batchId } = await setupWithApprovedBatch();

      await expect(
        settlement.connect(fraud).failBatch(batchId, "Suspicious activity")
      ).to.not.be.reverted;
    });

    it("Should reject failure by unauthorized role", async function () {
      const { settlement, fintech1, batchId } = await setupWithApprovedBatch();

      await expect(
        settlement.connect(fintech1).failBatch(batchId, "Unauthorized")
      ).to.be.revertedWith("PaymentSettlement: Unauthorized");
    });

    it("Should fail batch with partial claims and unlock only remaining collateral", async function () {
      // Setup batch with 3 merchants
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, oracle, merchant1, merchant2, merchant3 } = fixture;

      const merchants = [merchant1.address, merchant2.address, merchant3.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
        ethers.parseUnits("3000", 6),
      ];
      const totalAmount = ethers.parseUnits("6000", 6);

      // Deposit and create batch
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      // Approve batch
      await settlement.connect(oracle).approveBatch(batchId);

      // Merchant1 claims (1000 USDC)
      await settlement.connect(merchant1).claimPayment(batchId);
      expect(await usdc.balanceOf(merchant1.address)).to.equal(amounts[0]);

      // Verify collateral state after first claim
      let poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(totalAmount - amounts[0]); // 5000 USDC locked
      expect(poolBalance.availableBalance).to.equal(0);

      // Merchant2 claims (2000 USDC)
      await settlement.connect(merchant2).claimPayment(batchId);
      expect(await usdc.balanceOf(merchant2.address)).to.equal(amounts[1]);

      // Verify collateral state after second claim
      poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(totalAmount - amounts[0] - amounts[1]); // 3000 USDC locked
      expect(poolBalance.availableBalance).to.equal(0);

      // Oracle fails the batch (merchant3 never claimed)
      await settlement.connect(oracle).failBatch(batchId, "Fraud detected");

      // Verify only remaining collateral (3000 USDC) unlocked back to available
      poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);
      expect(poolBalance.availableBalance).to.equal(amounts[2]); // 3000 USDC (only merchant3's unclaimed amount)

      // Verify merchants got their payments
      expect(await usdc.balanceOf(merchant1.address)).to.equal(amounts[0]);
      expect(await usdc.balanceOf(merchant2.address)).to.equal(amounts[1]);
      expect(await usdc.balanceOf(merchant3.address)).to.equal(0); // Never claimed

      // Verify batch status
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(3); // Failed
      expect(batch.claimedCount).to.equal(2);
    });
  });

  describe("Batch Timeout", function () {
    async function setupWithBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1 } = fixture;

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      return { ...fixture, batchId, totalAmount };
    }

    it("Should timeout stale pending batch", async function () {
      const { settlement, pool, fintech1, merchant1, batchId, totalAmount } = await setupWithBatch();

      // Fast forward past timeout
      await time.increase(SETTLEMENT_TIMEOUT + 1n);

      // Anyone can trigger timeout
      const tx = await settlement.connect(merchant1).timeoutBatch(batchId);

      await expect(tx).to.emit(settlement, "BatchFailed");

      // Verify status
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(4); // Timeout

      // Verify collateral unlocked
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalFailed).to.equal(1);
    });

    it("Should reject timeout before delay", async function () {
      const { settlement, merchant1, batchId } = await setupWithBatch();

      await expect(
        settlement.connect(merchant1).timeoutBatch(batchId)
      ).to.be.revertedWith("PaymentSettlement: Not timed out");
    });

    it("Should timeout Processing batch with no claims", async function () {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, oracle, merchant1 } = fixture;

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      // Create and approve batch
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      await settlement.connect(oracle).approveBatch(batchId);

      // Verify batch is Processing
      let batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(1); // Processing

      // Fast forward past timeout (from processedAt)
      await time.increase(SETTLEMENT_TIMEOUT + 1n);

      // Timeout the Processing batch (no merchants claimed)
      await settlement.connect(merchant1).timeoutBatch(batchId);

      // Verify status
      batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(4); // Timeout

      // Verify full collateral unlocked (no claims were made)
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);
      expect(poolBalance.availableBalance).to.equal(totalAmount);

      // Verify metrics
      const metrics = await settlement.getMetrics();
      expect(metrics._totalFailed).to.equal(1);
    });

    it("Should timeout Processing batch with partial claims", async function () {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, oracle, merchant1, merchant2, merchant3 } = fixture;

      const merchants = [merchant1.address, merchant2.address, merchant3.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
        ethers.parseUnits("3000", 6),
      ];
      const totalAmount = ethers.parseUnits("6000", 6);

      // Create and approve batch
      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      await settlement.connect(oracle).approveBatch(batchId);

      // Merchant1 claims
      await settlement.connect(merchant1).claimPayment(batchId);
      expect(await usdc.balanceOf(merchant1.address)).to.equal(amounts[0]);

      // Fast forward past timeout
      await time.increase(SETTLEMENT_TIMEOUT + 1n);

      // Timeout the Processing batch
      await settlement.connect(merchant3).timeoutBatch(batchId);

      // Verify status
      const batch = await settlement.getBatch(batchId);
      expect(batch.status).to.equal(4); // Timeout
      expect(batch.claimedCount).to.equal(1);

      // Verify only remaining collateral unlocked (5000 USDC = 2000 + 3000)
      const poolBalance = await pool.getBalance(fintech1.address);
      expect(poolBalance.lockedBalance).to.equal(0);
      expect(poolBalance.availableBalance).to.equal(amounts[1] + amounts[2]);

      // Verify merchants
      expect(await usdc.balanceOf(merchant1.address)).to.equal(amounts[0]); // Got paid
      expect(await usdc.balanceOf(merchant2.address)).to.equal(0); // Never claimed
      expect(await usdc.balanceOf(merchant3.address)).to.equal(0); // Never claimed
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause and unpause contract", async function () {
      const { settlement, pool, usdc, admin, fintech1, merchant1 } = await deployFixture();

      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];
      const totalAmount = ethers.parseUnits("1000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      // Pause
      await settlement.connect(admin).pause();
      expect(await settlement.paused()).to.be.true;

      // Cannot create batch when paused
      await expect(
        settlement.connect(fintech1).createBatch(merchants, amounts)
      ).to.be.revertedWithCustomError(settlement, "EnforcedPause");

      // Unpause
      await settlement.connect(admin).unpause();
      expect(await settlement.paused()).to.be.false;

      // Can create batch again
      await expect(settlement.connect(fintech1).createBatch(merchants, amounts)).to.not.be.reverted;
    });

    it("Should enforce admin role for pause/unpause", async function () {
      const { settlement, fintech1 } = await deployFixture();

      await expect(settlement.connect(fintech1).pause()).to.be.reverted;
      await expect(settlement.connect(fintech1).unpause()).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    async function setupWithBatch() {
      const fixture = await deployFixture();
      const { settlement, pool, usdc, fintech1, merchant1, merchant2 } = fixture;

      const merchants = [merchant1.address, merchant2.address];
      const amounts = [
        ethers.parseUnits("1000", 6),
        ethers.parseUnits("2000", 6),
      ];
      const totalAmount = ethers.parseUnits("3000", 6);

      await usdc.connect(fintech1).approve(pool.target, totalAmount);
      await pool.connect(fintech1).deposit(totalAmount);

      const tx = await settlement.connect(fintech1).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.fragment && log.fragment.name === "BatchCreated");
      const batchId = event.args[0];

      return { ...fixture, batchId, totalAmount, merchants, amounts };
    }

    it("Should return correct batch details", async function () {
      const { settlement, fintech1, batchId, totalAmount } = await setupWithBatch();

      const batch = await settlement.getBatch(batchId);

      expect(batch.fintech).to.equal(fintech1.address);
      expect(batch.totalAmount).to.equal(totalAmount);
      expect(batch.status).to.equal(0); // Pending
      expect(batch.merchantCount).to.equal(2);
      expect(batch.claimedCount).to.equal(0);
      expect(batch.createdAt).to.be.gt(0);
    });

    it("Should return correct payment details", async function () {
      const { settlement, merchant1, merchant2, batchId, amounts } = await setupWithBatch();

      let payment = await settlement.getPayment(batchId, 0);
      expect(payment.merchant).to.equal(merchant1.address);
      expect(payment.amount).to.equal(amounts[0]);
      expect(payment.claimed).to.be.false;

      payment = await settlement.getPayment(batchId, 1);
      expect(payment.merchant).to.equal(merchant2.address);
      expect(payment.amount).to.equal(amounts[1]);
      expect(payment.claimed).to.be.false;
    });

    it("Should return correct metrics", async function () {
      const { settlement } = await setupWithBatch();

      const metrics = await settlement.getMetrics();

      expect(metrics._totalBatches).to.equal(1);
      expect(metrics._totalCompleted).to.equal(0);
      expect(metrics._totalFailed).to.equal(0);
      expect(metrics._totalSettled).to.equal(0);
    });
  });
});
