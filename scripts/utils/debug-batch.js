const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function debug() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  const oracle1 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);

  web3.eth.accounts.wallet.add(deployer);
  web3.eth.accounts.wallet.add(oracle1);

  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, network.contracts.paymentSettlement);

  // Get latest batch by querying recent BatchCreated events
  console.log("\n🔍 Fetching recent batches...\n");

  const currentBlock = await web3.eth.getBlockNumber();
  const events = await settlement.getPastEvents('BatchCreated', {
    fromBlock: currentBlock - 100n,
    toBlock: 'latest'
  });

  if (events.length === 0) {
    console.log("No batches found in last 100 blocks");
    process.exit(1);
  }

  const latestEvent = events[events.length - 1];
  const batchId = latestEvent.returnValues.batchId;

  console.log("Latest Batch ID:", batchId);
  console.log("Block:", latestEvent.blockNumber);

  // Query batch details
  const batch = await settlement.methods.getBatch(batchId).call();
  console.log("\nBatch Details:");
  console.log("  Fintech:", batch.fintech);
  console.log("  Total Amount:", Number(batch.totalAmount) / 1e6, "USDC");
  console.log("  Status:", batch.status, "(0=Pending, 1=Processing, 2=Settled, 3=Cancelled)");
  console.log("  Merchant Count:", batch.merchantCount);
  console.log("  Claimed Count:", batch.claimedCount);
  console.log("  Created At:", batch.createdAt);
  console.log("  Processed At:", batch.processedAt);

  // Check oracle role
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  const hasRole = await settlement.methods.hasRole(ORACLE_ROLE, oracle1.address).call();
  console.log("\nOracle1 has ORACLE_ROLE:", hasRole);

  // Check if paused
  const isPaused = await settlement.methods.paused().call();
  console.log("Contract paused:", isPaused);

  // Try to simulate the approval call
  console.log("\n🧪 Simulating approval call...");
  try {
    await settlement.methods.approveBatch(batchId).call({ from: oracle1.address });
    console.log("✅ Simulation successful - approval should work");

    // Now try actual transaction
    console.log("\n📤 Sending actual approval transaction...");
    const tx = await settlement.methods.approveBatch(batchId).send({
      from: oracle1.address,
      gas: 500000
    });
    console.log("✅ Approval successful!");
    console.log("   Tx:", tx.transactionHash);

  } catch (error) {
    console.log("❌ Simulation failed:");
    console.log("   Error:", error.message.substring(0, 300));

    // Check specific conditions
    console.log("\nChecking conditions:");
    console.log("  Batch exists (createdAt > 0):", batch.createdAt > 0);
    console.log("  Status is Pending:", batch.status === "0");

    const currentTime = Math.floor(Date.now() / 1000);
    const timeout = 48 * 3600; // 48 hours
    const withinTimeout = currentTime <= Number(batch.createdAt) + timeout;
    console.log("  Within timeout:", withinTimeout);
    console.log("    Current time:", currentTime);
    console.log("    Batch created:", batch.createdAt);
    console.log("    Timeout at:", Number(batch.createdAt) + timeout);
  }

  process.exit(0);
}

debug().catch((error) => {
  console.error("\n❌ Debug failed:", error);
  process.exit(1);
});
