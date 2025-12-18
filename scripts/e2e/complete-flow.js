const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function main() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);

  // Load accounts
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  const oracle1 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);
  const merchant1 = web3.eth.accounts.privateKeyToAccount(process.env.MERCHANT1_PRIVATE_KEY);

  web3.eth.accounts.wallet.add(deployer);
  web3.eth.accounts.wallet.add(oracle1);
  web3.eth.accounts.wallet.add(merchant1);

  console.log("\n🎯 Complete E2E Flow - Moonbase Alpha\n");
  console.log("Accounts:");
  console.log("  Fintech:  ", deployer.address);
  console.log("  Oracle1:  ", oracle1.address);
  console.log("  Merchant1:", merchant1.address);

  // Load contracts
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");

  const usdc = new web3.eth.Contract(SimpleUSDC.abi, network.contracts.usdc);
  const pool = new web3.eth.Contract(CollateralPool.abi, network.contracts.collateralPool);
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, network.contracts.paymentSettlement);

  console.log("\n📋 Contracts:");
  console.log("  USDC:             ", network.contracts.usdc);
  console.log("  CollateralPool:   ", network.contracts.collateralPool);
  console.log("  PaymentSettlement:", network.contracts.paymentSettlement);

  // Check collateral
  console.log("\n1️⃣  Checking collateral...");
  const balance = await pool.methods.balances(deployer.address).call();
  console.log(`   Available: ${Number(balance.availableBalance) / 1e6} USDC`);
  console.log(`   Locked: ${Number(balance.lockedBalance) / 1e6} USDC`);

  // STEP 1: Create batch
  console.log("\n2️⃣  Creating payment batch...");
  const PAYMENT_AMOUNT = 2_000 * 1e6; // 2k USDC
  const merchantAddresses = [merchant1.address];
  const amounts = [PAYMENT_AMOUNT.toString()];

  const createReceipt = await settlement.methods.createBatch(
    merchantAddresses,
    amounts
  ).send({
    from: deployer.address,
    gas: 500000
  });

  // Extract batchId from event (NOT hardcoded!)
  const batchId = createReceipt.events.BatchCreated.returnValues.batchId;
  console.log("   ✅ Batch created:", batchId);
  console.log("   Tx:", createReceipt.transactionHash);

  // Verify batch immediately
  const batch = await settlement.methods.getBatch(batchId).call();
  console.log(`   Verified - Fintech: ${batch.fintech}`);
  console.log(`   Verified - Amount: ${Number(batch.totalAmount) / 1e6} USDC`);
  console.log(`   Verified - Status: ${batch.status} (0=Pending)`);

  if (batch.fintech === "0x0000000000000000000000000000000000000000") {
    console.log("\n❌ ERROR: Batch not found after creation!");
    process.exit(1);
  }

  // STEP 2: Oracle approves batch (directly via PaymentSettlement)
  console.log("\n3️⃣  Oracle1 approving batch...");

  // Verify oracle1 has ORACLE_ROLE
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  const hasRole = await settlement.methods.hasRole(ORACLE_ROLE, oracle1.address).call();
  console.log(`   Oracle1 has ORACLE_ROLE: ${hasRole}`);

  if (!hasRole) {
    console.log("\n❌ Oracle1 doesn't have ORACLE_ROLE!");
    console.log("   Run: node scripts/utils/grant-oracle-role.js");
    process.exit(1);
  }

  try {
    const approveTx = await settlement.methods.approveBatch(batchId).send({
      from: oracle1.address,
      gas: 500000
    });

    console.log("   ✅ Batch approved!");
    console.log("   Tx:", approveTx.transactionHash);

    // Check updated status
    const approvedBatch = await settlement.methods.getBatch(batchId).call();
    console.log(`   New status: ${approvedBatch.status} (1=Processing)`);

  } catch (error) {
    console.log("\n❌ Approval FAILED:");
    console.log("   Error:", error.message.substring(0, 200));
    process.exit(1);
  }

  // STEP 3: Merchant claims payment
  console.log("\n4️⃣  Merchant claiming payment...");
  const merchantBalanceBefore = await usdc.methods.balanceOf(merchant1.address).call();
  console.log(`   Merchant balance before: ${Number(merchantBalanceBefore) / 1e6} USDC`);

  try {
    const claimTx = await settlement.methods.claimPayment(batchId).send({
      from: merchant1.address,
      gas: 500000
    });

    console.log("   ✅ Payment claimed!");
    console.log("   Tx:", claimTx.transactionHash);

    const merchantBalanceAfter = await usdc.methods.balanceOf(merchant1.address).call();
    const received = Number(merchantBalanceAfter) - Number(merchantBalanceBefore);
    console.log(`   Merchant balance after: ${Number(merchantBalanceAfter) / 1e6} USDC`);
    console.log(`   Received: ${received / 1e6} USDC ✅`);

  } catch (error) {
    console.log("\n❌ Claim FAILED:");
    console.log("   Error:", error.message.substring(0, 200));
  }

  // Final status
  console.log("\n5️⃣  Final status...");
  const finalBatch = await settlement.methods.getBatch(batchId).call();
  const finalBalance = await pool.methods.balances(deployer.address).call();

  console.log(`   Batch status: ${finalBatch.status}`);
  console.log(`   Claimed: ${finalBatch.claimedCount}/${finalBatch.merchantCount}`);
  console.log(`   Pool available: ${Number(finalBalance.availableBalance) / 1e6} USDC`);
  console.log(`   Pool locked: ${Number(finalBalance.lockedBalance) / 1e6} USDC`);

  console.log("\n═══════════════════════════════════════");
  console.log("   TEST COMPLETE ✅");
  console.log("═══════════════════════════════════════\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Error:", error);
  process.exit(1);
});
