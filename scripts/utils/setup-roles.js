const { ethers } = require("ethers");
require("dotenv").config();
const networks = require("../../config/networks");

/**
 * Utility script to setup roles for TataPay contracts
 * Run this after deployment to configure additional roles
 */
async function main() {
  const network = networks.getNetwork("paseo");
  const provider = new ethers.JsonRpcProvider(network.rpcUrl);
  const admin = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("\n🔐 Setting up TataPay roles");
  console.log("📍 Admin:", admin.address);

  // Gas configuration for Asset Hub
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Update these addresses after deployment
  const addresses = {
    transactionRegistry: process.env.TRANSACTION_REGISTRY_ADDRESS,
    crossBorderSettlement: process.env.CROSS_BORDER_SETTLEMENT_ADDRESS,
    fraudPrevention: process.env.FRAUD_PREVENTION_ADDRESS,
    settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS,
  };

  // Additional role recipients (add as needed)
  const recipients = {
    recorder: process.env.RECORDER_ADDRESS || admin.address,
    oracle: process.env.ORACLE_ADDRESS || admin.address,
    disputeHandler: process.env.DISPUTE_HANDLER_ADDRESS || admin.address,
    emergencyAdmin: process.env.EMERGENCY_ADMIN_ADDRESS || admin.address,
  };

  // Load artifacts
  const TransactionRegistry = require("../../artifacts/contracts/core/TransactionRegistry.sol/TransactionRegistry.json");
  const CrossBorderSettlement = require("../../artifacts/contracts/core/CrossBorderSettlement.sol/CrossBorderSettlement.json");
  const FraudPrevention = require("../../artifacts/contracts/core/FraudPrevention.sol/FraudPrevention.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");

  // Connect to contracts
  const registry = new ethers.Contract(addresses.transactionRegistry, TransactionRegistry.abi, admin);
  const settlement = new ethers.Contract(addresses.crossBorderSettlement, CrossBorderSettlement.abi, admin);
  const fraud = new ethers.Contract(addresses.fraudPrevention, FraudPrevention.abi, admin);
  const oracle = new ethers.Contract(addresses.settlementOracle, SettlementOracle.abi, admin);

  const delay = () => new Promise(r => setTimeout(r, 3000));

  try {
    // 1. TransactionRegistry roles
    console.log("\n1️⃣  TransactionRegistry roles:");

    if (recipients.recorder !== admin.address) {
      const RECORDER_ROLE = await registry.RECORDER_ROLE();
      const tx1 = await registry.grantRole(RECORDER_ROLE, recipients.recorder, { ...gasConfig, gasLimit: 200000 });
      await tx1.wait();
      console.log("   ✅ RECORDER_ROLE granted to:", recipients.recorder);
      await delay();
    }

    if (recipients.disputeHandler !== admin.address) {
      const DISPUTE_ROLE = await registry.DISPUTE_ROLE();
      const tx2 = await registry.grantRole(DISPUTE_ROLE, recipients.disputeHandler, { ...gasConfig, gasLimit: 200000 });
      await tx2.wait();
      console.log("   ✅ DISPUTE_ROLE granted to:", recipients.disputeHandler);
      await delay();
    }

    // 2. CrossBorderSettlement roles
    console.log("\n2️⃣  CrossBorderSettlement roles:");

    if (recipients.oracle !== admin.address) {
      const ORACLE_ROLE = await settlement.ORACLE_ROLE();
      const tx3 = await settlement.grantRole(ORACLE_ROLE, recipients.oracle, { ...gasConfig, gasLimit: 200000 });
      await tx3.wait();
      console.log("   ✅ ORACLE_ROLE granted to:", recipients.oracle);
      await delay();
    }

    if (recipients.emergencyAdmin !== admin.address) {
      const EMERGENCY_ROLE = await settlement.EMERGENCY_ROLE();
      const tx4 = await settlement.grantRole(EMERGENCY_ROLE, recipients.emergencyAdmin, { ...gasConfig, gasLimit: 200000 });
      await tx4.wait();
      console.log("   ✅ EMERGENCY_ROLE granted to:", recipients.emergencyAdmin);
      await delay();
    }

    // 3. FraudPrevention roles
    console.log("\n3️⃣  FraudPrevention roles:");

    const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
    const hasRole = await fraud.hasRole(FRAUD_MANAGER_ROLE, settlement.target || addresses.crossBorderSettlement);
    if (!hasRole) {
      const tx5 = await fraud.grantRole(FRAUD_MANAGER_ROLE, settlement.target || addresses.crossBorderSettlement, { ...gasConfig, gasLimit: 200000 });
      await tx5.wait();
      console.log("   ✅ FRAUD_MANAGER_ROLE granted to CrossBorderSettlement");
      await delay();
    }

    // 4. SettlementOracle roles
    console.log("\n4️⃣  SettlementOracle roles:");

    const ORACLE_MANAGER_ROLE = await oracle.ORACLE_MANAGER_ROLE();
    if (recipients.oracle !== admin.address) {
      const tx6 = await oracle.grantRole(ORACLE_MANAGER_ROLE, recipients.oracle, { ...gasConfig, gasLimit: 200000 });
      await tx6.wait();
      console.log("   ✅ ORACLE_MANAGER_ROLE granted to:", recipients.oracle);
      await delay();
    }

    console.log("\n✅ All roles configured successfully!\n");

  } catch (error) {
    console.error("\n❌ Error setting up roles:", error);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});