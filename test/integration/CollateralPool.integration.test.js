const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CollateralPool - Integration Tests", function () {
  // Constants
  const MINIMUM_DEPOSIT = ethers.parseUnits("1000", 6); // 1000 USDC
  const DEFAULT_WITHDRAWAL_DELAY = 24n * 60n * 60n; // 24 hours

  // Test fixture with real USDC mock
  async function deployFixture() {
    const [admin, fintech1, fintech2, settlement, slasher, treasury, merchant] =
      await ethers.getSigners();

    // Deploy mock USDC (6 decimals like Asset Hub)
    const MockUSDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy CollateralPool with mock USDC
    const CollateralPool = await ethers.getContractFactory("CollateralPool");
    const pool = await CollateralPool.deploy(
      await usdc.getAddress(),
      admin.address,
      treasury.address
    );

    // Grant roles
    const SETTLEMENT_ROLE = await pool.SETTLEMENT_ROLE();
    const SLASHER_ROLE = await pool.SLASHER_ROLE();
    await pool.connect(admin).grantRole(SETTLEMENT_ROLE, settlement.address);
    await pool.connect(admin).grantRole(SLASHER_ROLE, slasher.address);

    // Mint USDC to fintechs
    const initialBalance = ethers.parseUnits("100000", 6); // 100k USDC
    await usdc.mint(fintech1.address, initialBalance);
    await usdc.mint(fintech2.address, initialBalance);

    return {
      pool,
      usdc,
      admin,
      fintech1,
      fintech2,
      settlement,
      slasher,
      treasury,
      merchant,
      SETTLEMENT_ROLE,
      SLASHER_ROLE,
      initialBalance,
    };
  }

  describe("Full Deposit Flow", function () {
    it("Should successfully deposit USDC and emit event", async function () {
      const { pool, usdc, fintech1 } = await deployFixture();

      const depositAmount = ethers.parseUnits("5000", 6);

      // Approve USDC transfer
      await usdc.connect(fintech1).approve(pool.target, depositAmount);

      // Deposit and check event (timestamp will be current block timestamp)
      const tx = await pool.connect(fintech1).deposit(depositAmount);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(pool, "Deposited")
        .withArgs(fintech1.address, depositAmount, depositAmount, block.timestamp);

      // Verify balances
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.totalDeposited).to.equal(depositAmount);
      expect(balance.availableBalance).to.equal(depositAmount);
      expect(balance.lockedBalance).to.equal(0);
      expect(balance.totalWithdrawn).to.equal(0);
      expect(balance.totalSlashed).to.equal(0);

      // Verify USDC transferred
      expect(await usdc.balanceOf(pool.target)).to.equal(depositAmount);
      expect(await pool.getTotalValueLocked()).to.equal(depositAmount);
    });

    it("Should handle multiple deposits from same fintech", async function () {
      const { pool, usdc, fintech1 } = await deployFixture();

      const deposit1 = ethers.parseUnits("2000", 6);
      const deposit2 = ethers.parseUnits("3000", 6);

      // First deposit
      await usdc.connect(fintech1).approve(pool.target, deposit1);
      await pool.connect(fintech1).deposit(deposit1);

      // Second deposit
      await usdc.connect(fintech1).approve(pool.target, deposit2);
      await pool.connect(fintech1).deposit(deposit2);

      // Verify cumulative balance
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.totalDeposited).to.equal(deposit1 + deposit2);
      expect(balance.availableBalance).to.equal(deposit1 + deposit2);
      expect(await pool.getTotalValueLocked()).to.equal(deposit1 + deposit2);
    });

    it("Should handle deposits from multiple fintechs independently", async function () {
      const { pool, usdc, fintech1, fintech2 } = await deployFixture();

      const amount1 = ethers.parseUnits("4000", 6);
      const amount2 = ethers.parseUnits("6000", 6);

      // Fintech1 deposits
      await usdc.connect(fintech1).approve(pool.target, amount1);
      await pool.connect(fintech1).deposit(amount1);

      // Fintech2 deposits
      await usdc.connect(fintech2).approve(pool.target, amount2);
      await pool.connect(fintech2).deposit(amount2);

      // Verify independent balances
      const balance1 = await pool.getBalance(fintech1.address);
      const balance2 = await pool.getBalance(fintech2.address);

      expect(balance1.availableBalance).to.equal(amount1);
      expect(balance2.availableBalance).to.equal(amount2);
      expect(await pool.getTotalValueLocked()).to.equal(amount1 + amount2);
    });

    it("Should reject deposit below minimum", async function () {
      const { pool, usdc, fintech1 } = await deployFixture();

      const tooSmall = MINIMUM_DEPOSIT - 1n;

      await usdc.connect(fintech1).approve(pool.target, tooSmall);
      await expect(pool.connect(fintech1).deposit(tooSmall)).to.be.revertedWith(
        "CollateralPool: Below minimum deposit"
      );
    });

    it("Should accept deposit at exact minimum", async function () {
      const { pool, usdc, fintech1 } = await deployFixture();

      await usdc.connect(fintech1).approve(pool.target, MINIMUM_DEPOSIT);
      await expect(pool.connect(fintech1).deposit(MINIMUM_DEPOSIT)).to.not.be.reverted;

      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(MINIMUM_DEPOSIT);
    });
  });

  describe("Full Withdrawal Flow", function () {
    async function setupWithDeposit() {
      const fixture = await deployFixture();
      const { pool, usdc, fintech1 } = fixture;

      // Deposit 10k USDC
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await pool.connect(fintech1).deposit(depositAmount);

      return { ...fixture, depositAmount };
    }

    it("Should successfully request withdrawal and emit event", async function () {
      const { pool, fintech1, depositAmount } = await setupWithDeposit();

      const withdrawAmount = ethers.parseUnits("3000", 6);
      const requestTime = (await time.latest()) + 1;
      const unlockTime = requestTime + Number(DEFAULT_WITHDRAWAL_DELAY);

      await expect(pool.connect(fintech1).requestWithdrawal(withdrawAmount))
        .to.emit(pool, "WithdrawalRequested")
        .withArgs(fintech1.address, withdrawAmount, unlockTime);

      // Verify request created
      const request = await pool.getWithdrawalRequest(fintech1.address);
      expect(request.amount).to.equal(withdrawAmount);
      expect(request.requestTime).to.equal(requestTime);
      expect(request.unlockTime).to.equal(unlockTime);
      expect(request.executed).to.be.false;

      // Balance should still be available (not moved yet)
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(depositAmount);
    });

    it("Should execute withdrawal after delay and transfer USDC", async function () {
      const { pool, usdc, fintech1, depositAmount } = await setupWithDeposit();

      const withdrawAmount = ethers.parseUnits("3000", 6);

      // Request withdrawal
      await pool.connect(fintech1).requestWithdrawal(withdrawAmount);

      // Check not ready before delay
      expect(await pool.isWithdrawalReady(fintech1.address)).to.be.false;

      // Attempt early execution
      await expect(pool.connect(fintech1).executeWithdrawal()).to.be.revertedWith(
        "CollateralPool: Withdrawal delay not met"
      );

      // Fast forward time
      await time.increase(DEFAULT_WITHDRAWAL_DELAY);

      // Check now ready
      expect(await pool.isWithdrawalReady(fintech1.address)).to.be.true;

      // Get initial USDC balance
      const initialUsdcBalance = await usdc.balanceOf(fintech1.address);

      // Execute withdrawal
      await expect(pool.connect(fintech1).executeWithdrawal())
        .to.emit(pool, "Withdrawn")
        .withArgs(fintech1.address, withdrawAmount, depositAmount - withdrawAmount);

      // Verify balances updated
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(depositAmount - withdrawAmount);
      expect(balance.totalWithdrawn).to.equal(withdrawAmount);
      expect(await pool.getTotalValueLocked()).to.equal(depositAmount - withdrawAmount);

      // Verify USDC transferred
      expect(await usdc.balanceOf(fintech1.address)).to.equal(initialUsdcBalance + withdrawAmount);

      // Verify request cleared
      const request = await pool.getWithdrawalRequest(fintech1.address);
      expect(request.amount).to.equal(0);
      expect(request.requestTime).to.equal(0);
    });

    it("Should reject withdrawal exceeding available balance", async function () {
      const { pool, fintech1, depositAmount } = await setupWithDeposit();

      const tooMuch = depositAmount + 1n;

      await expect(pool.connect(fintech1).requestWithdrawal(tooMuch)).to.be.revertedWith(
        "CollateralPool: Insufficient available balance"
      );
    });

    it("Should reject duplicate withdrawal requests", async function () {
      const { pool, fintech1 } = await setupWithDeposit();

      const withdrawAmount = ethers.parseUnits("2000", 6);

      // First request
      await pool.connect(fintech1).requestWithdrawal(withdrawAmount);

      // Second request
      await expect(pool.connect(fintech1).requestWithdrawal(withdrawAmount)).to.be.revertedWith(
        "CollateralPool: Pending withdrawal exists"
      );
    });

    it("Should allow cancelling withdrawal request", async function () {
      const { pool, fintech1, depositAmount } = await setupWithDeposit();

      const withdrawAmount = ethers.parseUnits("2000", 6);

      // Request
      await pool.connect(fintech1).requestWithdrawal(withdrawAmount);

      // Cancel
      await expect(pool.connect(fintech1).cancelWithdrawal())
        .to.emit(pool, "WithdrawalCancelled")
        .withArgs(fintech1.address, withdrawAmount);

      // Verify cleared
      const request = await pool.getWithdrawalRequest(fintech1.address);
      expect(request.amount).to.equal(0);

      // Should be able to request again
      await expect(pool.connect(fintech1).requestWithdrawal(withdrawAmount)).to.not.be.reverted;
    });
  });

  describe("Collateral Lock/Unlock Flow", function () {
    async function setupWithDeposit() {
      const fixture = await deployFixture();
      const { pool, usdc, fintech1 } = fixture;

      const depositAmount = ethers.parseUnits("20000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await pool.connect(fintech1).deposit(depositAmount);

      return { ...fixture, depositAmount };
    }

    it("Should lock collateral for settlement", async function () {
      const { pool, fintech1, settlement, depositAmount } = await setupWithDeposit();

      const lockAmount = ethers.parseUnits("5000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));

      // Lock collateral
      await expect(
        pool.connect(settlement).lockCollateral(fintech1.address, lockAmount, settlementId)
      )
        .to.emit(pool, "CollateralLocked")
        .withArgs(fintech1.address, lockAmount, settlementId, lockAmount);

      // Verify balances
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(depositAmount - lockAmount);
      expect(balance.lockedBalance).to.equal(lockAmount);

      // TVL unchanged
      expect(await pool.getTotalValueLocked()).to.equal(depositAmount);
    });

    it("Should unlock collateral after settlement", async function () {
      const { pool, fintech1, settlement, depositAmount } = await setupWithDeposit();

      const lockAmount = ethers.parseUnits("5000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));

      // Lock
      await pool.connect(settlement).lockCollateral(fintech1.address, lockAmount, settlementId);

      // Unlock
      await expect(
        pool.connect(settlement).unlockCollateral(fintech1.address, lockAmount, settlementId)
      )
        .to.emit(pool, "CollateralUnlocked")
        .withArgs(fintech1.address, lockAmount, settlementId, depositAmount);

      // Verify balances restored
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(depositAmount);
      expect(balance.lockedBalance).to.equal(0);
    });

    it("Should handle multiple concurrent locks", async function () {
      const { pool, fintech1, settlement, depositAmount } = await setupWithDeposit();

      const lock1 = ethers.parseUnits("3000", 6);
      const lock2 = ethers.parseUnits("4000", 6);
      const batch1 = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));
      const batch2 = ethers.keccak256(ethers.toUtf8Bytes("batch-002"));

      // Lock for batch 1
      await pool.connect(settlement).lockCollateral(fintech1.address, lock1, batch1);

      // Lock for batch 2
      await pool.connect(settlement).lockCollateral(fintech1.address, lock2, batch2);

      // Verify cumulative locked
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.lockedBalance).to.equal(lock1 + lock2);
      expect(balance.availableBalance).to.equal(depositAmount - lock1 - lock2);

      // Unlock batch 1
      await pool.connect(settlement).unlockCollateral(fintech1.address, lock1, batch1);

      const balanceAfter = await pool.getBalance(fintech1.address);
      expect(balanceAfter.lockedBalance).to.equal(lock2);
      expect(balanceAfter.availableBalance).to.equal(depositAmount - lock2);
    });

    it("Should reject lock exceeding available balance", async function () {
      const { pool, fintech1, settlement, depositAmount } = await setupWithDeposit();

      const tooMuch = depositAmount + 1n;
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));

      await expect(
        pool.connect(settlement).lockCollateral(fintech1.address, tooMuch, settlementId)
      ).to.be.revertedWith("CollateralPool: Insufficient available balance");
    });

    it("Should reject unlock exceeding locked balance", async function () {
      const { pool, fintech1, settlement } = await setupWithDeposit();

      const tooMuch = ethers.parseUnits("1000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));

      await expect(
        pool.connect(settlement).unlockCollateral(fintech1.address, tooMuch, settlementId)
      ).to.be.revertedWith("CollateralPool: Insufficient locked balance");
    });

    it("Should enforce role-based access for lock/unlock", async function () {
      const { pool, fintech1, fintech2 } = await setupWithDeposit();

      const lockAmount = ethers.parseUnits("1000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));

      // Unauthorized lock
      await expect(
        pool.connect(fintech2).lockCollateral(fintech1.address, lockAmount, settlementId)
      ).to.be.reverted;

      // Unauthorized unlock
      await expect(
        pool.connect(fintech2).unlockCollateral(fintech1.address, lockAmount, settlementId)
      ).to.be.reverted;
    });
  });

  describe("Slashing Flow", function () {
    async function setupWithLockedCollateral() {
      const fixture = await deployFixture();
      const { pool, usdc, fintech1, settlement } = fixture;

      // Deposit
      const depositAmount = ethers.parseUnits("15000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await pool.connect(fintech1).deposit(depositAmount);

      // Lock some collateral
      const lockAmount = ethers.parseUnits("5000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-fraud"));
      await pool.connect(settlement).lockCollateral(fintech1.address, lockAmount, settlementId);

      return { ...fixture, depositAmount, lockAmount };
    }

    it("Should slash locked collateral and transfer to treasury", async function () {
      const { pool, usdc, fintech1, slasher, treasury, lockAmount } =
        await setupWithLockedCollateral();

      const slashAmount = ethers.parseUnits("2000", 6);
      const reason = "Fraudulent settlement detected";

      const treasuryBefore = await usdc.balanceOf(treasury.address);
      const tvlBefore = await pool.getTotalValueLocked();

      // Slash
      await expect(pool.connect(slasher).slashCollateral(fintech1.address, slashAmount, reason))
        .to.emit(pool, "CollateralSlashed")
        .withArgs(fintech1.address, slashAmount, reason, lockAmount - slashAmount);

      // Verify balances
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.lockedBalance).to.equal(lockAmount - slashAmount);
      expect(balance.totalSlashed).to.equal(slashAmount);

      // Verify treasury received funds
      expect(await usdc.balanceOf(treasury.address)).to.equal(treasuryBefore + slashAmount);

      // Verify TVL decreased
      const tvlAfter = await pool.getTotalValueLocked();
      expect(tvlAfter).to.equal(tvlBefore - slashAmount);
    });

    it("Should reject slash exceeding locked balance", async function () {
      const { pool, fintech1, slasher, lockAmount } = await setupWithLockedCollateral();

      const tooMuch = lockAmount + 1n;
      const reason = "Over-slash attempt";

      await expect(
        pool.connect(slasher).slashCollateral(fintech1.address, tooMuch, reason)
      ).to.be.revertedWith("CollateralPool: Insufficient locked balance");
    });

    it("Should enforce role-based access for slashing", async function () {
      const { pool, fintech1, fintech2 } = await setupWithLockedCollateral();

      const slashAmount = ethers.parseUnits("1000", 6);
      const reason = "Unauthorized slash";

      await expect(
        pool.connect(fintech2).slashCollateral(fintech1.address, slashAmount, reason)
      ).to.be.reverted;
    });
  });

  describe("Emergency Functions", function () {
    async function setupWithDeposit() {
      const fixture = await deployFixture();
      const { pool, usdc, fintech1 } = fixture;

      const depositAmount = ethers.parseUnits("8000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await pool.connect(fintech1).deposit(depositAmount);

      return { ...fixture, depositAmount };
    }

    it("Should execute emergency withdrawal bypassing delay", async function () {
      const { pool, usdc, admin, fintech1, depositAmount } = await setupWithDeposit();

      const emergencyAmount = ethers.parseUnits("5000", 6);
      const initialBalance = await usdc.balanceOf(fintech1.address);

      // Emergency withdraw
      await expect(pool.connect(admin).emergencyWithdraw(fintech1.address, emergencyAmount))
        .to.emit(pool, "EmergencyWithdrawal")
        .withArgs(admin.address, fintech1.address, emergencyAmount);

      // Verify USDC transferred immediately (no delay)
      expect(await usdc.balanceOf(fintech1.address)).to.equal(initialBalance + emergencyAmount);

      // Verify balance updated
      const balance = await pool.getBalance(fintech1.address);
      expect(balance.availableBalance).to.equal(depositAmount - emergencyAmount);
      expect(balance.totalWithdrawn).to.equal(emergencyAmount);
    });

    it("Should pause and unpause the contract", async function () {
      const { pool, usdc, admin, fintech1 } = await setupWithDeposit();

      // Pause
      await pool.connect(admin).pause();
      expect(await pool.paused()).to.be.true;

      // Deposits should fail when paused
      const depositAmount = ethers.parseUnits("1000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await expect(pool.connect(fintech1).deposit(depositAmount)).to.be.revertedWithCustomError(
        pool,
        "EnforcedPause"
      );

      // Unpause
      await pool.connect(admin).unpause();
      expect(await pool.paused()).to.be.false;

      // Deposits should work again
      await expect(pool.connect(fintech1).deposit(depositAmount)).to.not.be.reverted;
    });

    it("Should enforce role-based access for emergency functions", async function () {
      const { pool, fintech1, fintech2 } = await setupWithDeposit();

      const amount = ethers.parseUnits("1000", 6);

      // Unauthorized emergency withdraw
      await expect(pool.connect(fintech2).emergencyWithdraw(fintech1.address, amount)).to.be
        .reverted;

      // Unauthorized pause
      await expect(pool.connect(fintech2).pause()).to.be.reverted;
    });
  });

  describe("Balance Invariants", function () {
    it("Should maintain TVL = sum of all fintech balances", async function () {
      const { pool, usdc, fintech1, fintech2 } = await deployFixture();

      const deposit1 = ethers.parseUnits("5000", 6);
      const deposit2 = ethers.parseUnits("7000", 6);

      // Fintech1 deposits
      await usdc.connect(fintech1).approve(pool.target, deposit1);
      await pool.connect(fintech1).deposit(deposit1);

      // Fintech2 deposits
      await usdc.connect(fintech2).approve(pool.target, deposit2);
      await pool.connect(fintech2).deposit(deposit2);

      // Verify TVL
      const balance1 = await pool.getBalance(fintech1.address);
      const balance2 = await pool.getBalance(fintech2.address);
      const totalAvailable = balance1.availableBalance + balance2.availableBalance;
      const totalLocked = balance1.lockedBalance + balance2.lockedBalance;

      expect(await pool.getTotalValueLocked()).to.equal(totalAvailable + totalLocked);
    });

    it("Should maintain available + locked = deposited - withdrawn - slashed", async function () {
      const { pool, usdc, fintech1, settlement, slasher } = await deployFixture();

      // Deposit
      const depositAmount = ethers.parseUnits("10000", 6);
      await usdc.connect(fintech1).approve(pool.target, depositAmount);
      await pool.connect(fintech1).deposit(depositAmount);

      // Lock some
      const lockAmount = ethers.parseUnits("3000", 6);
      const settlementId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));
      await pool.connect(settlement).lockCollateral(fintech1.address, lockAmount, settlementId);

      // Slash some
      const slashAmount = ethers.parseUnits("1000", 6);
      await pool.connect(slasher).slashCollateral(fintech1.address, slashAmount, "Test slash");

      // Withdraw some
      const withdrawAmount = ethers.parseUnits("2000", 6);
      await pool.connect(fintech1).requestWithdrawal(withdrawAmount);
      await time.increase(DEFAULT_WITHDRAWAL_DELAY);
      await pool.connect(fintech1).executeWithdrawal();

      // Check invariant
      const balance = await pool.getBalance(fintech1.address);
      const accountedFor =
        balance.availableBalance +
        balance.lockedBalance +
        balance.totalWithdrawn +
        balance.totalSlashed;

      expect(accountedFor).to.equal(balance.totalDeposited);
    });

    it("Should maintain pool USDC balance = TVL", async function () {
      const { pool, usdc, fintech1, fintech2 } = await deployFixture();

      const deposit1 = ethers.parseUnits("4000", 6);
      const deposit2 = ethers.parseUnits("6000", 6);

      // Deposits
      await usdc.connect(fintech1).approve(pool.target, deposit1);
      await pool.connect(fintech1).deposit(deposit1);

      await usdc.connect(fintech2).approve(pool.target, deposit2);
      await pool.connect(fintech2).deposit(deposit2);

      // Verify USDC balance matches TVL
      expect(await usdc.balanceOf(pool.target)).to.equal(await pool.getTotalValueLocked());
    });
  });

  describe("Admin Configuration", function () {
    it("Should update withdrawal delay within bounds", async function () {
      const { pool, admin } = await deployFixture();

      const newDelay = 48n * 60n * 60n; // 48 hours

      await expect(pool.connect(admin).setWithdrawalDelay(newDelay))
        .to.emit(pool, "WithdrawalDelayUpdated")
        .withArgs(DEFAULT_WITHDRAWAL_DELAY, newDelay);

      expect(await pool.withdrawalDelay()).to.equal(newDelay);
    });

    it("Should reject withdrawal delay outside bounds", async function () {
      const { pool, admin } = await deployFixture();

      // Too short (< 1 hour)
      await expect(pool.connect(admin).setWithdrawalDelay(30 * 60)).to.be.revertedWith(
        "CollateralPool: Delay too short"
      );

      // Too long (> 7 days)
      await expect(pool.connect(admin).setWithdrawalDelay(8 * 24 * 60 * 60)).to.be.revertedWith(
        "CollateralPool: Delay too long"
      );
    });

    it("Should update treasury address", async function () {
      const { pool, admin, fintech1 } = await deployFixture();

      await expect(pool.connect(admin).setTreasury(fintech1.address))
        .to.emit(pool, "TreasuryUpdated");

      expect(await pool.treasury()).to.equal(fintech1.address);
    });

    it("Should enforce admin role for configuration", async function () {
      const { pool, fintech1 } = await deployFixture();

      await expect(pool.connect(fintech1).setWithdrawalDelay(3600)).to.be.reverted;
      await expect(pool.connect(fintech1).setTreasury(fintech1.address)).to.be.reverted;
    });
  });
});
