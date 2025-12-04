const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("FraudPrevention - Integration Tests", function () {
  // Constants
  const HOUR = 3600n;
  const DAY = 86400n;

  // Test fixture
  async function deployFixture() {
    const [admin, fraudManager, fintech1, fintech2, merchant1, merchant2] =
      await ethers.getSigners();

    // Deploy FraudPrevention
    const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
    const fraud = await FraudPrevention.deploy(admin.address);

    // Grant roles
    const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
    await fraud.connect(admin).grantRole(FRAUD_MANAGER_ROLE, fraudManager.address);

    return {
      fraud,
      admin,
      fraudManager,
      fintech1,
      fintech2,
      merchant1,
      merchant2,
      FRAUD_MANAGER_ROLE,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct admin and default limits", async function () {
      const { fraud, admin } = await deployFixture();

      const DEFAULT_ADMIN_ROLE = await fraud.DEFAULT_ADMIN_ROLE();
      const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
      const EMERGENCY_ROLE = await fraud.EMERGENCY_ROLE();

      expect(await fraud.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await fraud.hasRole(FRAUD_MANAGER_ROLE, admin.address)).to.be.true;
      expect(await fraud.hasRole(EMERGENCY_ROLE, admin.address)).to.be.true;

      // Verify default limits
      const limits = await fraud.defaultLimits();
      expect(limits.hourlyTransactionLimit).to.equal(10);
      expect(limits.dailyTransactionLimit).to.equal(100);
      expect(limits.hourlyAmountLimit).to.equal(ethers.parseUnits("100000", 6));
      expect(limits.dailyAmountLimit).to.equal(ethers.parseUnits("1000000", 6));
    });
  });

  describe("Blacklist Management", function () {
    it("Should add address to blacklist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      const reason = "Fraudulent activity detected";

      const tx = await fraud.connect(fraudManager).addToBlacklist(fintech1.address, reason);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(fraud, "AddressBlacklisted")
        .withArgs(fintech1.address, reason, fraudManager.address, block.timestamp);

      // Verify blacklist info
      const [isBlacklisted, savedReason, timestamp, blockedBy] = await fraud.getBlacklistInfo(
        fintech1.address
      );
      expect(isBlacklisted).to.be.true;
      expect(savedReason).to.equal(reason);
      expect(timestamp).to.equal(block.timestamp);
      expect(blockedBy).to.equal(fraudManager.address);

      // Verify metrics
      expect(await fraud.totalBlacklisted()).to.equal(1);
    });

    it("Should remove address from blacklist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Test");

      const tx = await fraud.connect(fraudManager).removeFromBlacklist(fintech1.address);

      await expect(tx).to.emit(fraud, "AddressUnblacklisted");

      const [isBlacklisted] = await fraud.getBlacklistInfo(fintech1.address);
      expect(isBlacklisted).to.be.false;
      expect(await fraud.totalBlacklisted()).to.equal(0);
    });

    it("Should reject blacklisted address transaction", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Fraud");

      const amount = ethers.parseUnits("1000", 6);
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);

      expect(valid).to.be.false;
    });

    it("Should reject duplicate blacklist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Fraud");

      await expect(
        fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Fraud again")
      ).to.be.revertedWith("FraudPrevention: Already blacklisted");
    });

    it("Should enforce fraud manager role", async function () {
      const { fraud, fintech1, fintech2 } = await deployFixture();

      await expect(
        fraud.connect(fintech1).addToBlacklist(fintech2.address, "Fraud")
      ).to.be.reverted;
    });
  });

  describe("Whitelist Management", function () {
    it("Should add address to whitelist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      const tx = await fraud.connect(fraudManager).addToWhitelist(fintech1.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(fraud, "AddressWhitelisted")
        .withArgs(fintech1.address, fraudManager.address, block.timestamp);

      expect(await fraud.whitelist(fintech1.address)).to.be.true;
      expect(await fraud.totalWhitelisted()).to.equal(1);
    });

    it("Should remove address from whitelist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToWhitelist(fintech1.address);

      const tx = await fraud.connect(fraudManager).removeFromWhitelist(fintech1.address);

      await expect(tx).to.emit(fraud, "AddressRemovedFromWhitelist");

      expect(await fraud.whitelist(fintech1.address)).to.be.false;
      expect(await fraud.totalWhitelisted()).to.equal(0);
    });

    it("Should bypass velocity limits for whitelisted address", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToWhitelist(fintech1.address);

      // Exceed all limits
      const hugeAmount = ethers.parseUnits("10000000", 6); // 10M USDC

      // Try 20 transactions (exceeds hourly limit of 10)
      for (let i = 0; i < 20; i++) {
        await fraud.validateTransaction(fintech1.address, hugeAmount);
      }

      // Verify all were accepted by checking metrics
      expect(await fraud.totalTransactionsValidated()).to.equal(20);
    });

    it("Should reject duplicate whitelist", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToWhitelist(fintech1.address);

      await expect(
        fraud.connect(fraudManager).addToWhitelist(fintech1.address)
      ).to.be.revertedWith("FraudPrevention: Already whitelisted");
    });
  });

  describe("Velocity Limits - Hourly Transaction Count", function () {
    it("Should allow transactions within hourly limit", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      // Default hourly limit is 10
      for (let i = 0; i < 10; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // Verify window updated
      const window = await fraud.getTransactionWindow(fintech1.address);
      expect(window.hourlyCount).to.equal(10);
      expect(window.hourlyAmount).to.equal(amount * 10n);
    });

    it("Should reject transaction exceeding hourly limit", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      // Hit hourly limit (10 transactions)
      for (let i = 0; i < 10; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // 11th transaction should fail
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);
      expect(valid).to.be.false;

      // Verify metrics
      expect(await fraud.totalViolations()).to.equal(0); // staticCall doesn't increment
    });

    it("Should reset hourly window after 1 hour", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      // Hit hourly limit
      for (let i = 0; i < 10; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // Time travel 1 hour
      await time.increase(HOUR);

      // Should allow new transactions
      await fraud.validateTransaction(fintech1.address, amount);

      // Verify window reset
      const window = await fraud.getTransactionWindow(fintech1.address);
      expect(window.hourlyCount).to.equal(1);
    });
  });

  describe("Velocity Limits - Daily Transaction Count", function () {
    it("Should allow transactions within daily limit", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      // Set custom limits with daily < default hourly to test daily limit
      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        5,  // hourly tx
        20, // daily tx (testing daily specifically)
        ethers.parseUnits("1000000", 6), // hourly amount
        ethers.parseUnits("10000000", 6) // daily amount
      );

      const amount = ethers.parseUnits("1000", 6);

      // Do 20 transactions (within daily limit)
      // Need to time travel every 5 to reset hourly limit
      for (let i = 0; i < 20; i++) {
        if (i > 0 && i % 5 === 0) {
          await time.increase(HOUR); // Reset hourly every 5 transactions
        }
        await fraud.validateTransaction(fintech1.address, amount);
      }

      const window = await fraud.getTransactionWindow(fintech1.address);
      expect(window.dailyCount).to.equal(20);
    });

    it("Should reject transaction exceeding daily limit", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        5,  // hourly
        20, // daily
        ethers.parseUnits("1000000", 6),
        ethers.parseUnits("10000000", 6)
      );

      const amount = ethers.parseUnits("1000", 6);

      // Hit daily limit
      for (let i = 0; i < 20; i++) {
        if (i > 0 && i % 5 === 0) {
          await time.increase(HOUR);
        }
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // 21st should fail (exceeds daily)
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);
      expect(valid).to.be.false;
    });

    it("Should reset daily window after 1 day", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        5,
        20,
        ethers.parseUnits("1000000", 6),
        ethers.parseUnits("10000000", 6)
      );

      const amount = ethers.parseUnits("1000", 6);

      // Hit daily limit
      for (let i = 0; i < 20; i++) {
        if (i > 0 && i % 5 === 0) {
          await time.increase(HOUR);
        }
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // Time travel 1 day
      await time.increase(DAY);

      // Should allow new transactions
      await fraud.validateTransaction(fintech1.address, amount);

      const window = await fraud.getTransactionWindow(fintech1.address);
      expect(window.dailyCount).to.equal(1);
    });
  });

  describe("Velocity Limits - Hourly Amount", function () {
    it("Should reject transaction exceeding hourly amount limit", async function () {
      const { fraud, fintech1 } = await deployFixture();

      // Default hourly amount limit: 100k USDC
      const amount = ethers.parseUnits("50000", 6); // 50k each

      // First two should pass (total 100k)
      await fraud.validateTransaction(fintech1.address, amount);
      await fraud.validateTransaction(fintech1.address, amount);

      // Third should fail (would exceed 100k)
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);
      expect(valid).to.be.false;
    });

    it("Should reset hourly amount after 1 hour", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("100000", 6); // Exactly hourly limit

      await fraud.validateTransaction(fintech1.address, amount);

      // Time travel
      await time.increase(HOUR);

      // Should allow new large transaction
      await fraud.validateTransaction(fintech1.address, amount);

      const window = await fraud.getTransactionWindow(fintech1.address);
      expect(window.hourlyAmount).to.equal(amount);
    });
  });

  describe("Velocity Limits - Daily Amount", function () {
    it("Should reject transaction exceeding daily amount limit", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      // Set custom daily amount limit for testing
      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        100,
        1000,
        ethers.parseUnits("150000", 6),  // hourly
        ethers.parseUnits("200000", 6)   // daily
      );

      const amount = ethers.parseUnits("150000", 6);

      // First should pass
      await fraud.validateTransaction(fintech1.address, amount);

      // Time travel to reset hourly
      await time.increase(HOUR);

      // Second should fail (total 300k exceeds daily limit of 200k)
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);
      expect(valid).to.be.false;
    });

    it("Should reset daily amount after 1 day", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      // Set custom daily limit for clearer testing
      const customDailyLimit = ethers.parseUnits("500000", 6); // 500k USDC
      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        100,
        1000,
        ethers.parseUnits("500000", 6),  // hourly
        customDailyLimit  // daily
      );

      const amount = ethers.parseUnits("500000", 6); // Exactly daily limit

      await fraud.validateTransaction(fintech1.address, amount);

      // Verify we hit the daily limit - cannot do another transaction
      const canTransactBefore = await fraud.validateTransaction.staticCall(fintech1.address, ethers.parseUnits("1", 6));
      expect(canTransactBefore).to.be.false;

      // Time travel 1 day
      await time.increase(DAY);

      // Should allow new large transaction after reset
      await fraud.validateTransaction(fintech1.address, amount);

      // Verify transaction succeeded
      expect(await fraud.totalTransactionsValidated()).to.equal(2);
    });
  });

  describe("Custom Limits", function () {
    it("Should set custom limits for address", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      const tx = await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        5,   // hourly tx
        50,  // daily tx
        ethers.parseUnits("10000", 6),  // hourly amount
        ethers.parseUnits("100000", 6)  // daily amount
      );

      await expect(tx).to.emit(fraud, "CustomLimitsSet");

      const limits = await fraud.getApplicableLimits(fintech1.address);
      expect(limits.hourlyTransactionLimit).to.equal(5);
      expect(limits.dailyTransactionLimit).to.equal(50);
      expect(limits.hourlyAmountLimit).to.equal(ethers.parseUnits("10000", 6));
      expect(limits.dailyAmountLimit).to.equal(ethers.parseUnits("100000", 6));

      expect(await fraud.hasCustomLimits(fintech1.address)).to.be.true;
    });

    it("Should use custom limits instead of default", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      // Set custom hourly limit of 3 (vs default 10)
      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        3,   // hourly tx
        100,
        ethers.parseUnits("100000", 6),
        ethers.parseUnits("1000000", 6)
      );

      const amount = ethers.parseUnits("1000", 6);

      // Should hit custom limit at 3
      for (let i = 0; i < 3; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // 4th should fail (custom limit)
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);
      expect(valid).to.be.false;
    });

    it("Should remove custom limits", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).setCustomLimits(
        fintech1.address,
        3,
        30,
        ethers.parseUnits("10000", 6),
        ethers.parseUnits("100000", 6)
      );

      await fraud.connect(fraudManager).removeCustomLimits(fintech1.address);

      expect(await fraud.hasCustomLimits(fintech1.address)).to.be.false;

      // Should use default limits now
      const limits = await fraud.getApplicableLimits(fintech1.address);
      expect(limits.hourlyTransactionLimit).to.equal(10); // default
    });

    it("Should reject invalid custom limits", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      // Daily < hourly
      await expect(
        fraud.connect(fraudManager).setCustomLimits(
          fintech1.address,
          10, // hourly
          5,  // daily (invalid: < hourly)
          ethers.parseUnits("10000", 6),
          ethers.parseUnits("100000", 6)
        )
      ).to.be.revertedWith("FraudPrevention: Daily must be >= hourly");
    });
  });

  describe("Default Limits", function () {
    it("Should update default limits", async function () {
      const { fraud, fraudManager } = await deployFixture();

      const tx = await fraud.connect(fraudManager).setDefaultLimits(
        20,  // hourly tx
        200, // daily tx
        ethers.parseUnits("200000", 6),  // hourly amount
        ethers.parseUnits("2000000", 6)  // daily amount
      );

      await expect(tx).to.emit(fraud, "DefaultLimitsUpdated");

      const limits = await fraud.defaultLimits();
      expect(limits.hourlyTransactionLimit).to.equal(20);
      expect(limits.dailyTransactionLimit).to.equal(200);
    });

    it("Should reject invalid default limits", async function () {
      const { fraud, fraudManager } = await deployFixture();

      await expect(
        fraud.connect(fraudManager).setDefaultLimits(
          0,   // invalid
          100,
          ethers.parseUnits("10000", 6),
          ethers.parseUnits("100000", 6)
        )
      ).to.be.revertedWith("FraudPrevention: Invalid hourly tx limit");
    });
  });

  describe("Emergency Freeze", function () {
    it("Should freeze address", async function () {
      const { fraud, admin, fintech1 } = await deployFixture();

      const tx = await fraud.connect(admin).freezeAddress(fintech1.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(fraud, "AddressFrozen")
        .withArgs(fintech1.address, admin.address, block.timestamp);

      expect(await fraud.frozen(fintech1.address)).to.be.true;
    });

    it("Should reject transactions from frozen address", async function () {
      const { fraud, admin, fintech1 } = await deployFixture();

      await fraud.connect(admin).freezeAddress(fintech1.address);

      const amount = ethers.parseUnits("1000", 6);
      const valid = await fraud.validateTransaction.staticCall(fintech1.address, amount);

      expect(valid).to.be.false;
    });

    it("Should unfreeze address", async function () {
      const { fraud, admin, fintech1 } = await deployFixture();

      await fraud.connect(admin).freezeAddress(fintech1.address);
      await fraud.connect(admin).unfreezeAddress(fintech1.address);

      expect(await fraud.frozen(fintech1.address)).to.be.false;

      // Should allow transactions now
      const amount = ethers.parseUnits("1000", 6);
      await fraud.validateTransaction(fintech1.address, amount);

      // Verify transaction was recorded
      expect(await fraud.totalTransactionsValidated()).to.equal(1);
    });

    it("Should enforce emergency role for freeze", async function () {
      const { fraud, fintech1, fintech2 } = await deployFixture();

      await expect(
        fraud.connect(fintech1).freezeAddress(fintech2.address)
      ).to.be.reverted;
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause contract", async function () {
      const { fraud, admin, fintech1 } = await deployFixture();

      await fraud.connect(admin).pause();
      expect(await fraud.paused()).to.be.true;

      // Cannot validate when paused
      const amount = ethers.parseUnits("1000", 6);
      await expect(
        fraud.validateTransaction(fintech1.address, amount)
      ).to.be.revertedWithCustomError(fraud, "EnforcedPause");

      // Unpause
      await fraud.connect(admin).unpause();
      expect(await fraud.paused()).to.be.false;

      // Can validate again
      await expect(fraud.validateTransaction(fintech1.address, amount)).to.not.be.reverted;
    });

    it("Should enforce roles for pause/unpause", async function () {
      const { fraud, fintech1 } = await deployFixture();

      await expect(fraud.connect(fintech1).pause()).to.be.reverted;
      await expect(fraud.connect(fintech1).unpause()).to.be.reverted;
    });
  });

  describe("View Functions", function () {
    it("Should return canTransact status", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      let [allowed, reason] = await fraud.canTransact(fintech1.address, amount);
      expect(allowed).to.be.true;
      expect(reason).to.equal("Valid");
    });

    it("Should return blacklist reason via canTransact", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      const blacklistReason = "Fraudulent activity";
      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, blacklistReason);

      const amount = ethers.parseUnits("1000", 6);
      const [allowed, reason] = await fraud.canTransact(fintech1.address, amount);

      expect(allowed).to.be.false;
      expect(reason).to.equal(blacklistReason);
    });

    it("Should return freeze reason via canTransact", async function () {
      const { fraud, admin, fintech1 } = await deployFixture();

      await fraud.connect(admin).freezeAddress(fintech1.address);

      const amount = ethers.parseUnits("1000", 6);
      const [allowed, reason] = await fraud.canTransact(fintech1.address, amount);

      expect(allowed).to.be.false;
      expect(reason).to.equal("Address frozen");
    });

    it("Should return velocity limit reason via canTransact", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      // Hit hourly limit
      for (let i = 0; i < 10; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      const [allowed, reason] = await fraud.canTransact(fintech1.address, amount);

      expect(allowed).to.be.false;
      expect(reason).to.equal("Hourly transaction limit exceeded");
    });

    it("Should return whitelist status via canTransact", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToWhitelist(fintech1.address);

      const amount = ethers.parseUnits("1000", 6);
      const [allowed, reason] = await fraud.canTransact(fintech1.address, amount);

      expect(allowed).to.be.true;
      expect(reason).to.equal("Whitelisted");
    });

    it("Should return correct metrics", async function () {
      const { fraud, fraudManager, fintech1, fintech2 } = await deployFixture();

      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Fraud");
      await fraud.connect(fraudManager).addToWhitelist(fintech2.address);

      const amount = ethers.parseUnits("1000", 6);
      await fraud.validateTransaction(fintech1.address, amount); // Should fail (blacklist)
      await fraud.validateTransaction(fintech2.address, amount); // Should pass (whitelist)

      const [totalBlacklisted, totalWhitelisted, totalViolations, totalValidated] =
        await fraud.getMetrics();

      expect(totalBlacklisted).to.equal(1);
      expect(totalWhitelisted).to.equal(1);
      expect(totalViolations).to.equal(0); // Blacklist doesn't count as velocity violation
      expect(totalValidated).to.equal(2);
    });
  });

  describe("Event Emissions", function () {
    it("Should emit VelocityLimitExceeded on violation", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      // Hit hourly limit
      for (let i = 0; i < 10; i++) {
        await fraud.validateTransaction(fintech1.address, amount);
      }

      // Next should emit violation event
      await expect(fraud.validateTransaction(fintech1.address, amount))
        .to.emit(fraud, "VelocityLimitExceeded")
        .withArgs(
          fintech1.address,
          "Hourly transaction count",
          10,
          10,
          await time.latest() + 1
        );
    });

    it("Should emit TransactionValidated on success", async function () {
      const { fraud, fintech1 } = await deployFixture();

      const amount = ethers.parseUnits("1000", 6);

      await expect(fraud.validateTransaction(fintech1.address, amount))
        .to.emit(fraud, "TransactionValidated")
        .withArgs(fintech1.address, amount, true, await time.latest() + 1);
    });

    it("Should emit TransactionValidated on failure", async function () {
      const { fraud, fraudManager, fintech1 } = await deployFixture();

      await fraud.connect(fraudManager).addToBlacklist(fintech1.address, "Fraud");

      const amount = ethers.parseUnits("1000", 6);

      await expect(fraud.validateTransaction(fintech1.address, amount))
        .to.emit(fraud, "TransactionValidated")
        .withArgs(fintech1.address, amount, false, await time.latest() + 1);
    });
  });
});
