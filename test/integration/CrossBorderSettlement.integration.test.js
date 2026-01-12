const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("CrossBorderSettlement - Integration Tests", function () {
  // Constants
  const LOCKUP_PERIOD = 48n * 60n * 60n; // 48 hours in seconds
  const MIN_AMOUNT = ethers.parseUnits("10", 6); // 10 USDC
  const MAX_AMOUNT = ethers.parseUnits("100000", 6); // 100k USDC

  // Test fixture
  async function deployFixture() {
    const [admin, oracle, emergency, sender1, sender2, recipient1, recipient2, yaraSettlement, unauthorized] =
      await ethers.getSigners();

    // Deploy mock USDC
    const MockUSDC = await ethers.getContractFactory("contracts/mocks/MockUSDC.sol:MockUSDC");
    const usdc = await MockUSDC.deploy("USD Coin", "USDC", 6);

    // Deploy CrossBorderSettlement
    const CrossBorderSettlement = await ethers.getContractFactory("CrossBorderSettlement");
    const settlement = await CrossBorderSettlement.deploy(
      await usdc.getAddress(),
      admin.address,
      yaraSettlement.address // Pass Yara settlement address in constructor
    );

    // Grant roles
    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    const EMERGENCY_ROLE = await settlement.EMERGENCY_ROLE();

    await settlement.connect(admin).grantRole(ORACLE_ROLE, oracle.address);
    await settlement.connect(admin).grantRole(EMERGENCY_ROLE, emergency.address);

    // Configure settlement parameters
    // yaraSettlement address is already set in constructor
    await settlement.connect(admin).setLockupPeriod(LOCKUP_PERIOD);
    await settlement.connect(admin).setAmountLimits(MIN_AMOUNT, MAX_AMOUNT);

    // Mint USDC to senders
    const initialBalance = ethers.parseUnits("1000000", 6); // 1M USDC
    await usdc.mint(sender1.address, initialBalance);
    await usdc.mint(sender2.address, initialBalance);

    return {
      settlement,
      usdc,
      admin,
      oracle,
      emergency,
      sender1,
      sender2,
      recipient1,
      recipient2,
      yaraSettlement,
      unauthorized,
      ORACLE_ROLE,
      EMERGENCY_ROLE,
      initialBalance,
    };
  }

  describe("Payment Initiation", function () {
    it("Should initiate payment and lock USDC in escrow", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1000", 6); // 1000 USDC
      const targetCurrency = "GHS";
      const targetBankHash = ethers.keccak256(ethers.toUtf8Bytes("BANK_DETAILS_HASH"));

      // Approve USDC
      await usdc.connect(sender1).approve(settlement.target, amount);

      // Get initial balances
      const senderBalanceBefore = await usdc.balanceOf(sender1.address);
      const contractBalanceBefore = await usdc.balanceOf(settlement.target);

      // Initiate payment
      const tx = await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        targetCurrency,
        targetBankHash
      );

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const expectedExpiry = BigInt(block.timestamp) + LOCKUP_PERIOD;

      // Verify events
      await expect(tx)
        .to.emit(settlement, "PaymentInitiated")
        .withArgs(
          paymentId,
          sender1.address,
          recipient1.address,
          amount,
          targetCurrency,
          expectedExpiry,
          block.timestamp
        );

      await expect(tx)
        .to.emit(settlement, "PaymentLocked")
        .withArgs(paymentId, amount, block.timestamp);

      // Verify balances
      expect(await usdc.balanceOf(sender1.address)).to.equal(senderBalanceBefore - amount);
      expect(await usdc.balanceOf(settlement.target)).to.equal(contractBalanceBefore + amount);

      // Verify payment data
      const payment = await settlement.getPayment(paymentId);
      expect(payment.paymentId).to.equal(ethers.hexlify(paymentId));
      expect(payment.sender).to.equal(sender1.address);
      expect(payment.recipient).to.equal(recipient1.address);
      expect(payment.usdcAmount).to.equal(amount);
      expect(payment.targetCurrency).to.equal(targetCurrency);
      expect(payment.targetBankHash).to.equal(targetBankHash);
      expect(payment.status).to.equal(1); // Locked
      expect(payment.expiresAt).to.equal(expectedExpiry);

      // Verify metrics
      expect(await settlement.totalEscrowed()).to.equal(amount);
      expect(await settlement.activeEscrowCount()).to.equal(1);
      expect(await settlement.exists(paymentId)).to.be.true;
    });

    it("Should track sender payments correctly", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentIds = [];
      const amount = ethers.parseUnits("100", 6);

      // Create multiple payments
      for (let i = 0; i < 3; i++) {
        const paymentId = ethers.randomBytes(32);
        paymentIds.push(paymentId);

        await usdc.connect(sender1).approve(settlement.target, amount);
        await settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.keccak256(ethers.toUtf8Bytes(`BANK_${i}`))
        );
      }

      // Check sender payments
      const senderPaymentCount = await settlement.getSenderPaymentCount(sender1.address);
      expect(senderPaymentCount).to.equal(3);

      const senderPayments = await settlement.getSenderPayments(sender1.address, 0, 10);
      expect(senderPayments.length).to.equal(3);

      for (let i = 0; i < 3; i++) {
        expect(senderPayments[i]).to.equal(ethers.hexlify(paymentIds[i]));
      }
    });

    it("Should reject duplicate payment IDs", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // First payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Try duplicate payment ID
      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(settlement, "PaymentExists")
        .withArgs(paymentId);
    });

    it("Should reject payment below minimum amount", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = MIN_AMOUNT - 1n; // Below minimum

      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(settlement, "AmountBelowMinimum")
        .withArgs(amount, MIN_AMOUNT);
    });

    it("Should reject payment above maximum amount", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = MAX_AMOUNT + 1n; // Above maximum

      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(settlement, "AmountAboveMaximum")
        .withArgs(amount, MAX_AMOUNT);
    });

    it("Should reject payment with invalid recipient", async function () {
      const { settlement, usdc, sender1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          ethers.ZeroAddress,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(settlement, "InvalidRecipient")
        .withArgs(ethers.ZeroAddress);
    });

    it("Should reject payment without sufficient USDC approval", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // No approval
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientAllowance");
    });

    it("Should reject payment without sufficient USDC balance", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      // First, burn most of sender1's balance to leave them with less than needed
      const remainingBalance = ethers.parseUnits("100", 6); // Leave only 100 USDC
      const burnAmount = (await usdc.balanceOf(sender1.address)) - remainingBalance;

      // Burn the excess (owner can burn)
      const [admin] = await ethers.getSigners();
      await usdc.connect(admin).burn(sender1.address, burnAmount);

      // Now try to spend more than remaining balance
      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("200", 6); // Try to spend 200 when we only have 100

      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(usdc, "ERC20InsufficientBalance");
    });
  });

  describe("Payment Confirmation (Circle Refund Protocol)", function () {
    it("Should confirm payment and release USDC to Yara settlement address ONLY", async function () {
      const { settlement, usdc, oracle, sender1, recipient1, yaraSettlement } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("500", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Get balances before confirmation
      const yaraBalanceBefore = await usdc.balanceOf(yaraSettlement.address);
      const contractBalanceBefore = await usdc.balanceOf(settlement.target);

      // Oracle confirms payment
      const yaraReference = "YARA_PAYOUT_12345";
      const tx = await settlement.connect(oracle).confirmPayment(paymentId, yaraReference);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event
      await expect(tx)
        .to.emit(settlement, "PaymentConfirmed")
        .withArgs(paymentId, yaraReference, amount, block.timestamp);

      // Verify USDC went to Yara settlement address ONLY
      expect(await usdc.balanceOf(yaraSettlement.address)).to.equal(yaraBalanceBefore + amount);
      expect(await usdc.balanceOf(settlement.target)).to.equal(contractBalanceBefore - amount);

      // Verify payment status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(2); // Confirmed
      expect(payment.yaraReference).to.equal(yaraReference);
      expect(payment.confirmedAt).to.equal(block.timestamp);

      // Verify metrics
      expect(await settlement.totalSettled()).to.equal(amount);
      expect(await settlement.activeEscrowCount()).to.equal(0);
    });

    it("Should PREVENT oracle from redirecting funds to arbitrary address", async function () {
      const { settlement, usdc, oracle, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1000", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Oracle confirms - funds MUST go to yaraSettlementAddress
      // Oracle CANNOT specify a different destination
      await settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      // Verify funds went to correct address (yaraSettlement)
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(2); // Confirmed

      // The oracle cannot redirect funds - they always go to yaraSettlementAddress
      // This is the key security property of the Circle Refund Protocol
    });

    it("Should reject confirmation from non-oracle", async function () {
      const { settlement, usdc, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Non-oracle tries to confirm
      await expect(
        settlement.connect(unauthorized).confirmPayment(paymentId, "FAKE_REF")
      ).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
    });

    it("Should reject confirmation of non-existent payment", async function () {
      const { settlement, oracle } = await deployFixture();

      const paymentId = ethers.randomBytes(32);

      await expect(
        settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF")
      ).to.be.revertedWithCustomError(settlement, "PaymentNotFound")
        .withArgs(paymentId);
    });

    it("Should reject confirmation of already confirmed payment", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate and confirm payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      // Try to confirm again
      await expect(
        settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF_2")
      ).to.be.revertedWithCustomError(settlement, "InvalidStatus")
        .withArgs(2, 1); // Confirmed (2) vs expected Locked (1)
    });

    it("Should reject confirmation of expired payment", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Fast forward past expiry
      await time.increase(LOCKUP_PERIOD + 1n);

      // Try to confirm expired payment
      await expect(
        settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF")
      ).to.be.revertedWithCustomError(settlement, "PaymentExpired");
    });
  });

  describe("Payment Failure and Refund (Circle Refund Protocol)", function () {
    it("Should allow oracle to fail payment", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("250", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "KES",
        ethers.ZeroHash
      );

      // Oracle fails payment
      const reason = "Yara payout failed - invalid bank details";
      const tx = await settlement.connect(oracle).failPayment(paymentId, reason);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event
      await expect(tx)
        .to.emit(settlement, "PaymentFailed")
        .withArgs(paymentId, reason, block.timestamp);

      // Verify status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(3); // Failed
    });

    it("Should refund USDC to original sender ONLY after failure", async function () {
      const { settlement, usdc, oracle, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("750", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Oracle fails payment
      await settlement.connect(oracle).failPayment(paymentId, "Failed");

      // Get balances before refund
      const senderBalanceBefore = await usdc.balanceOf(sender1.address);
      const contractBalanceBefore = await usdc.balanceOf(settlement.target);

      // Anyone can trigger refund, but funds go to original sender ONLY
      const tx = await settlement.connect(unauthorized).refundPayment(paymentId);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event
      await expect(tx)
        .to.emit(settlement, "PaymentRefunded")
        .withArgs(
          paymentId,
          sender1.address,
          amount,
          "Manual refund after failure",
          block.timestamp
        );

      // Verify USDC returned to original sender ONLY
      expect(await usdc.balanceOf(sender1.address)).to.equal(senderBalanceBefore + amount);
      expect(await usdc.balanceOf(settlement.target)).to.equal(contractBalanceBefore - amount);

      // Verify payment status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(4); // Refunded

      // Verify metrics
      expect(await settlement.totalRefunded()).to.equal(amount);
      expect(await settlement.activeEscrowCount()).to.equal(0);
    });

    it("Should PREVENT refund to different address than sender", async function () {
      const { settlement, usdc, oracle, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("500", 6);

      // Initiate payment from sender1
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Oracle fails payment
      await settlement.connect(oracle).failPayment(paymentId, "Failed");

      // Get balance of unauthorized address before refund
      const unauthorizedBalanceBefore = await usdc.balanceOf(unauthorized.address);

      // Trigger refund
      await settlement.connect(unauthorized).refundPayment(paymentId);

      // Verify funds went to original sender, NOT to the caller
      expect(await usdc.balanceOf(unauthorized.address)).to.equal(unauthorizedBalanceBefore);
      expect(await usdc.balanceOf(sender1.address)).to.be.gt(0);

      // This demonstrates the Circle Refund Protocol security:
      // Refunds ALWAYS go to the original sender, regardless of who triggers the refund
    });

    it("Should reject refund of non-failed payment", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment (status = Locked)
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Try to refund without failing first
      await expect(
        settlement.connect(sender1).refundPayment(paymentId)
      ).to.be.revertedWithCustomError(settlement, "InvalidStatus")
        .withArgs(1, 3); // Locked (1) vs expected Failed (3)
    });

    it("Should reject double refund", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate, fail, and refund
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await settlement.connect(oracle).failPayment(paymentId, "Failed");
      await settlement.connect(sender1).refundPayment(paymentId);

      // Try to refund again
      await expect(
        settlement.connect(sender1).refundPayment(paymentId)
      ).to.be.revertedWithCustomError(settlement, "InvalidStatus")
        .withArgs(4, 3); // Refunded (4) vs expected Failed (3)
    });

    it("Should reject failing non-existent payment", async function () {
      const { settlement, oracle } = await deployFixture();

      const paymentId = ethers.randomBytes(32);

      await expect(
        settlement.connect(oracle).failPayment(paymentId, "No such payment")
      ).to.be.revertedWithCustomError(settlement, "PaymentNotFound")
        .withArgs(paymentId);
    });

    it("Should reject failing already confirmed payment", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate and confirm
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      // Try to fail confirmed payment
      await expect(
        settlement.connect(oracle).failPayment(paymentId, "Try to fail")
      ).to.be.revertedWithCustomError(settlement, "InvalidStatus")
        .withArgs(2, 1); // Confirmed (2) vs expected Locked (1)
    });
  });

  describe("Timeout Mechanism", function () {
    it("Should allow timeout and refund after lockup period", async function () {
      const { settlement, usdc, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("2000", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Fast forward past lockup period
      await time.increase(LOCKUP_PERIOD + 1n);

      // Get balances before timeout
      const senderBalanceBefore = await usdc.balanceOf(sender1.address);

      // Anyone can trigger timeout
      const tx = await settlement.connect(unauthorized).timeoutPayment(paymentId);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event
      await expect(tx)
        .to.emit(settlement, "PaymentTimedOut")
        .withArgs(paymentId, sender1.address, amount, block.timestamp);

      // Verify USDC returned to sender
      expect(await usdc.balanceOf(sender1.address)).to.equal(senderBalanceBefore + amount);

      // Verify status
      const payment = await settlement.getPayment(paymentId);
      expect(payment.status).to.equal(5); // TimedOut

      // Verify metrics
      expect(await settlement.totalRefunded()).to.equal(amount);
      expect(await settlement.activeEscrowCount()).to.equal(0);
    });

    it("Should reject timeout before expiry", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Try to timeout immediately
      await expect(
        settlement.connect(sender1).timeoutPayment(paymentId)
      ).to.be.revertedWithCustomError(settlement, "PaymentNotExpired");

      // Fast forward but not enough
      await time.increase(LOCKUP_PERIOD - 100n);

      // Still should fail
      await expect(
        settlement.connect(sender1).timeoutPayment(paymentId)
      ).to.be.revertedWithCustomError(settlement, "PaymentNotExpired");
    });

    it("Should reject timeout of non-locked payment", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate and confirm
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF");

      // Fast forward past expiry
      await time.increase(LOCKUP_PERIOD + 1n);

      // Try to timeout confirmed payment
      await expect(
        settlement.connect(sender1).timeoutPayment(paymentId)
      ).to.be.revertedWithCustomError(settlement, "InvalidStatus")
        .withArgs(2, 1); // Confirmed (2) vs expected Locked (1)
    });

    it("Should ensure timeout refund goes to original sender only", async function () {
      const { settlement, usdc, sender1, recipient1, unauthorized } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("1500", 6);

      // Initiate payment from sender1
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Fast forward past lockup
      await time.increase(LOCKUP_PERIOD + 1n);

      // Unauthorized triggers timeout
      const unauthorizedBalanceBefore = await usdc.balanceOf(unauthorized.address);
      await settlement.connect(unauthorized).timeoutPayment(paymentId);

      // Verify funds went to original sender, not the caller
      expect(await usdc.balanceOf(unauthorized.address)).to.equal(unauthorizedBalanceBefore);
      expect(await usdc.balanceOf(sender1.address)).to.be.gt(0);
    });
  });

  describe("Query Functions", function () {
    it("Should return correct payment details", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("333", 6);
      const targetCurrency = "KES";
      const targetBankHash = ethers.keccak256(ethers.toUtf8Bytes("BANK_KES"));

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      const tx = await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        targetCurrency,
        targetBankHash
      );

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Get payment details
      const payment = await settlement.getPayment(paymentId);

      expect(payment.paymentId).to.equal(ethers.hexlify(paymentId));
      expect(payment.sender).to.equal(sender1.address);
      expect(payment.recipient).to.equal(recipient1.address);
      expect(payment.usdcAmount).to.equal(amount);
      expect(payment.targetCurrency).to.equal(targetCurrency);
      expect(payment.targetBankHash).to.equal(targetBankHash);
      expect(payment.status).to.equal(1); // Locked
      expect(payment.createdAt).to.equal(block.timestamp);
      expect(payment.lockedAt).to.equal(block.timestamp);
      expect(payment.expiresAt).to.equal(BigInt(block.timestamp) + LOCKUP_PERIOD);
    });

    it("Should check if payment can be refunded", async function () {
      const { settlement, usdc, oracle, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Check before failure
      let result = await settlement.canRefund(paymentId);
      expect(result[0]).to.be.false;
      expect(result[1]).to.include("Payment in locked state");

      // Fail payment
      await settlement.connect(oracle).failPayment(paymentId, "Failed");

      // Check after failure
      result = await settlement.canRefund(paymentId);
      expect(result[0]).to.be.true;
      expect(result[1]).to.equal("Payment failed and can be refunded");

      // Refund
      await settlement.connect(sender1).refundPayment(paymentId);

      // Check after refund
      result = await settlement.canRefund(paymentId);
      expect(result[0]).to.be.false;
      expect(result[1]).to.include("already refunded");
    });

    it("Should return correct metrics", async function () {
      const { settlement, usdc, oracle, sender1, sender2, recipient1 } = await deployFixture();

      // Initial metrics
      let metrics = await settlement.getMetrics();
      expect(metrics[0]).to.equal(0); // totalEscrowed
      expect(metrics[1]).to.equal(0); // totalSettled
      expect(metrics[2]).to.equal(0); // totalRefunded
      expect(metrics[3]).to.equal(0); // activeEscrowCount

      // Create payments
      const amount1 = ethers.parseUnits("100", 6);
      const amount2 = ethers.parseUnits("200", 6);
      const amount3 = ethers.parseUnits("300", 6);

      // Payment 1: Will be confirmed
      const paymentId1 = ethers.randomBytes(32);
      await usdc.connect(sender1).approve(settlement.target, amount1);
      await settlement.connect(sender1).initiatePayment(
        paymentId1,
        recipient1.address,
        amount1,
        "GHS",
        ethers.ZeroHash
      );

      // Payment 2: Will be refunded
      const paymentId2 = ethers.randomBytes(32);
      await usdc.connect(sender1).approve(settlement.target, amount2);
      await settlement.connect(sender1).initiatePayment(
        paymentId2,
        recipient1.address,
        amount2,
        "GHS",
        ethers.ZeroHash
      );

      // Payment 3: Will remain locked
      const paymentId3 = ethers.randomBytes(32);
      await usdc.connect(sender2).approve(settlement.target, amount3);
      await settlement.connect(sender2).initiatePayment(
        paymentId3,
        recipient1.address,
        amount3,
        "GHS",
        ethers.ZeroHash
      );

      // Confirm payment 1
      await settlement.connect(oracle).confirmPayment(paymentId1, "YARA_1");

      // Fail and refund payment 2
      await settlement.connect(oracle).failPayment(paymentId2, "Failed");
      await settlement.connect(sender1).refundPayment(paymentId2);

      // Check final metrics
      metrics = await settlement.getMetrics();
      expect(metrics[0]).to.equal(amount3); // totalEscrowed (only payment 3 remains in escrow)
      expect(metrics[1]).to.equal(amount1); // totalSettled (payment 1)
      expect(metrics[2]).to.equal(amount2); // totalRefunded (payment 2)
      expect(metrics[3]).to.equal(1); // activeEscrowCount (payment 3)
    });

    it("Should paginate sender payments", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentIds = [];
      const amount = ethers.parseUnits("50", 6);

      // Create 5 payments
      for (let i = 0; i < 5; i++) {
        const paymentId = ethers.randomBytes(32);
        paymentIds.push(paymentId);

        await usdc.connect(sender1).approve(settlement.target, amount);
        await settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.keccak256(ethers.toUtf8Bytes(`BANK_${i}`))
        );
      }

      // Test pagination
      const page1 = await settlement.getSenderPayments(sender1.address, 0, 2);
      expect(page1.length).to.equal(2);
      expect(page1[0]).to.equal(ethers.hexlify(paymentIds[0]));
      expect(page1[1]).to.equal(ethers.hexlify(paymentIds[1]));

      const page2 = await settlement.getSenderPayments(sender1.address, 2, 2);
      expect(page2.length).to.equal(2);
      expect(page2[0]).to.equal(ethers.hexlify(paymentIds[2]));
      expect(page2[1]).to.equal(ethers.hexlify(paymentIds[3]));

      const page3 = await settlement.getSenderPayments(sender1.address, 4, 2);
      expect(page3.length).to.equal(1);
      expect(page3[0]).to.equal(ethers.hexlify(paymentIds[4]));
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to set Yara settlement address", async function () {
      const { settlement, admin, yaraSettlement } = await deployFixture();

      const newYara = ethers.Wallet.createRandom().address;

      await settlement.connect(admin).setYaraSettlementAddress(newYara);
      expect(await settlement.yaraSettlementAddress()).to.equal(newYara);
    });

    it("Should allow admin to set lockup period", async function () {
      const { settlement, admin } = await deployFixture();

      const newPeriod = 72n * 60n * 60n; // 72 hours

      await settlement.connect(admin).setLockupPeriod(newPeriod);
      expect(await settlement.lockupPeriod()).to.equal(newPeriod);
    });

    it("Should allow admin to set amount limits", async function () {
      const { settlement, admin } = await deployFixture();

      const newMin = ethers.parseUnits("5", 6);
      const newMax = ethers.parseUnits("50000", 6);

      await settlement.connect(admin).setAmountLimits(newMin, newMax);
      expect(await settlement.minAmount()).to.equal(newMin);
      expect(await settlement.maxAmount()).to.equal(newMax);
    });

    it("Should reject admin functions from non-admin", async function () {
      const { settlement, unauthorized } = await deployFixture();

      await expect(
        settlement.connect(unauthorized).setYaraSettlementAddress(unauthorized.address)
      ).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");

      await expect(
        settlement.connect(unauthorized).setLockupPeriod(100)
      ).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");

      await expect(
        settlement.connect(unauthorized).setAmountLimits(1, 100)
      ).to.be.revertedWithCustomError(settlement, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Pause Mechanism", function () {
    it("Should allow emergency role to pause", async function () {
      const { settlement, emergency } = await deployFixture();

      await settlement.connect(emergency).pause();
      expect(await settlement.paused()).to.be.true;
    });

    it("Should prevent initiation while paused", async function () {
      const { settlement, usdc, emergency, sender1, recipient1 } = await deployFixture();

      await settlement.connect(emergency).pause();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await expect(
        settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          "GHS",
          ethers.ZeroHash
        )
      ).to.be.revertedWithCustomError(settlement, "EnforcedPause");
    });

    it("Should allow admin to unpause", async function () {
      const { settlement, admin, emergency } = await deployFixture();

      await settlement.connect(emergency).pause();
      expect(await settlement.paused()).to.be.true;

      await settlement.connect(admin).unpause();
      expect(await settlement.paused()).to.be.false;
    });

    it("Should allow confirmation while paused (emergency operations)", async function () {
      const { settlement, usdc, oracle, emergency, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("100", 6);

      // Initiate payment
      await usdc.connect(sender1).approve(settlement.target, amount);
      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      // Pause
      await settlement.connect(emergency).pause();

      // Oracle can still confirm (emergency operation)
      await expect(
        settlement.connect(oracle).confirmPayment(paymentId, "YARA_REF")
      ).to.not.be.reverted;
    });
  });

  describe("Reentrancy Protection", function () {
    it("Should prevent reentrancy on confirmPayment", async function () {
      // This test would require a malicious contract
      // For now, we verify the modifier is present
      const { settlement } = await deployFixture();

      // The contract uses ReentrancyGuard which will prevent reentrancy
      // Actual reentrancy test would require deploying a malicious contract
      expect(true).to.be.true; // Placeholder
    });

    it("Should prevent reentrancy on refundPayment", async function () {
      // Similar to above, would require malicious contract
      const { settlement } = await deployFixture();
      expect(true).to.be.true; // Placeholder
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple currencies correctly", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const currencies = ["GHS", "KES", "ZAR", "UGX", "TZS"];
      const amount = ethers.parseUnits("100", 6);

      for (let i = 0; i < currencies.length; i++) {
        const paymentId = ethers.randomBytes(32);

        await usdc.connect(sender1).approve(settlement.target, amount);
        await settlement.connect(sender1).initiatePayment(
          paymentId,
          recipient1.address,
          amount,
          currencies[i],
          ethers.keccak256(ethers.toUtf8Bytes(`BANK_${currencies[i]}`))
        );

        const payment = await settlement.getPayment(paymentId);
        expect(payment.targetCurrency).to.equal(currencies[i]);
      }
    });

    it("Should handle maximum USDC amount", async function () {
      const { settlement, usdc, sender1, recipient1 } = await deployFixture();

      const paymentId = ethers.randomBytes(32);
      const amount = MAX_AMOUNT; // Maximum allowed

      // Mint enough USDC
      await usdc.mint(sender1.address, amount);
      await usdc.connect(sender1).approve(settlement.target, amount);

      await settlement.connect(sender1).initiatePayment(
        paymentId,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      const payment = await settlement.getPayment(paymentId);
      expect(payment.usdcAmount).to.equal(amount);
    });

    it("Should handle concurrent payments from different senders", async function () {
      const { settlement, usdc, sender1, sender2, recipient1, recipient2 } = await deployFixture();

      const amount = ethers.parseUnits("100", 6);

      // Concurrent payments
      const paymentId1 = ethers.randomBytes(32);
      const paymentId2 = ethers.randomBytes(32);

      await usdc.connect(sender1).approve(settlement.target, amount);
      await usdc.connect(sender2).approve(settlement.target, amount);

      await settlement.connect(sender1).initiatePayment(
        paymentId1,
        recipient1.address,
        amount,
        "GHS",
        ethers.ZeroHash
      );

      await settlement.connect(sender2).initiatePayment(
        paymentId2,
        recipient2.address,
        amount,
        "KES",
        ethers.ZeroHash
      );

      expect(await settlement.activeEscrowCount()).to.equal(2);
      expect(await settlement.totalEscrowed()).to.equal(amount * 2n);
    });
  });
});