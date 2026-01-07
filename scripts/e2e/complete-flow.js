const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet-passet-hub-eth-rpc.polkadot.io");
  const fintech = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const oracle1 = new ethers.Wallet(process.env.ORACLE1_PRIVATE_KEY, provider);
  const merchant1 = new ethers.Wallet(process.env.MERCHANT1_PRIVATE_KEY, provider);

  console.log("\n🎯 Complete E2E Flow - Paseo Asset Hub\n");

  console.log("Accounts:");
  console.log("  Fintech:  ", fintech.address);
  console.log("  Oracle1:  ", oracle1.address);
  console.log("  Merchant1:", merchant1.address);

  // Gas configuration for Asset Hub
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Contract addresses
  const addresses = {
    usdc: "0xd1bBE61C683B339dE9733b928616C1594e770A3c",
    collateralPool: "0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc",
    paymentSettlement: "0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF",
  };

  console.log("\n📋 Contracts:");
  console.log("  USDC:             ", addresses.usdc);
  console.log("  CollateralPool:   ", addresses.collateralPool);
  console.log("  PaymentSettlement:", addresses.paymentSettlement);

  // Load contracts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");

  const usdc = new ethers.Contract(addresses.usdc, SimpleUSDC.abi, fintech);
  const pool = new ethers.Contract(addresses.collateralPool, CollateralPool.abi, fintech);
  const settlement = new ethers.Contract(addresses.paymentSettlement, PaymentSettlement.abi, fintech);

  // 1. Check collateral
  console.log("\n1️⃣  Checking collateral...");
  const balances = await pool.balances(fintech.address);
  console.log(`   Available: ${ethers.formatUnits(balances.availableBalance, 6)} USDC`);
  console.log(`   Locked: ${ethers.formatUnits(balances.lockedBalance, 6)} USDC`);

  // 2. Create batch
  console.log("\n2️⃣  Creating payment batch...");
  const batchData = {
    merchants: [merchant1.address],
    amounts: [ethers.parseUnits("2000", 6)],
  };

  const tx1 = await settlement.createBatch(batchData.merchants, batchData.amounts, { ...gasConfig, gasLimit: 500000 });
  const receipt1 = await tx1.wait();

  // Extract batchId from event
  const batchCreatedEvent = receipt1.logs.find(log => {
    try {
      return settlement.interface.parseLog(log)?.name === "BatchCreated";
    } catch { return false; }
  });
  const batchId = settlement.interface.parseLog(batchCreatedEvent).args.batchId;

  console.log("   ✅ Batch created:", batchId);
  console.log("   Tx:", receipt1.hash);

  // 3. Oracle approves
  console.log("\n3️⃣  Oracle1 approving batch...");
  const settlementAsOracle = new ethers.Contract(addresses.paymentSettlement, PaymentSettlement.abi, oracle1);
  const hasRole = await settlementAsOracle.hasRole(await settlementAsOracle.ORACLE_ROLE(), oracle1.address);
  console.log("   Oracle1 has ORACLE_ROLE:", hasRole);

  const tx2 = await settlementAsOracle.approveBatch(batchId, { ...gasConfig, gasLimit: 300000 });
  const receipt2 = await tx2.wait();
  console.log("   ✅ Batch approved!");
  console.log("   Tx:", receipt2.hash);

  // 4. Merchant claims
  console.log("\n4️⃣  Merchant claiming payment...");
  const settlementAsMerchant = new ethers.Contract(addresses.paymentSettlement, PaymentSettlement.abi, merchant1);
  const usdcAsMerchant = new ethers.Contract(addresses.usdc, SimpleUSDC.abi, merchant1);

  const balanceBefore = await usdcAsMerchant.balanceOf(merchant1.address);
  console.log("   Merchant balance before:", ethers.formatUnits(balanceBefore, 6), "USDC");

  const tx3 = await settlementAsMerchant.claimPayment(batchId, { ...gasConfig, gasLimit: 300000 });
  const receipt3 = await tx3.wait();
  console.log("   ✅ Payment claimed!");
  console.log("   Tx:", receipt3.hash);

  const balanceAfter = await usdcAsMerchant.balanceOf(merchant1.address);
  console.log("   Merchant balance after:", ethers.formatUnits(balanceAfter, 6), "USDC");
  console.log("   Received:", ethers.formatUnits(balanceAfter - balanceBefore, 6), "USDC ✅");

  // 5. Final status
  console.log("\n5️⃣  Final status...");
  const batch = await settlement.batches(batchId);
  const statusNames = ["Pending", "Processing", "Settled", "Failed", "Cancelled", "TimedOut"];
  const statusNum = Number(batch.status);
  console.log("   Batch status:", statusNames[statusNum] || statusNum);
  console.log("   Claimed count:", batch.claimedCount?.toString() || "N/A");
  console.log("   Total amount:", ethers.formatUnits(batch.totalAmount || 0n, 6), "USDC");

  const finalBalances = await pool.balances(fintech.address);
  console.log("   Pool available:", ethers.formatUnits(finalBalances.availableBalance, 6), "USDC");
  console.log("   Pool locked:", ethers.formatUnits(finalBalances.lockedBalance, 6), "USDC");

  console.log("\n═══════════════════════════════════════");
  console.log("   E2E TEST COMPLETE ✅");
  console.log("═══════════════════════════════════════\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
