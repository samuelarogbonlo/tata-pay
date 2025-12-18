const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

/**
 * Oracle Automation Script
 *
 * Monitors PaymentSettlement for pending batches and approves them.
 * Run this script continuously or via cron for automated oracle operations.
 *
 * Prerequisites:
 * - Oracle account must have ORACLE_ROLE on PaymentSettlement
 * - Oracle account must have sufficient DEV tokens for gas
 *
 * Usage:
 *   node scripts/oracle/process-pending-batches.js [network]
 *
 * Example:
 *   node scripts/oracle/process-pending-batches.js moonbase
 */

async function main() {
  const networkName = process.argv[2] || "moonbase";
  const network = networks.getNetwork(networkName);
  const web3 = new Web3(network.rpcUrl);

  // Load oracle account (you can use ORACLE1_PRIVATE_KEY or a dedicated oracle key)
  if (!process.env.ORACLE1_PRIVATE_KEY) {
    console.error("❌ Error: ORACLE1_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  const oracle = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);
  web3.eth.accounts.wallet.add(oracle);

  console.log("\n🔮 TataPay Oracle Automation");
  console.log("Network:", network.name);
  console.log("Oracle:", oracle.address);
  console.log("PaymentSettlement:", network.contracts.paymentSettlement);
  console.log();

  // Load contract
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, network.contracts.paymentSettlement);

  // Verify oracle has ORACLE_ROLE
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  const hasRole = await settlement.methods.hasRole(ORACLE_ROLE, oracle.address).call();

  if (!hasRole) {
    console.error("❌ Error: Oracle does not have ORACLE_ROLE");
    console.error("   Run: node scripts/utils/grant-oracle-role.js");
    process.exit(1);
  }

  console.log("✅ Oracle role verified");
  console.log("\n📡 Listening for pending batches...\n");

  // In production, you would:
  // 1. Listen to BatchCreated events via web3 event subscription
  // 2. Validate batch via external API (Paystack/Flutterwave)
  // 3. Approve or reject batch based on validation

  // For this demo, we'll check for pending batches manually
  // Note: A production system would use event listeners and webhooks

  const interval = 30000; // Check every 30 seconds
  let lastCheck = Date.now();

  setInterval(async () => {
    try {
      const now = Date.now();
      console.log(`[${new Date(now).toISOString()}] Checking for pending batches...`);

      // In a production system, you would:
      // - Listen to BatchCreated events
      // - Query your backend API for payment verification
      // - Call approveBatch() or rejectBatch() based on verification

      // For now, log status
      const balance = await web3.eth.getBalance(oracle.address);
      console.log(`  Oracle balance: ${web3.utils.fromWei(balance, "ether")} ${network.nativeCurrency.symbol}`);

      // Example: Process a specific batch (in production, get from events)
      // const batchId = "0x...";
      // const batch = await settlement.methods.getBatch(batchId).call();
      //
      // if (batch.status === "0") { // Pending
      //   console.log(`  Found pending batch: ${batchId}`);
      //
      //   // Verify batch via external API
      //   const isValid = await verifyBatchWithPaymentProvider(batch);
      //
      //   if (isValid) {
      //     const tx = await settlement.methods.approveBatch(batchId).send({
      //       from: oracle.address,
      //       gas: 500000
      //     });
      //     console.log(`  ✅ Approved batch: ${batchId}`);
      //     console.log(`  Tx: ${tx.transactionHash}`);
      //   } else {
      //     console.log(`  ❌ Batch verification failed: ${batchId}`);
      //   }
      // }

      lastCheck = now;
    } catch (error) {
      console.error("❌ Error:", error.message);
    }
  }, interval);

  console.log(`Monitoring every ${interval / 1000}s. Press Ctrl+C to stop.\n`);
}

// Example payment provider verification (implement based on your provider)
async function verifyBatchWithPaymentProvider(batch) {
  // TODO: Implement actual verification logic
  // - Call Paystack/Flutterwave API
  // - Verify payment status
  // - Return true if valid, false otherwise
  return true;
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
