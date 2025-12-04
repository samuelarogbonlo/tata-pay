const { ethers } = require("hardhat");

/**
 * Deploy PaymentSettlement contract to Asset Hub
 *
 * This script deploys the PaymentSettlement contract which handles
 * batch payment processing with oracle approval and merchant claims.
 *
 * Features:
 * - Batch creation with automatic collateral locking
 * - State machine: Pending → Processing → Completed/Failed/Timeout
 * - Pull payment pattern for merchant claims
 * - Maximum 100 merchants per batch
 * - 48-hour settlement timeout
 * - Oracle and fraud role controls
 */

async function main() {
  console.log("\n🚀 Deploying PaymentSettlement to Asset Hub...\n");

  // Asset Hub USDC precompile (Asset ID 1337)
  const USDC_PRECOMPILE = "0x0000053900000000000000000000000000000000";

  // Get deployer
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("📝 Deployment Details:");
  console.log("─────────────────────────────────────");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} PAS`);
  console.log(`Network: ${network.name}`);
  console.log(`USDC Address: ${USDC_PRECOMPILE}`);
  console.log("");

  // Verify sufficient balance
  if (balance < ethers.parseEther("0.1")) {
    console.log("❌ Insufficient balance for deployment");
    console.log("   Get testnet tokens from:");
    console.log("   https://faucet.polkadot.io/?parachain=1111");
    console.log("");
    process.exit(1);
  }

  // Get CollateralPool address (should be deployed first)
  console.log("⚠️  Prerequisites:");
  console.log("─────────────────────────────────────");
  console.log("This script requires CollateralPool to be deployed first.");
  console.log("If not deployed, run: npm run deploy:collateral-pool");
  console.log("");

  // Prompt for CollateralPool address
  const collateralPoolAddress = process.env.COLLATERAL_POOL_ADDRESS;

  if (!collateralPoolAddress) {
    console.log("❌ CollateralPool address not provided");
    console.log("   Set COLLATERAL_POOL_ADDRESS environment variable");
    console.log("   Example: export COLLATERAL_POOL_ADDRESS=0x...");
    console.log("");
    process.exit(1);
  }

  console.log(`CollateralPool: ${collateralPoolAddress}`);
  console.log("");

  console.log("📦 Deploying PaymentSettlement...");

  try {
    // Deploy PaymentSettlement
    const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
    const settlement = await PaymentSettlement.deploy(
      USDC_PRECOMPILE,          // USDC token address
      collateralPoolAddress,    // CollateralPool address
      deployer.address          // Admin address
    );

    console.log("⏳ Waiting for deployment...");
    await settlement.waitForDeployment();

    const settlementAddress = await settlement.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log(`PaymentSettlement: ${settlementAddress}`);
    console.log(`CollateralPool: ${collateralPoolAddress}`);
    console.log(`Admin: ${deployer.address}`);
    console.log("");

    // Verify configuration
    console.log("📋 Configuration:");
    console.log("─────────────────────────────────────");
    const maxBatchSize = await settlement.MAX_BATCH_SIZE();
    const settlementTimeout = await settlement.SETTLEMENT_TIMEOUT();
    const usdcAddress = await settlement.USDC();
    const poolAddress = await settlement.collateralPool();

    console.log(`Max Batch Size: ${maxBatchSize} merchants`);
    console.log(`Settlement Timeout: ${Number(settlementTimeout) / 3600} hours`);
    console.log(`USDC Address: ${usdcAddress}`);
    console.log(`CollateralPool: ${poolAddress}`);
    console.log("");

    // Verify roles
    console.log("🔐 Roles:");
    console.log("─────────────────────────────────────");
    const DEFAULT_ADMIN_ROLE = await settlement.DEFAULT_ADMIN_ROLE();
    const ORACLE_ROLE = await settlement.ORACLE_ROLE();
    const FRAUD_ROLE = await settlement.FRAUD_ROLE();

    const isAdmin = await settlement.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);

    console.log(`Admin Role: ${isAdmin ? "✓" : "✗"}`);
    console.log(`ORACLE_ROLE: ${ethers.hexlify(ORACLE_ROLE)}`);
    console.log(`FRAUD_ROLE: ${ethers.hexlify(FRAUD_ROLE)}`);
    console.log("");

    // Grant SETTLEMENT_ROLE to PaymentSettlement on CollateralPool
    console.log("🔗 Granting Permissions...");
    console.log("─────────────────────────────────────");

    const CollateralPool = await ethers.getContractFactory("CollateralPool");
    const pool = CollateralPool.attach(collateralPoolAddress);

    const SETTLEMENT_ROLE = await pool.SETTLEMENT_ROLE();
    const hasSettlementRole = await pool.hasRole(SETTLEMENT_ROLE, settlementAddress);

    if (!hasSettlementRole) {
      console.log("Granting SETTLEMENT_ROLE to PaymentSettlement...");
      const tx = await pool.connect(deployer).grantRole(SETTLEMENT_ROLE, settlementAddress);
      await tx.wait();
      console.log("✓ SETTLEMENT_ROLE granted");
    } else {
      console.log("✓ SETTLEMENT_ROLE already granted");
    }
    console.log("");

    // Verify metrics
    console.log("📊 Initial Metrics:");
    console.log("─────────────────────────────────────");
    const metrics = await settlement.getMetrics();
    console.log(`Total Batches: ${metrics._totalBatches}`);
    console.log(`Total Completed: ${metrics._totalCompleted}`);
    console.log(`Total Failed: ${metrics._totalFailed}`);
    console.log(`Total Settled: ${ethers.formatUnits(metrics._totalSettled, 6)} USDC`);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: network.name,
      chainId: (await ethers.provider.getNetwork()).chainId.toString(),
      contract: "PaymentSettlement",
      address: settlementAddress,
      deployer: deployer.address,
      collateralPool: collateralPoolAddress,
      usdcAddress: USDC_PRECOMPILE,
      timestamp: new Date().toISOString(),
      configuration: {
        maxBatchSize: Number(maxBatchSize),
        settlementTimeout: Number(settlementTimeout),
      },
      roles: {
        admin: deployer.address,
        oracleRole: ethers.hexlify(ORACLE_ROLE),
        fraudRole: ethers.hexlify(FRAUD_ROLE),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    if (network.name === "paseo") {
      console.log(
        `https://blockscout-passet-hub.parity-testnet.parity.io/address/${settlementAddress}`
      );
    }
    console.log("");

    console.log("⚠️  Next Steps:");
    console.log("─────────────────────────────────────");
    console.log("1. Grant ORACLE_ROLE to oracle address:");
    console.log(`   settlement.grantRole(ORACLE_ROLE, oracleAddress)`);
    console.log("2. Grant FRAUD_ROLE to FraudPrevention contract:");
    console.log(`   settlement.grantRole(FRAUD_ROLE, fraudPreventionAddress)`);
    console.log("3. Test batch creation and approval flow");
    console.log("4. Test merchant claim flow");
    console.log("5. Transfer admin role to multi-sig");
    console.log("");

    console.log("✅ PaymentSettlement deployment complete!");

    return { settlement, deploymentInfo };
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
