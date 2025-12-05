/**
 * Testnet E2E Demo Script
 *
 * Demonstrates complete payment settlement flow on Paseo testnet:
 * 1. Fintech deposits collateral
 * 2. Fintech creates payment batch
 * 3. Oracles approve batch
 * 4. Merchant claims payment
 */

const { ethers } = require("hardhat");

// Deployed contract addresses on Paseo
const ADDRESSES = {
    usdc: "0x0000053900000000000000000000000000000000",
    collateralPool: "0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9",
    paymentSettlement: "0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174",
    fraudPrevention: "0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f",
    settlementOracle: "0xEB7278C528817fB51c1837Cb0666c02922d542F1",
    governance: "0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260"
};

async function main() {
    console.log("🚀 Starting Tata-Pay E2E Demo on Paseo Testnet\n");

    // Get signers
    const [fintech, oracle1, oracle2, merchant1, merchant2, merchant3] = await ethers.getSigners();

    console.log("👥 Participants:");
    console.log(`   Fintech: ${fintech.address}`);
    console.log(`   Oracle 1: ${oracle1.address}`);
    console.log(`   Oracle 2: ${oracle2.address}`);
    console.log(`   Merchant 1: ${merchant1.address}\n`);

    // Connect to deployed contracts
    const usdc = await ethers.getContractAt("IERC20", ADDRESSES.usdc);
    const collateralPool = await ethers.getContractAt("CollateralPoolUpgradeable", ADDRESSES.collateralPool);
    const settlement = await ethers.getContractAt("PaymentSettlement", ADDRESSES.paymentSettlement);
    const oracle = await ethers.getContractAt("SettlementOracle", ADDRESSES.settlementOracle);

    // Demo parameters
    const depositAmount = ethers.parseUnits("5000", 6); // 5000 USDC
    const merchants = [merchant1.address, merchant2.address, merchant3.address];
    const amounts = [
        ethers.parseUnits("500", 6),   // 500 USDC
        ethers.parseUnits("750", 6),   // 750 USDC
        ethers.parseUnits("250", 6)    // 250 USDC
    ];

    try {
        // Step 0: Prerequisites - Register Oracles
        console.log("🔧 Step 0: Register oracles (if not already registered)\n");

        const minimumStake = ethers.parseEther("1"); // 1 PAS minimum

        // Check if oracle1 is registered
        const oracle1Info = await oracle.oracles(oracle1.address);
        if (!oracle1Info.isRegistered) {
            console.log("   Registering oracle1...");
            const reg1Tx = await oracle.connect(oracle1).registerOracle({ value: minimumStake });
            await reg1Tx.wait();
            console.log(`   ✅ Oracle1 registered`);
        } else {
            console.log(`   ✅ Oracle1 already registered`);
        }

        // Check if oracle2 is registered
        const oracle2Info = await oracle.oracles(oracle2.address);
        if (!oracle2Info.isRegistered) {
            console.log("   Registering oracle2...");
            const reg2Tx = await oracle.connect(oracle2).registerOracle({ value: minimumStake });
            await reg2Tx.wait();
            console.log(`   ✅ Oracle2 registered\n`);
        } else {
            console.log(`   ✅ Oracle2 already registered\n`);
        }

        // Step 1: Deposit Collateral
        console.log("📥 Step 1: Fintech deposits collateral");
        console.log(`   Amount: 5000 USDC`);

        const approveTx = await usdc.connect(fintech).approve(ADDRESSES.collateralPool, depositAmount);
        await approveTx.wait();

        const depositTx = await collateralPool.connect(fintech).deposit(depositAmount);
        const depositReceipt = await depositTx.wait();
        console.log(`   ✅ Tx: ${depositReceipt.hash}`);

        // Check balance (returns tuple: totalDeposited, availableBalance, lockedBalance, totalWithdrawn, totalSlashed)
        const [totalDeposited, availableBalance] = await collateralPool.getBalance(fintech.address);
        console.log(`   Total Deposited: ${ethers.formatUnits(totalDeposited, 6)} USDC`);
        console.log(`   Available: ${ethers.formatUnits(availableBalance, 6)} USDC\n`);

        // Step 2: Create Payment Batch
        console.log("📝 Step 2: Fintech creates payment batch");
        console.log(`   Merchants: ${merchants.length}`);
        console.log(`   Total: 1500 USDC`);

        const createBatchTx = await settlement.connect(fintech).createBatch(merchants, amounts);
        const batchReceipt = await createBatchTx.wait();
        console.log(`   ✅ Tx: ${batchReceipt.hash}`);

        // Extract batchId from event
        const batchCreatedEvent = batchReceipt.logs.find(
            log => {
                try {
                    return settlement.interface.parseLog(log).name === "BatchCreated";
                } catch {
                    return false;
                }
            }
        );
        const batchId = settlement.interface.parseLog(batchCreatedEvent).args.batchId;
        console.log(`   Batch ID: ${batchId}\n`);

        // Verify collateral locked
        const [, , lockedAfterBatch] = await collateralPool.getBalance(fintech.address);
        console.log(`   Locked collateral: ${ethers.formatUnits(lockedAfterBatch, 6)} USDC\n`);

        // Step 3: Oracle 1 Approves
        console.log("✅ Step 3: Oracle 1 approves batch");
        const approve1Tx = await oracle.connect(oracle1).approveBatch(batchId);
        const approve1Receipt = await approve1Tx.wait();
        console.log(`   ✅ Tx: ${approve1Receipt.hash}`);

        let approvalCount = await oracle.batchApprovalCount(batchId);
        const threshold = await oracle.approvalThreshold();
        console.log(`   Approval count: ${approvalCount} / ${threshold}\n`);

        // Step 4: Oracle 2 Approves (Threshold Reached)
        console.log("✅ Step 4: Oracle 2 approves batch (threshold reached)");
        const approve2Tx = await oracle.connect(oracle2).approveBatch(batchId);
        const approve2Receipt = await approve2Tx.wait();
        console.log(`   ✅ Tx: ${approve2Receipt.hash}`);

        approvalCount = await oracle.batchApprovalCount(batchId);
        console.log(`   Approval count: ${approvalCount} / ${threshold}`);

        // Get batch info (returns: fintech, totalAmount, status, merchantCount, claimedCount, createdAt)
        const [, , status, merchantCount, claimedCount] = await settlement.getBatch(batchId);
        const statusNames = ["Pending", "Processing", "Completed", "Failed", "Timeout"];
        console.log(`   Batch status: ${statusNames[status]} (${status})`);
        console.log(`   Merchants: ${merchantCount}, Claimed: ${claimedCount}\n`);

        // Step 5: Merchant Claims Payment
        console.log("💰 Step 5: Merchant 1 claims payment");
        console.log(`   Amount: 500 USDC`);

        const balanceBefore = await usdc.balanceOf(merchant1.address);

        const claimTx = await settlement.connect(merchant1).claimPayment(batchId);
        const claimReceipt = await claimTx.wait();
        console.log(`   ✅ Tx: ${claimReceipt.hash}`);

        const balanceAfter = await usdc.balanceOf(merchant1.address);
        const received = balanceAfter - balanceBefore;
        console.log(`   Merchant received: ${ethers.formatUnits(received, 6)} USDC\n`);

        // Final State Summary
        console.log("📊 Final State:");
        const [finalTotal, finalAvailable, finalLocked] = await collateralPool.getBalance(fintech.address);
        console.log(`   Fintech total: ${ethers.formatUnits(finalTotal, 6)} USDC`);
        console.log(`   Fintech available: ${ethers.formatUnits(finalAvailable, 6)} USDC`);
        console.log(`   Fintech locked: ${ethers.formatUnits(finalLocked, 6)} USDC`);
        console.log(`   Merchant 1 received: ${ethers.formatUnits(received, 6)} USDC\n`);

        // Assertions
        console.log("🔍 Validation:");

        if (finalLocked > 0n) {
            console.log("   ✅ Collateral still locked for remaining merchants");
        } else {
            throw new Error("   ❌ Collateral should still be locked");
        }

        if (received === amounts[0]) {
            console.log("   ✅ Merchant received correct amount");
        } else {
            throw new Error(`   ❌ Merchant amount mismatch: expected ${amounts[0]}, got ${received}`);
        }

        // Status should be Processing (1) or Completed (2)
        if (status === 1n || status === 2n) {
            console.log(`   ✅ Batch status is ${statusNames[status]}`);
        } else {
            throw new Error(`   ❌ Unexpected batch status: ${status}`);
        }

        if (approvalCount >= threshold) {
            console.log(`   ✅ Approval threshold met (${approvalCount}/${threshold})`);
        } else {
            throw new Error(`   ❌ Approval threshold not met (${approvalCount}/${threshold})`);
        }

        console.log("\n✨ Demo completed successfully!");
        console.log("\n📎 View on BlockScout:");
        console.log(`   https://blockscout-passet-hub.parity-testnet.parity.io/address/${ADDRESSES.paymentSettlement}`);

    } catch (error) {
        console.error("\n❌ Demo failed:");
        console.error(error);
        process.exit(1);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
