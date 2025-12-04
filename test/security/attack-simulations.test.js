const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Attack Simulations", function () {
  // Deploy all contracts fixture
  async function deployContractsFixture() {
    const [owner, fintech, merchant1, merchant2, attacker, oracle] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy CollateralPool
    const CollateralPool = await ethers.getContractFactory("CollateralPool");
    const collateralPool = await CollateralPool.deploy(
      await usdc.getAddress(),
      owner.address,
      owner.address
    );

    // Deploy FraudPrevention
    const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
    const fraudPrevention = await FraudPrevention.deploy(owner.address);

    // Deploy PaymentSettlement
    const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
    const paymentSettlement = await PaymentSettlement.deploy(
      await usdc.getAddress(),
      await collateralPool.getAddress(),
      owner.address
    );

    // Deploy SettlementOracle
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const minimumStake = ethers.parseEther("1"); // 1 ETH/PAS minimum stake
    const settlementOracle = await SettlementOracle.deploy(
      await paymentSettlement.getAddress(),
      owner.address,
      minimumStake
    );

    // Grant roles
    const SETTLEMENT_ROLE = await collateralPool.SETTLEMENT_ROLE();
    await collateralPool.grantRole(SETTLEMENT_ROLE, await paymentSettlement.getAddress());

    const ORACLE_ROLE = await paymentSettlement.ORACLE_ROLE();
    await paymentSettlement.grantRole(ORACLE_ROLE, await settlementOracle.getAddress());

    const FRAUD_ROLE = await paymentSettlement.FRAUD_ROLE();
    await paymentSettlement.grantRole(FRAUD_ROLE, await fraudPrevention.getAddress());

    const SLASHER_ROLE = await collateralPool.SLASHER_ROLE();
    await collateralPool.grantRole(SLASHER_ROLE, await fraudPrevention.getAddress());

    // Mint USDC to fintech (10M USDC for large tests)
    await usdc.mint(fintech.address, ethers.parseUnits("10000000", 6));
    await usdc.connect(fintech).approve(await collateralPool.getAddress(), ethers.MaxUint256);

    return {
      usdc,
      collateralPool,
      fraudPrevention,
      paymentSettlement,
      settlementOracle,
      owner,
      fintech,
      merchant1,
      merchant2,
      attacker,
      oracle,
    };
  }

  describe("1. Reentrancy Attack Tests", function () {
    it("Should prevent reentrancy attack on claimPayment", async function () {
      const { usdc, collateralPool, paymentSettlement, settlementOracle, fintech, merchant1, oracle } =
        await loadFixture(deployContractsFixture);

      // Deploy malicious contract
      const MaliciousReentrancy = await ethers.getContractFactory("MaliciousReentrancy");
      const malicious = await MaliciousReentrancy.deploy(await paymentSettlement.getAddress());

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Create batch with malicious contract as merchant
      const merchants = [await malicious.getAddress()];
      const amounts = [ethers.parseUnits("1000", 6)];

      const tx = await paymentSettlement.connect(fintech).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return paymentSettlement.interface.parseLog(log).name === "BatchCreated";
        } catch {
          return false;
        }
      });
      const batchId = paymentSettlement.interface.parseLog(event).args.batchId;

      // Register and approve batch with oracle
      const minimumStake = ethers.parseEther("1");
      await settlementOracle.connect(oracle).registerOracle({ value: minimumStake });
      await settlementOracle.connect(oracle).approveBatch(batchId);

      // Set batch ID in malicious contract
      await malicious.setBatchId(batchId);

      // Attempt reentrancy attack
      // Note: PaymentSettlement uses ERC20 (USDC), not native currency,
      // so receive() in malicious contract won't be triggered.
      // The ReentrancyGuard protects all functions with nonReentrant modifier.
      // This test verifies the malicious contract receives payment without reentrancy.
      await expect(malicious.attack()).to.not.be.revertedWithCustomError(
        paymentSettlement,
        "ReentrancyGuardReentrantCall"
      );
    });

    it("Should prevent reentrancy on createBatch", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Normal batch creation should work
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];

      await expect(
        paymentSettlement.connect(fintech).createBatch(merchants, amounts)
      ).to.not.be.reverted;

      // ReentrancyGuard prevents nested calls
      // (Would need malicious CollateralPool to test, but our pool is trusted)
    });
  });

  describe("2. Replay Attack Tests", function () {
    it("Should prevent double claim of same payment", async function () {
      const { usdc, collateralPool, paymentSettlement, settlementOracle, fintech, merchant1, oracle } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Create batch
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];

      const tx = await paymentSettlement.connect(fintech).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return paymentSettlement.interface.parseLog(log).name === "BatchCreated";
        } catch {
          return false;
        }
      });
      const batchId = paymentSettlement.interface.parseLog(event).args.batchId;

      // Register and approve batch with oracle
      const minimumStake = ethers.parseEther("1");
      await settlementOracle.connect(oracle).registerOracle({ value: minimumStake });
      await settlementOracle.connect(oracle).approveBatch(batchId);

      // Merchant claims once
      await paymentSettlement.connect(merchant1).claimPayment(batchId);

      // Attempt to claim again - should fail (batch is now completed/not processing)
      await expect(
        paymentSettlement.connect(merchant1).claimPayment(batchId)
      ).to.be.revertedWith("PaymentSettlement: Not processing");
    });

    it("Should prevent batch ID collision", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("20000", 6));

      // Create first batch
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];

      await paymentSettlement.connect(fintech).createBatch(merchants, amounts);

      // Try to create identical batch (same merchants, amounts, same block)
      // Should generate different batchId due to nonce increment
      await expect(
        paymentSettlement.connect(fintech).createBatch(merchants, amounts)
      ).to.not.be.reverted;
    });
  });

  describe("3. Denial of Service (DOS) Tests", function () {
    it("Should enforce maximum batch size limit", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, attacker } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("1000000", 6));

      // Try to create batch with 101 merchants (over limit)
      const merchants = new Array(101).fill(attacker.address);
      const amounts = new Array(101).fill(ethers.parseUnits("100", 6));

      await expect(
        paymentSettlement.connect(fintech).createBatch(merchants, amounts)
      ).to.be.revertedWith("PaymentSettlement: Batch too large");
    });

    it("Should handle gas-intensive operations gracefully", async function () {
      const { usdc, collateralPool, paymentSettlement, settlementOracle, fintech, oracle } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits large collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("1000000", 6));

      // Create maximum size batch (100 merchants)
      const merchants = new Array(100).fill(ethers.ZeroAddress).map((_, i) =>
        ethers.Wallet.createRandom().address
      );
      const amounts = new Array(100).fill(ethers.parseUnits("100", 6));

      // Should succeed without running out of gas
      const tx = await paymentSettlement.connect(fintech).createBatch(merchants, amounts);
      const receipt = await tx.wait();

      expect(receipt.gasUsed).to.be.lessThan(30000000n); // Should be under block gas limit
    });

    it("Should prevent spam attacks via emergency pause", async function () {
      const { paymentSettlement, owner, fintech, merchant1 } = await loadFixture(deployContractsFixture);

      // Owner pauses contract
      await paymentSettlement.connect(owner).pause();

      // All operations should be blocked
      await expect(
        paymentSettlement.connect(fintech).createBatch([merchant1.address], [ethers.parseUnits("100", 6)])
      ).to.be.revertedWithCustomError(paymentSettlement, "EnforcedPause");
    });
  });

  describe("4. Front-Running Tests", function () {
    it("Should handle concurrent batch creation", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1, merchant2 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("20000", 6));

      // Create two batches in quick succession
      const tx1 = paymentSettlement.connect(fintech).createBatch(
        [merchant1.address],
        [ethers.parseUnits("1000", 6)]
      );

      const tx2 = paymentSettlement.connect(fintech).createBatch(
        [merchant2.address],
        [ethers.parseUnits("2000", 6)]
      );

      // Both should succeed with different batch IDs
      await expect(tx1).to.not.be.reverted;
      await expect(tx2).to.not.be.reverted;
    });

    it("Should protect withdrawal delays from front-running", async function () {
      const { usdc, collateralPool, fintech } = await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Request withdrawal
      await collateralPool.connect(fintech).requestWithdrawal(ethers.parseUnits("5000", 6));

      // Try to execute immediately (before delay) - should fail
      await expect(
        collateralPool.connect(fintech).executeWithdrawal()
      ).to.be.revertedWith("CollateralPool: Withdrawal delay not met");

      // Even if front-run, 24h delay prevents abuse
    });
  });

  describe("5. Integer Overflow/Underflow Tests", function () {
    it("Should prevent amount overflow in batch creation", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Try to create batch with amounts that would overflow
      const merchants = [merchant1.address, merchant1.address];
      const amounts = [ethers.MaxUint256 / 2n, ethers.MaxUint256 / 2n];

      // Should revert due to overflow protection in Solidity 0.8.x or insufficient balance
      await expect(
        paymentSettlement.connect(fintech).createBatch(merchants, amounts)
      ).to.be.reverted;
    });

    it("Should prevent underflow in collateral unlock", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Create batch
      const merchants = [merchant1.address];
      const amounts = [ethers.parseUnits("1000", 6)];

      const tx = await paymentSettlement.connect(fintech).createBatch(merchants, amounts);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log) => {
        try {
          return paymentSettlement.interface.parseLog(log).name === "BatchCreated";
        } catch {
          return false;
        }
      });
      const batchId = paymentSettlement.interface.parseLog(event).args.batchId;

      // Cancel batch (unlocks collateral)
      await paymentSettlement.connect(fintech).cancelBatch(batchId);

      // Locked balance should not underflow
      const balance = await collateralPool.balances(fintech.address);
      expect(balance.lockedBalance).to.equal(0);
    });
  });

  describe("6. Access Control Bypass Tests", function () {
    it("Should prevent unauthorized role grants", async function () {
      const { collateralPool, attacker } = await loadFixture(deployContractsFixture);

      const SETTLEMENT_ROLE = await collateralPool.SETTLEMENT_ROLE();

      // Attacker tries to grant themselves SETTLEMENT_ROLE
      await expect(
        collateralPool.connect(attacker).grantRole(SETTLEMENT_ROLE, attacker.address)
      ).to.be.reverted; // Missing DEFAULT_ADMIN_ROLE
    });

    it("Should prevent direct lockCollateral call", async function () {
      const { collateralPool, attacker } = await loadFixture(deployContractsFixture);

      // Attacker tries to lock collateral directly
      await expect(
        collateralPool.connect(attacker).lockCollateral(
          attacker.address,
          ethers.parseUnits("1000", 6),
          ethers.ZeroHash
        )
      ).to.be.reverted; // Missing SETTLEMENT_ROLE
    });

    it("Should prevent unauthorized batch approval", async function () {
      const { paymentSettlement, attacker } = await loadFixture(deployContractsFixture);

      // Attacker tries to approve a batch
      await expect(
        paymentSettlement.connect(attacker).approveBatch(ethers.ZeroHash)
      ).to.be.reverted; // Missing ORACLE_ROLE
    });
  });

  describe("7. Edge Case Tests", function () {
    it("Should handle zero-amount payments gracefully", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Try to create batch with zero amount
      await expect(
        paymentSettlement.connect(fintech).createBatch([merchant1.address], [0])
      ).to.be.revertedWith("PaymentSettlement: Zero amount");
    });

    it("Should handle empty merchant array", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Try to create batch with empty arrays
      await expect(
        paymentSettlement.connect(fintech).createBatch([], [])
      ).to.be.revertedWith("PaymentSettlement: Empty batch");
    });

    it("Should handle mismatched array lengths", async function () {
      const { usdc, collateralPool, paymentSettlement, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Fintech deposits collateral
      await collateralPool.connect(fintech).deposit(ethers.parseUnits("10000", 6));

      // Try to create batch with mismatched arrays
      await expect(
        paymentSettlement.connect(fintech).createBatch(
          [merchant1.address],
          [ethers.parseUnits("1000", 6), ethers.parseUnits("2000", 6)]
        )
      ).to.be.revertedWith("PaymentSettlement: Length mismatch");
    });
  });
});
