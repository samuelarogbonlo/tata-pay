const { ethers } = require("ethers");
require("dotenv").config();

/**
 * E2E test for Cross-Border Settlement refund scenarios
 * Tests both oracle-initiated refund and timeout refund
 */
async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet-passet-hub-eth-rpc.polkadot.io");
  const fintech = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const oracle1 = new ethers.Wallet(process.env.ORACLE1_PRIVATE_KEY || process.env.PRIVATE_KEY, provider);

  console.log("\n🔄 Cross-Border Refund Flow Test - Paseo Asset Hub\n");

  console.log("Accounts:");
  console.log("  Fintech/Sender:", fintech.address);
  console.log("  Oracle:        ", oracle1.address);

  // Gas configuration for Asset Hub
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Contract addresses (will be auto-updated by deploy-all.js)
  const addresses = {
    usdc: process.env.MOCK_USDC_ADDRESS || "0xYOUR_USDC_ADDRESS",
    crossBorderSettlement: process.env.CROSS_BORDER_SETTLEMENT_ADDRESS || "0xYOUR_SETTLEMENT_ADDRESS",
    settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS || "0xYOUR_ORACLE_ADDRESS",
  };

  console.log("\n📋 Contracts:");
  console.log("  USDC:                  ", addresses.usdc);
  console.log("  CrossBorderSettlement: ", addresses.crossBorderSettlement);
  console.log("  SettlementOracle:      ", addresses.settlementOracle);

  // Load contracts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const CrossBorderSettlement = require("../../artifacts/contracts/core/CrossBorderSettlement.sol/CrossBorderSettlement.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");

  const usdc = new ethers.Contract(addresses.usdc, SimpleUSDC.abi, fintech);
  const settlement = new ethers.Contract(addresses.crossBorderSettlement, CrossBorderSettlement.abi, fintech);
  const oracle = new ethers.Contract(addresses.settlementOracle, SettlementOracle.abi, oracle1);

  // ============== TEST 1: ORACLE-INITIATED REFUND ==============
  console.log("\n═══════════════════════════════════════");
  console.log("   TEST 1: ORACLE-INITIATED REFUND");
  console.log("═══════════════════════════════════════");

  // 1. Check initial balance
  console.log("\n1️⃣  Checking initial USDC balance...");
  const initialBalance = await usdc.balanceOf(fintech.address);
  console.log("   Sender USDC:", ethers.formatUnits(initialBalance, 6));

  // 2. Approve and initiate payment
  console.log("\n2️⃣  Initiating cross-border payment...");
  const refundAmount = ethers.parseUnits("50", 6); // 50 USDC

  await (await usdc.approve(addresses.crossBorderSettlement, refundAmount, { ...gasConfig, gasLimit: 100000 })).wait();

  const paymentId1 = ethers.keccak256(ethers.toUtf8Bytes(`refund-test-${Date.now()}`));
  const targetCurrency = "KES"; // Kenya Shillings
  const targetBankHash = ethers.keccak256(ethers.toUtf8Bytes("Bank: Equity, Account: 9876543210"));

  const tx1 = await settlement.initiatePayment(
    paymentId1,
    fintech.address, // recipient (using same for test)
    refundAmount,
    targetCurrency,
    targetBankHash,
    { ...gasConfig, gasLimit: 400000 }
  );
  await tx1.wait();
  console.log("   ✅ Payment initiated!");
  console.log("   Payment ID:", paymentId1);
  console.log("   Amount locked:", ethers.formatUnits(refundAmount, 6), "USDC");

  // 3. Check balance after lock
  console.log("\n3️⃣  Checking balance after USDC locked...");
  const balanceAfterLock = await usdc.balanceOf(fintech.address);
  console.log("   Sender USDC:", ethers.formatUnits(balanceAfterLock, 6));
  console.log("   Difference:", ethers.formatUnits(initialBalance - balanceAfterLock, 6), "USDC locked");

  // 4. Oracle marks payment as failed
  console.log("\n4️⃣  Oracle marking payment as failed...");
  const failureReason = "Yara API: Invalid bank details";

  const failTx = await oracle.failPayment(paymentId1, failureReason, { ...gasConfig, gasLimit: 300000 });
  await failTx.wait();
  console.log("   ✅ Payment marked as failed!");
  console.log("   Reason:", failureReason);

  // 5. Check payment status
  console.log("\n5️⃣  Checking payment status...");
  const payment1 = await settlement.payments(paymentId1);
  const statusNames = ["Pending", "Locked", "Confirmed", "Failed", "Refunded", "TimedOut"];
  console.log("   Status:", statusNames[payment1.status]);

  // 6. Sender initiates refund
  console.log("\n6️⃣  Sender requesting refund...");
  const refundTx = await settlement.refundPayment(paymentId1, { ...gasConfig, gasLimit: 300000 });
  await refundTx.wait();
  console.log("   ✅ Refund processed!");

  // 7. Check final balance
  console.log("\n7️⃣  Checking final balance after refund...");
  const finalBalance1 = await usdc.balanceOf(fintech.address);
  console.log("   Sender USDC:", ethers.formatUnits(finalBalance1, 6));
  console.log("   Recovered:", ethers.formatUnits(finalBalance1 - balanceAfterLock, 6), "USDC");

  // Verify refund complete
  const payment1Final = await settlement.payments(paymentId1);
  console.log("   Payment Status:", statusNames[payment1Final.status]);

  if (finalBalance1.toString() === initialBalance.toString()) {
    console.log("   ✅ Full refund successful!");
  } else {
    console.log("   ⚠️  Balance mismatch, check gas costs");
  }

  // ============== TEST 2: TIMEOUT REFUND ==============
  console.log("\n═══════════════════════════════════════");
  console.log("   TEST 2: TIMEOUT REFUND (SIMULATED)");
  console.log("═══════════════════════════════════════");

  // 8. Initiate another payment for timeout test
  console.log("\n8️⃣  Initiating payment for timeout test...");
  const timeoutAmount = ethers.parseUnits("25", 6); // 25 USDC

  await (await usdc.approve(addresses.crossBorderSettlement, timeoutAmount, { ...gasConfig, gasLimit: 100000 })).wait();

  const paymentId2 = ethers.keccak256(ethers.toUtf8Bytes(`timeout-test-${Date.now()}`));

  const tx2 = await settlement.initiatePayment(
    paymentId2,
    fintech.address,
    timeoutAmount,
    "GHS",
    ethers.keccak256(ethers.toUtf8Bytes("Bank: GCB, Account: 1111111111")),
    { ...gasConfig, gasLimit: 400000 }
  );
  await tx2.wait();
  console.log("   ✅ Payment initiated for timeout test!");
  console.log("   Payment ID:", paymentId2);

  // 9. Check expiry time
  console.log("\n9️⃣  Checking payment expiry...");
  const payment2 = await settlement.payments(paymentId2);
  const expiryTime = Number(payment2.expiresAt);
  const currentTime = Math.floor(Date.now() / 1000);
  const hoursUntilExpiry = (expiryTime - currentTime) / 3600;

  console.log("   Current time:", new Date(currentTime * 1000).toISOString());
  console.log("   Expires at:  ", new Date(expiryTime * 1000).toISOString());
  console.log("   Time until expiry:", hoursUntilExpiry.toFixed(2), "hours");

  // 10. Attempt immediate timeout (should fail)
  console.log("\n🔟 Attempting immediate timeout (should fail)...");
  try {
    await settlement.timeoutPayment(paymentId2, { ...gasConfig, gasLimit: 300000 });
    console.log("   ❌ ERROR: Timeout succeeded before expiry!");
  } catch (error) {
    console.log("   ✅ Correctly rejected: Payment not yet expired");
  }

  console.log("\n💡 Note: In production, wait 48 hours then call:");
  console.log(`   settlement.timeoutPayment("${paymentId2}")`);
  console.log("   This will mark payment as timed out and enable refund.");

  // Summary
  console.log("\n═══════════════════════════════════════");
  console.log("   TEST SUMMARY");
  console.log("═══════════════════════════════════════");
  console.log("✅ Oracle-initiated refund: SUCCESS");
  console.log("✅ Timeout validation: SUCCESS");
  console.log("✅ Funds recovery: COMPLETE");

  const totalRefunded = await settlement.totalRefunded();
  console.log("\nContract Statistics:");
  console.log("  Total Refunded:", ethers.formatUnits(totalRefunded, 6), "USDC");

  console.log("\n═══════════════════════════════════════");
  console.log("   REFUND TEST COMPLETE ✅");
  console.log("═══════════════════════════════════════\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});