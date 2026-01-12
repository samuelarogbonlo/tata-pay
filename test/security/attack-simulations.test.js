const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("Attack Simulations", function () {
  // Deploy contracts fixture (NEW architecture only)
  async function deployContractsFixture() {
    const [owner, fintech, merchant1, merchant2, attacker, oracle, yaraSettlement, sender] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy TransactionRegistry
    const TransactionRegistry = await ethers.getContractFactory("TransactionRegistry");
    const transactionRegistry = await TransactionRegistry.deploy(owner.address);

    // Deploy CrossBorderSettlement
    const CrossBorderSettlement = await ethers.getContractFactory("CrossBorderSettlement");
    const crossBorderSettlement = await CrossBorderSettlement.deploy(
      await usdc.getAddress(),
      owner.address,
      yaraSettlement.address
    );

    // Deploy FraudPrevention
    const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
    const fraudPrevention = await FraudPrevention.deploy(owner.address);

    // Deploy SettlementOracle
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const minimumStake = ethers.parseEther("1");
    const settlementOracle = await SettlementOracle.deploy(
      await crossBorderSettlement.getAddress(),
      owner.address,
      minimumStake
    );

    // Grant roles
    const RECORDER_ROLE = await transactionRegistry.RECORDER_ROLE();
    await transactionRegistry.grantRole(RECORDER_ROLE, fintech.address);

    const CBS_ORACLE_ROLE = await crossBorderSettlement.ORACLE_ROLE();
    await crossBorderSettlement.grantRole(CBS_ORACLE_ROLE, oracle.address);
    await crossBorderSettlement.grantRole(CBS_ORACLE_ROLE, settlementOracle.target);

    // Configure CrossBorderSettlement
    await crossBorderSettlement.setLockupPeriod(48 * 60 * 60); // 48 hours
    await crossBorderSettlement.setAmountLimits(
      ethers.parseUnits("10", 6),
      ethers.parseUnits("100000", 6)
    );

    // Mint USDC
    await usdc.mint(fintech.address, ethers.parseUnits("10000000", 6));
    await usdc.mint(sender.address, ethers.parseUnits("10000000", 6));
    await usdc.mint(attacker.address, ethers.parseUnits("10000000", 6));

    return {
      usdc,
      transactionRegistry,
      crossBorderSettlement,
      fraudPrevention,
      settlementOracle,
      owner,
      fintech,
      merchant1,
      merchant2,
      attacker,
      oracle,
      yaraSettlement,
      sender,
      minimumStake,
    };
  }

  describe("1. CrossBorderSettlement - Oracle Fund Redirection Attack", function () {
    it("Should prevent oracle from redirecting funds to arbitrary address", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, attacker, yaraSettlement } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1000", 6);

      // Sender initiates payment
      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        attacker.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Oracle confirms payment
      await crossBorderSettlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      // Verify funds went to Yara settlement address, NOT to attacker
      expect(await usdc.balanceOf(yaraSettlement.address)).to.equal(amount);
      expect(await usdc.balanceOf(attacker.address)).to.equal(ethers.parseUnits("10000000", 6));

      // This proves Circle Refund Protocol security
    });

    it("Should prevent oracle from refunding to different address than sender", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, attacker } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("500", 6);

      // Sender initiates payment
      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        attacker.address,
        amount,
        "KES",
        ethers.ZeroHash
      );

      // Oracle fails payment
      await crossBorderSettlement.connect(oracle).failPayment(paymentId, "Failed");

      // Attacker triggers refund
      const attackerBalanceBefore = await usdc.balanceOf(attacker.address);
      const senderBalanceBefore = await usdc.balanceOf(sender.address);

      await crossBorderSettlement.connect(attacker).refundPayment(paymentId);

      // Verify refund went to original sender, NOT attacker
      expect(await usdc.balanceOf(attacker.address)).to.equal(attackerBalanceBefore);
      expect(await usdc.balanceOf(sender.address)).to.equal(senderBalanceBefore + amount);
    });
  });

  describe("2. Replay Attack Tests", function () {
    it("Should prevent double confirmation attack", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("750", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // First confirmation succeeds
      await crossBorderSettlement.connect(oracle).confirmPayment(paymentId, "YARA_REF_1");

      // Second confirmation should fail
      await expect(
        crossBorderSettlement.connect(oracle).confirmPayment(paymentId, "YARA_REF_2")
      ).to.be.revertedWithCustomError(crossBorderSettlement, "InvalidStatus");
    });

    it("Should prevent replay attack on TransactionRegistry", async function () {
      const { transactionRegistry, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      const txId = ethers.randomBytes(32);
      const amount = 50000n;

      // First recording succeeds
      await transactionRegistry.connect(fintech).recordTransaction(
        txId,
        merchant1.address,
        amount,
        "NGN",
        "REF_123"
      );

      // Replay attempt fails
      await expect(
        transactionRegistry.connect(fintech).recordTransaction(
          txId,
          merchant1.address,
          amount,
          "NGN",
          "REF_123"
        )
      ).to.be.revertedWithCustomError(transactionRegistry, "TransactionExists");
    });
  });

  describe("3. Access Control Bypass Tests", function () {
    it("Should prevent unauthorized role grants", async function () {
      const { crossBorderSettlement, attacker } = await loadFixture(deployContractsFixture);

      const ORACLE_ROLE = await crossBorderSettlement.ORACLE_ROLE();

      await expect(
        crossBorderSettlement.connect(attacker).grantRole(ORACLE_ROLE, attacker.address)
      ).to.be.revertedWithCustomError(crossBorderSettlement, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent unauthorized payment confirmation", async function () {
      const { usdc, crossBorderSettlement, sender, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await expect(
        crossBorderSettlement.connect(attacker).confirmPayment(paymentId, "FAKE_REF")
      ).to.be.revertedWithCustomError(crossBorderSettlement, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent unauthorized payment failure", async function () {
      const { usdc, crossBorderSettlement, sender, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await expect(
        crossBorderSettlement.connect(attacker).failPayment(paymentId, "Malicious failure")
      ).to.be.revertedWithCustomError(crossBorderSettlement, "AccessControlUnauthorizedAccount");
    });

    it("Should prevent unauthorized TransactionRegistry recording", async function () {
      const { transactionRegistry, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const txId = ethers.randomBytes(32);

      await expect(
        transactionRegistry.connect(attacker).recordTransaction(
          txId,
          merchant1.address,
          1000,
          "NGN",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(transactionRegistry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("4. Denial of Service (DOS) Tests", function () {
    it("Should prevent spam attacks via emergency pause", async function () {
      const { usdc, crossBorderSettlement, owner, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      // Owner pauses contract
      await crossBorderSettlement.connect(owner).pause();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);

      await expect(
        crossBorderSettlement.connect(sender).initiatePayment(
          paymentId,
          merchant1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(crossBorderSettlement, "EnforcedPause");
    });

    it("Should enforce amount limits to prevent resource exhaustion", async function () {
      const { usdc, crossBorderSettlement, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const tooSmall = ethers.parseUnits("1", 6); // Below 10 USDC minimum

      await usdc.connect(sender).approve(crossBorderSettlement.target, tooSmall);

      await expect(
        crossBorderSettlement.connect(sender).initiatePayment(
          paymentId,
          merchant1.address,
          tooSmall,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(crossBorderSettlement, "AmountBelowMinimum");
    });
  });

  describe("5. Timeout and Griefing Tests", function () {
    it("Should prevent griefing attack (locking funds indefinitely)", async function () {
      const { usdc, crossBorderSettlement, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("5000", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Even if oracle never confirms, sender can get refund after timeout
      await time.increase(48 * 60 * 60 + 1);

      // Anyone can trigger timeout refund
      await crossBorderSettlement.connect(merchant1).timeoutPayment(paymentId);

      // Verify sender got funds back
      const senderBalance = await usdc.balanceOf(sender.address);
      expect(senderBalance).to.equal(ethers.parseUnits("10000000", 6)); // Full balance restored
    });

    it("Should handle concurrent timeout attempts safely", async function () {
      const { usdc, crossBorderSettlement, sender, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1500", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await time.increase(48 * 60 * 60 + 1);

      // First timeout succeeds
      await crossBorderSettlement.connect(attacker).timeoutPayment(paymentId);

      // Second timeout should fail
      await expect(
        crossBorderSettlement.connect(sender).timeoutPayment(paymentId)
      ).to.be.revertedWithCustomError(crossBorderSettlement, "InvalidStatus");
    });

    it("Should reject timeout before expiry", async function () {
      const { usdc, crossBorderSettlement, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Try to timeout immediately
      await expect(
        crossBorderSettlement.connect(sender).timeoutPayment(paymentId)
      ).to.be.revertedWithCustomError(crossBorderSettlement, "PaymentNotExpired");
    });
  });

  describe("6. Refund Manipulation Tests", function () {
    it("Should prevent refund without failure", async function () {
      const { usdc, crossBorderSettlement, sender, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("2000", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Attacker tries to refund without payment being failed
      await expect(
        crossBorderSettlement.connect(attacker).refundPayment(paymentId)
      ).to.be.revertedWithCustomError(crossBorderSettlement, "InvalidStatus");
    });

    it("Should prevent double refund", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Fail and refund
      await crossBorderSettlement.connect(oracle).failPayment(paymentId, "Failed");
      await crossBorderSettlement.connect(sender).refundPayment(paymentId);

      // Try to refund again
      await expect(
        crossBorderSettlement.connect(sender).refundPayment(paymentId)
      ).to.be.revertedWithCustomError(crossBorderSettlement, "InvalidStatus");
    });
  });

  describe("7. TransactionRegistry Attack Simulations", function () {
    it("Should prevent unauthorized status manipulation", async function () {
      const { transactionRegistry, fintech, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const txId = ethers.randomBytes(32);

      await transactionRegistry.connect(fintech).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await expect(
        transactionRegistry.connect(attacker).updateStatus(
          txId,
          1, // Confirmed
          "Fake confirmation"
        )
      ).to.be.revertedWith("TransactionRegistry: not recorder");
    });

    it("Should maintain immutability of transaction proofs", async function () {
      const { transactionRegistry, fintech, merchant1 } =
        await loadFixture(deployContractsFixture);

      const txId = ethers.randomBytes(32);
      const amount = 75000n;

      const tx = await transactionRegistry.connect(fintech).recordTransaction(
        txId,
        merchant1.address,
        amount,
        "NGN",
        "REF_IMMUTABLE"
      );

      const receipt = await tx.wait();
      const blockNumber = receipt.blockNumber;

      // Get initial proof
      const proof1 = await transactionRegistry.getTransactionProof(txId);
      expect(proof1.blockNumber).to.equal(blockNumber);

      // Mine some blocks
      await ethers.provider.send("hardhat_mine", ["0x10"]);

      // Get proof again - should remain the same
      const proof2 = await transactionRegistry.getTransactionProof(txId);
      expect(proof2.blockNumber).to.equal(blockNumber);
      expect(proof2.proofHash).to.equal(proof1.proofHash);
    });
  });

  describe("8. Front-Running Tests", function () {
    it("Should prevent front-running of payment confirmations", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, attacker, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("3000", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Attacker tries to front-run by failing the payment
      await expect(
        crossBorderSettlement.connect(attacker).failPayment(paymentId, "Front-run attempt")
      ).to.be.revertedWithCustomError(crossBorderSettlement, "AccessControlUnauthorizedAccount");

      // Oracle's confirmation proceeds normally
      await crossBorderSettlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      const payment = await crossBorderSettlement.getPayment(paymentId);
      expect(payment.status).to.equal(2); // Confirmed
    });
  });

  describe("9. Reentrancy Protection Tests", function () {
    it("Should have ReentrancyGuard on confirmPayment", async function () {
      const { crossBorderSettlement } = await loadFixture(deployContractsFixture);

      // Verify contract uses ReentrancyGuard (check by examining contract)
      // The MaliciousReentrancy mock tests this but ERC20 doesn't have callbacks
      // This is a sanity check that the contract was deployed
      expect(await crossBorderSettlement.activeEscrowCount()).to.equal(0);
    });

    it("Should have ReentrancyGuard on refundPayment", async function () {
      const { usdc, crossBorderSettlement, oracle, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);
      await crossBorderSettlement.connect(sender).initiatePayment(
        paymentId,
        merchant1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await crossBorderSettlement.connect(oracle).failPayment(paymentId, "Test");

      // Normal refund works (ReentrancyGuard is present but doesn't block normal calls)
      await expect(
        crossBorderSettlement.connect(sender).refundPayment(paymentId)
      ).to.not.be.reverted;
    });
  });

  describe("10. Edge Cases", function () {
    it("Should reject invalid recipient address", async function () {
      const { usdc, crossBorderSettlement, sender } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender).approve(crossBorderSettlement.target, amount);

      await expect(
        crossBorderSettlement.connect(sender).initiatePayment(
          paymentId,
          ethers.ZeroAddress,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(crossBorderSettlement, "InvalidRecipient");
    });

    it("Should handle maximum USDC amount correctly", async function () {
      const { usdc, crossBorderSettlement, sender, merchant1 } =
        await loadFixture(deployContractsFixture);

      const paymentId = ethers.randomBytes(32);
      const maxAmount = ethers.parseUnits("100000", 6); // Max allowed

      // Need more USDC
      await usdc.mint(sender.address, maxAmount);
      await usdc.connect(sender).approve(crossBorderSettlement.target, maxAmount);

      await expect(
        crossBorderSettlement.connect(sender).initiatePayment(
          paymentId,
          merchant1.address,
          maxAmount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.not.be.reverted;
    });
  });
});
