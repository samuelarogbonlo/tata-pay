const { ethers } = require("hardhat");

/**
 * Deploy SettlementOracle contract to Asset Hub
 *
 * This script deploys the SettlementOracle contract which manages
 * oracle registration and webhook verification for payment settlements.
 *
 * Features:
 * - ECDSA signature verification for webhooks
 * - Oracle registration with staking
 * - Batch approval/rejection via verified webhooks
 * - Multi-oracle consensus with threshold voting
 * - Oracle slashing for malicious behavior
 */

async function main() {
  console.log("\n🚀 Deploying SettlementOracle to Asset Hub...\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("📝 Deployment Details:");
  console.log("─────────────────────────────────────");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} PAS`);
  console.log(`Network: ${network.name}`);
  console.log("");

  // Verify sufficient balance
  if (balance < ethers.parseEther("0.1")) {
    console.log("❌ Insufficient balance for deployment");
    console.log("   Get testnet tokens from:");
    console.log("   https://faucet.polkadot.io/?parachain=1111");
    console.log("");
    process.exit(1);
  }

  // Get PaymentSettlement address
  console.log("⚠️  Prerequisites:");
  console.log("─────────────────────────────────────");
  console.log("This script requires PaymentSettlement to be deployed first.");
  console.log("If not deployed, run: npm run deploy:payment-settlement");
  console.log("");

  const paymentSettlementAddress = process.env.PAYMENT_SETTLEMENT_ADDRESS;

  if (!paymentSettlementAddress) {
    console.log("❌ PaymentSettlement address not provided");
    console.log("   Set PAYMENT_SETTLEMENT_ADDRESS environment variable");
    console.log("   Example: export PAYMENT_SETTLEMENT_ADDRESS=0x...");
    console.log("");
    process.exit(1);
  }

  console.log(`PaymentSettlement: ${paymentSettlementAddress}`);
  console.log("");

  // Configure minimum stake (default: 1 PAS)
  const minimumStake = process.env.ORACLE_MINIMUM_STAKE
    ? ethers.parseEther(process.env.ORACLE_MINIMUM_STAKE)
    : ethers.parseEther("1");

  console.log(`Minimum Oracle Stake: ${ethers.formatEther(minimumStake)} PAS`);
  console.log("");

  console.log("📦 Deploying SettlementOracle...");

  try {
    // Deploy SettlementOracle
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const oracle = await SettlementOracle.deploy(
      paymentSettlementAddress, // PaymentSettlement address
      deployer.address,          // Admin address
      minimumStake               // Minimum stake
    );

    console.log("⏳ Waiting for deployment...");
    await oracle.waitForDeployment();

    const oracleAddress = await oracle.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log(`SettlementOracle: ${oracleAddress}`);
    console.log(`PaymentSettlement: ${paymentSettlementAddress}`);
    console.log(`Admin: ${deployer.address}`);
    console.log("");

    // Verify configuration
    console.log("📋 Configuration:");
    console.log("─────────────────────────────────────");
    const minStake = await oracle.minimumStake();
    const slashAmount = await oracle.slashAmount();
    const threshold = await oracle.approvalThreshold();
    const activeCount = await oracle.activeOracleCount();

    console.log(`Minimum Stake: ${ethers.formatEther(minStake)} PAS`);
    console.log(`Slash Amount: ${ethers.formatEther(slashAmount)} PAS (10%)`);
    console.log(`Approval Threshold: ${threshold} oracle(s)`);
    console.log(`Active Oracles: ${activeCount}`);
    console.log("");

    // Verify roles
    console.log("🔐 Roles:");
    console.log("─────────────────────────────────────");
    const DEFAULT_ADMIN_ROLE = await oracle.DEFAULT_ADMIN_ROLE();
    const ORACLE_MANAGER_ROLE = await oracle.ORACLE_MANAGER_ROLE();
    const EMERGENCY_ROLE = await oracle.EMERGENCY_ROLE();

    const isAdmin = await oracle.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    const isManager = await oracle.hasRole(ORACLE_MANAGER_ROLE, deployer.address);
    const hasEmergency = await oracle.hasRole(EMERGENCY_ROLE, deployer.address);

    console.log(`Admin Role: ${isAdmin ? "✓" : "✗"}`);
    console.log(`Oracle Manager Role: ${isManager ? "✓" : "✗"}`);
    console.log(`Emergency Role: ${hasEmergency ? "✓" : "✗"}`);
    console.log("");
    console.log(`ORACLE_MANAGER_ROLE: ${ethers.hexlify(ORACLE_MANAGER_ROLE)}`);
    console.log(`EMERGENCY_ROLE: ${ethers.hexlify(EMERGENCY_ROLE)}`);
    console.log("");

    // Grant ORACLE_ROLE to SettlementOracle on PaymentSettlement
    console.log("🔗 Granting Permissions...");
    console.log("─────────────────────────────────────");

    const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
    const settlement = PaymentSettlement.attach(paymentSettlementAddress);

    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    const hasOracleRole = await settlement.hasRole(ORACLE_ROLE, oracleAddress);

    if (!hasOracleRole) {
      console.log("Granting ORACLE_ROLE to SettlementOracle on PaymentSettlement...");
      const tx = await settlement.connect(deployer).grantRole(ORACLE_ROLE, oracleAddress);
      await tx.wait();
      console.log("✓ ORACLE_ROLE granted");
    } else {
      console.log("✓ ORACLE_ROLE already granted");
    }
    console.log("");

    // Verify metrics
    console.log("📊 Initial Metrics:");
    console.log("─────────────────────────────────────");
    const [totalApprovals, totalRejections, totalSlashed, activeOracles] =
      await oracle.getMetrics();
    console.log(`Total Approvals: ${totalApprovals}`);
    console.log(`Total Rejections: ${totalRejections}`);
    console.log(`Total Slashed: ${totalSlashed}`);
    console.log(`Active Oracles: ${activeOracles}`);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: network.name,
      chainId: (await ethers.provider.getNetwork()).chainId.toString(),
      contract: "SettlementOracle",
      address: oracleAddress,
      deployer: deployer.address,
      paymentSettlement: paymentSettlementAddress,
      timestamp: new Date().toISOString(),
      configuration: {
        minimumStake: minimumStake.toString(),
        slashAmount: slashAmount.toString(),
        approvalThreshold: Number(threshold),
      },
      roles: {
        admin: deployer.address,
        oracleManagerRole: ethers.hexlify(ORACLE_MANAGER_ROLE),
        emergencyRole: ethers.hexlify(EMERGENCY_ROLE),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    if (network.name === "paseo") {
      console.log(
        `https://blockscout-passet-hub.parity-testnet.parity.io/address/${oracleAddress}`
      );
    }
    console.log("");

    console.log("⚠️  Next Steps:");
    console.log("─────────────────────────────────────");
    console.log("1. Deploy off-chain oracle service with signing key");
    console.log("2. Register oracle(s) by calling registerOracle() with stake:");
    console.log(`   oracleContract.registerOracle({ value: "${ethers.formatEther(minimumStake)}" })`);
    console.log("3. Configure approval threshold if using multiple oracles:");
    console.log(`   oracle.setApprovalThreshold(N)`);
    console.log("4. Set up webhook endpoints for batch approval/rejection");
    console.log("5. Implement ECDSA signature generation in off-chain service");
    console.log("6. Test oracle approval flow with a batch");
    console.log("7. Monitor oracle performance and slash if needed");
    console.log("8. Transfer admin role to multi-sig");
    console.log("");

    console.log("📖 Oracle Signature Format:");
    console.log("─────────────────────────────────────");
    console.log("For approval:");
    console.log("  hash = keccak256(abi.encodePacked(batchId, true, nonce, chainId, oracleAddress))");
    console.log("For rejection:");
    console.log("  hash = keccak256(abi.encodePacked(batchId, false, keccak256(reason), nonce, chainId, oracleAddress))");
    console.log("  signature = ethSignedMessageHash(hash)");
    console.log("");

    console.log("✅ SettlementOracle deployment complete!");

    return { oracle, deploymentInfo };
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
}

// Execute
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Error:", error);
      process.exit(1);
    });
}

module.exports = { main };
