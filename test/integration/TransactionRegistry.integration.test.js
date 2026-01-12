const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TransactionRegistry - Integration Tests", function () {
  // Test fixture
  async function deployFixture() {
    const [admin, recorder, disputeHandler, merchant1, merchant2, fintech1, fintech2, unauthorized] =
      await ethers.getSigners();

    // Deploy TransactionRegistry
    const TransactionRegistry = await ethers.getContractFactory("TransactionRegistry");
    const registry = await TransactionRegistry.deploy(admin.address);

    // Grant roles
    const RECORDER_ROLE = await registry.RECORDER_ROLE();
    const DISPUTE_ROLE = await registry.DISPUTE_ROLE();

    await registry.connect(admin).grantRole(RECORDER_ROLE, recorder.address);
    await registry.connect(admin).grantRole(RECORDER_ROLE, fintech1.address);
    await registry.connect(admin).grantRole(RECORDER_ROLE, fintech2.address);
    await registry.connect(admin).grantRole(DISPUTE_ROLE, disputeHandler.address);

    return {
      registry,
      admin,
      recorder,
      disputeHandler,
      merchant1,
      merchant2,
      fintech1,
      fintech2,
      unauthorized,
      RECORDER_ROLE,
      DISPUTE_ROLE,
    };
  }

  describe("Transaction Recording", function () {
    it("Should successfully record a transaction with all fields", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("50000", 0); // 50,000 kobo (500 NGN)
      const currency = "NGN";
      const externalRef = "PAYSTACK_REF_123456";

      // Record transaction
      const tx = await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        amount,
        currency,
        externalRef
      );

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event emission
      await expect(tx)
        .to.emit(registry, "TransactionRecorded")
        .withArgs(
          txId,
          merchant1.address,
          fintech1.address,
          amount,
          currency,
          externalRef,
          block.timestamp
        );

      // Verify stored data
      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.txId).to.equal(ethers.hexlify(txId));
      expect(storedTx.merchant).to.equal(merchant1.address);
      expect(storedTx.fintech).to.equal(fintech1.address);
      expect(storedTx.amount).to.equal(amount);
      expect(storedTx.currency).to.equal(currency);
      expect(storedTx.externalRef).to.equal(externalRef);
      expect(storedTx.status).to.equal(0); // Pending
      expect(storedTx.blockNumber).to.equal(block.number);
      expect(storedTx.createdAt).to.equal(block.timestamp);
      expect(storedTx.updatedAt).to.equal(block.timestamp);

      // Verify metrics
      expect(await registry.totalTransactions()).to.equal(1);
      expect(await registry.exists(txId)).to.be.true;
    });

    it("Should store correct block number for proof generation", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("10000", 0);

      // Record transaction
      const tx = await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        amount,
        "NGN",
        "REF_123"
      );

      const receipt = await tx.wait();
      const blockNumber = receipt.blockNumber;

      // Get proof and verify block number
      const proof = await registry.getTransactionProof(txId);
      expect(proof.blockNumber).to.equal(blockNumber);

      // Verify the proof hash includes block number
      const storedTx = await registry.getTransaction(txId);
      // The contract uses abi.encodePacked, not abi.encode
      const expectedHash = ethers.keccak256(ethers.solidityPacked(
        ["bytes32", "address", "address", "uint256", "string", "string", "uint256", "uint256"],
        [
          txId,
          storedTx.merchant,
          storedTx.fintech,
          storedTx.amount,
          storedTx.currency,
          storedTx.externalRef,
          storedTx.blockNumber,
          storedTx.createdAt
        ]
      ));
      expect(proof.proofHash).to.equal(expectedHash);
    });

    it("Should reject duplicate transaction IDs", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // First recording should succeed
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Second recording with same ID should fail
      await expect(
        registry.connect(fintech1).recordTransaction(
          txId,
          merchant1.address,
          2000,
          "NGN",
          "REF_2"
        )
      ).to.be.revertedWithCustomError(registry, "TransactionExists")
        .withArgs(txId);
    });

    it("Should reject recording from unauthorized address", async function () {
      const { registry, unauthorized, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      await expect(
        registry.connect(unauthorized).recordTransaction(
          txId,
          merchant1.address,
          1000,
          "NGN",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("Should reject invalid parameters", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      // Invalid txId (zero bytes)
      await expect(
        registry.connect(fintech1).recordTransaction(
          ethers.ZeroHash,
          merchant1.address,
          1000,
          "NGN",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidTxId");

      // Invalid merchant (zero address)
      const txId1 = ethers.randomBytes(32);
      await expect(
        registry.connect(fintech1).recordTransaction(
          txId1,
          ethers.ZeroAddress,
          1000,
          "NGN",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidMerchant")
        .withArgs(ethers.ZeroAddress);

      // Invalid amount (zero)
      const txId2 = ethers.randomBytes(32);
      await expect(
        registry.connect(fintech1).recordTransaction(
          txId2,
          merchant1.address,
          0,
          "NGN",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidAmount")
        .withArgs(0);

      // Invalid currency (empty string)
      const txId3 = ethers.randomBytes(32);
      await expect(
        registry.connect(fintech1).recordTransaction(
          txId3,
          merchant1.address,
          1000,
          "",
          "REF_1"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidCurrency")
        .withArgs("");
    });

    it("Should track transactions by merchant", async function () {
      const { registry, fintech1, merchant1, merchant2 } = await deployFixture();

      const txId1 = ethers.randomBytes(32);
      const txId2 = ethers.randomBytes(32);
      const txId3 = ethers.randomBytes(32);

      // Record transactions for merchant1
      await registry.connect(fintech1).recordTransaction(
        txId1,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(fintech1).recordTransaction(
        txId2,
        merchant1.address,
        2000,
        "NGN",
        "REF_2"
      );

      // Record transaction for merchant2
      await registry.connect(fintech1).recordTransaction(
        txId3,
        merchant2.address,
        3000,
        "NGN",
        "REF_3"
      );

      // Check merchant1 transactions
      expect(await registry.getMerchantTransactionCount(merchant1.address)).to.equal(2);
      const merchant1Txs = await registry.getMerchantTransactions(merchant1.address, 0, 10);
      expect(merchant1Txs.length).to.equal(2);
      expect(merchant1Txs[0]).to.equal(ethers.hexlify(txId1));
      expect(merchant1Txs[1]).to.equal(ethers.hexlify(txId2));

      // Check merchant2 transactions
      expect(await registry.getMerchantTransactionCount(merchant2.address)).to.equal(1);
      const merchant2Txs = await registry.getMerchantTransactions(merchant2.address, 0, 10);
      expect(merchant2Txs.length).to.equal(1);
      expect(merchant2Txs[0]).to.equal(ethers.hexlify(txId3));
    });

    it("Should track transactions by fintech", async function () {
      const { registry, fintech1, fintech2, merchant1 } = await deployFixture();

      const txId1 = ethers.randomBytes(32);
      const txId2 = ethers.randomBytes(32);
      const txId3 = ethers.randomBytes(32);

      // Record transactions from fintech1
      await registry.connect(fintech1).recordTransaction(
        txId1,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(fintech1).recordTransaction(
        txId2,
        merchant1.address,
        2000,
        "NGN",
        "REF_2"
      );

      // Record transaction from fintech2
      await registry.connect(fintech2).recordTransaction(
        txId3,
        merchant1.address,
        3000,
        "NGN",
        "REF_3"
      );

      // Check fintech1 transactions
      expect(await registry.getFintechTransactionCount(fintech1.address)).to.equal(2);
      const fintech1Txs = await registry.getFintechTransactions(fintech1.address, 0, 10);
      expect(fintech1Txs.length).to.equal(2);

      // Check fintech2 transactions
      expect(await registry.getFintechTransactionCount(fintech2.address)).to.equal(1);
      const fintech2Txs = await registry.getFintechTransactions(fintech2.address, 0, 10);
      expect(fintech2Txs.length).to.equal(1);
    });
  });

  describe("Status Updates", function () {
    it("Should update status from Pending to Confirmed", async function () {
      const { registry, fintech1, recorder, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Update to Confirmed
      const tx = await registry.connect(recorder).updateStatus(
        txId,
        1, // Confirmed
        "Payment processor confirmed"
      );

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Verify event
      await expect(tx)
        .to.emit(registry, "StatusUpdated")
        .withArgs(
          txId,
          0, // Pending
          1, // Confirmed
          "Payment processor confirmed",
          block.timestamp
        );

      // Verify status change
      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.status).to.equal(1); // Confirmed
      expect(storedTx.updatedAt).to.equal(block.timestamp);
    });

    it("Should update status from Pending to Disputed", async function () {
      const { registry, fintech1, disputeHandler, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Update to Disputed
      await registry.connect(disputeHandler).updateStatus(
        txId,
        2, // Disputed
        "Customer complaint"
      );

      // Verify status and metrics
      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.status).to.equal(2); // Disputed
      expect(await registry.totalDisputed()).to.equal(1);
    });

    it("Should update status from Confirmed to Disputed", async function () {
      const { registry, fintech1, recorder, disputeHandler, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record and confirm transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(recorder).updateStatus(
        txId,
        1, // Confirmed
        "Payment confirmed"
      );

      // Dispute the confirmed transaction
      await registry.connect(disputeHandler).updateStatus(
        txId,
        2, // Disputed
        "Chargeback requested"
      );

      // Verify status
      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.status).to.equal(2); // Disputed
      expect(await registry.totalDisputed()).to.equal(1);
    });

    it("Should update status from Disputed to Resolved", async function () {
      const { registry, fintech1, disputeHandler, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record, dispute, then resolve
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(disputeHandler).updateStatus(
        txId,
        2, // Disputed
        "Customer complaint"
      );

      await registry.connect(disputeHandler).updateStatus(
        txId,
        3, // Resolved
        "Dispute resolved in merchant's favor"
      );

      // Verify status and metrics
      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.status).to.equal(3); // Resolved
      expect(await registry.totalDisputed()).to.equal(1);
      expect(await registry.totalResolved()).to.equal(1);
    });

    it("Should reject invalid status transitions", async function () {
      const { registry, fintech1, recorder, disputeHandler, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Try invalid transition: Pending -> Resolved
      await expect(
        registry.connect(disputeHandler).updateStatus(
          txId,
          3, // Resolved
          "Invalid transition"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition")
        .withArgs(0, 3); // Pending -> Resolved

      // Confirm transaction
      await registry.connect(recorder).updateStatus(
        txId,
        1, // Confirmed
        "Confirmed"
      );

      // Try invalid transition: Confirmed -> Pending
      await expect(
        registry.connect(recorder).updateStatus(
          txId,
          0, // Pending
          "Invalid transition"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition")
        .withArgs(1, 0); // Confirmed -> Pending

      // Try invalid transition: Confirmed -> Resolved
      await expect(
        registry.connect(disputeHandler).updateStatus(
          txId,
          3, // Resolved
          "Invalid transition"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition")
        .withArgs(1, 3); // Confirmed -> Resolved
    });

    it("Should reject status update from unauthorized role", async function () {
      const { registry, fintech1, unauthorized, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Try to confirm without RECORDER_ROLE
      await expect(
        registry.connect(unauthorized).updateStatus(
          txId,
          1, // Confirmed
          "Unauthorized confirmation"
        )
      ).to.be.revertedWith("TransactionRegistry: not recorder");

      // Try to dispute without DISPUTE_ROLE
      await expect(
        registry.connect(unauthorized).updateStatus(
          txId,
          2, // Disputed
          "Unauthorized dispute"
        )
      ).to.be.revertedWith("TransactionRegistry: not dispute handler");
    });

    it("Should reject update for non-existent transaction", async function () {
      const { registry, disputeHandler } = await deployFixture();

      const txId = ethers.randomBytes(32);

      await expect(
        registry.connect(disputeHandler).updateStatus(
          txId,
          2, // Disputed
          "Non-existent"
        )
      ).to.be.revertedWithCustomError(registry, "TransactionNotFound")
        .withArgs(txId);
    });

    it("Should not allow status change from Resolved (final state)", async function () {
      const { registry, fintech1, disputeHandler, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Create and resolve a dispute
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(disputeHandler).updateStatus(txId, 2, "Disputed");
      await registry.connect(disputeHandler).updateStatus(txId, 3, "Resolved");

      // Try to change from Resolved to any other status
      await expect(
        registry.connect(disputeHandler).updateStatus(
          txId,
          2, // Disputed
          "Try to re-dispute"
        )
      ).to.be.revertedWithCustomError(registry, "InvalidStatusTransition")
        .withArgs(3, 2); // Resolved -> Disputed
    });
  });

  describe("Query Functions", function () {
    it("Should return correct transaction proof", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);
      const amount = ethers.parseUnits("25000", 0);
      const currency = "NGN";
      const externalRef = "FLUTTERWAVE_123";

      // Record transaction
      const tx = await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        amount,
        currency,
        externalRef
      );

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      // Get proof
      const proof = await registry.getTransactionProof(txId);

      // Verify proof components
      expect(proof.blockNumber).to.equal(block.number);
      expect(proof.timestamp).to.equal(block.timestamp);

      // Verify proof hash calculation (uses abi.encodePacked)
      const expectedHash = ethers.keccak256(ethers.solidityPacked(
        ["bytes32", "address", "address", "uint256", "string", "string", "uint256", "uint256"],
        [
          txId,
          merchant1.address,
          fintech1.address,
          amount,
          currency,
          externalRef,
          block.number,
          block.timestamp
        ]
      ));
      expect(proof.proofHash).to.equal(expectedHash);
    });

    it("Should paginate merchant transactions correctly", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      // Create 5 transactions
      const txIds = [];
      for (let i = 0; i < 5; i++) {
        const txId = ethers.randomBytes(32);
        txIds.push(txId);
        await registry.connect(fintech1).recordTransaction(
          txId,
          merchant1.address,
          1000 * (i + 1),
          "NGN",
          `REF_${i}`
        );
      }

      // Test pagination
      const page1 = await registry.getMerchantTransactions(merchant1.address, 0, 2);
      expect(page1.length).to.equal(2);
      expect(page1[0]).to.equal(ethers.hexlify(txIds[0]));
      expect(page1[1]).to.equal(ethers.hexlify(txIds[1]));

      const page2 = await registry.getMerchantTransactions(merchant1.address, 2, 2);
      expect(page2.length).to.equal(2);
      expect(page2[0]).to.equal(ethers.hexlify(txIds[2]));
      expect(page2[1]).to.equal(ethers.hexlify(txIds[3]));

      const page3 = await registry.getMerchantTransactions(merchant1.address, 4, 2);
      expect(page3.length).to.equal(1);
      expect(page3[0]).to.equal(ethers.hexlify(txIds[4]));

      // Out of bounds
      const page4 = await registry.getMerchantTransactions(merchant1.address, 10, 2);
      expect(page4.length).to.equal(0);
    });

    it("Should return correct metrics", async function () {
      const { registry, fintech1, recorder, disputeHandler, merchant1 } = await deployFixture();

      // Initial metrics
      let metrics = await registry.getMetrics();
      expect(metrics[0]).to.equal(0); // totalTransactions
      expect(metrics[1]).to.equal(0); // totalDisputed
      expect(metrics[2]).to.equal(0); // totalResolved

      // Record 3 transactions
      for (let i = 0; i < 3; i++) {
        const txId = ethers.randomBytes(32);
        await registry.connect(fintech1).recordTransaction(
          txId,
          merchant1.address,
          1000,
          "NGN",
          `REF_${i}`
        );

        if (i === 1) {
          // Dispute second transaction
          await registry.connect(disputeHandler).updateStatus(txId, 2, "Disputed");
        } else if (i === 2) {
          // Dispute and resolve third transaction
          await registry.connect(disputeHandler).updateStatus(txId, 2, "Disputed");
          await registry.connect(disputeHandler).updateStatus(txId, 3, "Resolved");
        }
      }

      // Final metrics
      metrics = await registry.getMetrics();
      expect(metrics[0]).to.equal(3); // totalTransactions
      expect(metrics[1]).to.equal(2); // totalDisputed
      expect(metrics[2]).to.equal(1); // totalResolved
    });

    it("Should handle empty transaction lists correctly", async function () {
      const { registry, merchant1 } = await deployFixture();

      // Query for non-existent merchant transactions
      const txs = await registry.getMerchantTransactions(merchant1.address, 0, 10);
      expect(txs.length).to.equal(0);

      const count = await registry.getMerchantTransactionCount(merchant1.address);
      expect(count).to.equal(0);
    });

    it("Should revert when querying non-existent transaction", async function () {
      const { registry } = await deployFixture();

      const txId = ethers.randomBytes(32);

      await expect(
        registry.getTransaction(txId)
      ).to.be.revertedWithCustomError(registry, "TransactionNotFound")
        .withArgs(txId);

      await expect(
        registry.getTransactionProof(txId)
      ).to.be.revertedWithCustomError(registry, "TransactionNotFound")
        .withArgs(txId);
    });
  });

  describe("Pause Mechanism", function () {
    it("Should pause and unpause contract", async function () {
      const { registry, admin, fintech1, merchant1 } = await deployFixture();

      const txId1 = ethers.randomBytes(32);
      const txId2 = ethers.randomBytes(32);

      // Record first transaction
      await registry.connect(fintech1).recordTransaction(
        txId1,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Pause contract
      await registry.connect(admin).pause();

      // Try to record while paused
      await expect(
        registry.connect(fintech1).recordTransaction(
          txId2,
          merchant1.address,
          2000,
          "NGN",
          "REF_2"
        )
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");

      // Unpause contract
      await registry.connect(admin).unpause();

      // Should work after unpause
      await registry.connect(fintech1).recordTransaction(
        txId2,
        merchant1.address,
        2000,
        "NGN",
        "REF_2"
      );

      expect(await registry.totalTransactions()).to.equal(2);
    });

    it("Should prevent status updates while paused", async function () {
      const { registry, admin, fintech1, recorder, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      // Pause contract
      await registry.connect(admin).pause();

      // Try to update status while paused
      await expect(
        registry.connect(recorder).updateStatus(
          txId,
          1, // Confirmed
          "Try to confirm while paused"
        )
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });

    it("Should only allow admin to pause/unpause", async function () {
      const { registry, unauthorized } = await deployFixture();

      await expect(
        registry.connect(unauthorized).pause()
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");

      await expect(
        registry.connect(unauthorized).unpause()
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Edge Cases", function () {
    it("Should handle maximum uint256 amounts", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);
      const maxAmount = ethers.MaxUint256;

      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        maxAmount,
        "NGN",
        "MAX_AMOUNT_TEST"
      );

      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.amount).to.equal(maxAmount);
    });

    it("Should handle various currency codes", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const currencies = ["NGN", "GHS", "KES", "USD", "EUR"];

      for (let i = 0; i < currencies.length; i++) {
        const txId = ethers.randomBytes(32);
        await registry.connect(fintech1).recordTransaction(
          txId,
          merchant1.address,
          1000 * (i + 1),
          currencies[i],
          `REF_${currencies[i]}`
        );

        const storedTx = await registry.getTransaction(txId);
        expect(storedTx.currency).to.equal(currencies[i]);
      }

      expect(await registry.totalTransactions()).to.equal(currencies.length);
    });

    it("Should handle long external references", async function () {
      const { registry, fintech1, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);
      const longRef = "PAYSTACK_" + "A".repeat(100) + "_END";

      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        longRef
      );

      const storedTx = await registry.getTransaction(txId);
      expect(storedTx.externalRef).to.equal(longRef);
    });

    it("Should correctly update timestamps on status changes", async function () {
      const { registry, fintech1, recorder, merchant1 } = await deployFixture();

      const txId = ethers.randomBytes(32);

      // Record transaction
      await registry.connect(fintech1).recordTransaction(
        txId,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      const initialTx = await registry.getTransaction(txId);
      const initialTimestamp = initialTx.updatedAt;

      // Wait some time
      await time.increase(3600); // 1 hour

      // Update status
      await registry.connect(recorder).updateStatus(
        txId,
        1, // Confirmed
        "Confirmed after delay"
      );

      const updatedTx = await registry.getTransaction(txId);
      expect(updatedTx.updatedAt).to.be.gt(initialTimestamp);
      expect(updatedTx.createdAt).to.equal(initialTx.createdAt); // createdAt should not change
    });
  });

  describe("Access Control", function () {
    it("Should properly manage role assignments", async function () {
      const { registry, admin, unauthorized, RECORDER_ROLE, DISPUTE_ROLE } = await deployFixture();

      // Check initial role assignments
      expect(await registry.hasRole(RECORDER_ROLE, admin.address)).to.be.true;
      expect(await registry.hasRole(DISPUTE_ROLE, admin.address)).to.be.true;
      expect(await registry.hasRole(RECORDER_ROLE, unauthorized.address)).to.be.false;

      // Grant role
      await registry.connect(admin).grantRole(RECORDER_ROLE, unauthorized.address);
      expect(await registry.hasRole(RECORDER_ROLE, unauthorized.address)).to.be.true;

      // Revoke role
      await registry.connect(admin).revokeRole(RECORDER_ROLE, unauthorized.address);
      expect(await registry.hasRole(RECORDER_ROLE, unauthorized.address)).to.be.false;
    });

    it("Should allow multiple addresses with same role", async function () {
      const { registry, admin, fintech1, fintech2, merchant1, RECORDER_ROLE } = await deployFixture();

      // Both fintechs should have recorder role
      expect(await registry.hasRole(RECORDER_ROLE, fintech1.address)).to.be.true;
      expect(await registry.hasRole(RECORDER_ROLE, fintech2.address)).to.be.true;

      // Both should be able to record
      const txId1 = ethers.randomBytes(32);
      const txId2 = ethers.randomBytes(32);

      await registry.connect(fintech1).recordTransaction(
        txId1,
        merchant1.address,
        1000,
        "NGN",
        "REF_1"
      );

      await registry.connect(fintech2).recordTransaction(
        txId2,
        merchant1.address,
        2000,
        "NGN",
        "REF_2"
      );

      expect(await registry.totalTransactions()).to.equal(2);
    });
  });
});