const { ethers } = require("hardhat");

/**
 * Deploy FraudPrevention contract to Asset Hub
 *
 * This script deploys the FraudPrevention contract which manages
 * fraud detection and prevention for Tata-Pay settlements.
 *
 * Features:
 * - Blacklist/whitelist address management
 * - Velocity limits (hourly and daily)
 * - Transaction monitoring and validation
 * - Emergency freeze functionality
 * - Integration with PaymentSettlement
 */

async function main() {
  console.log("\n🚀 Deploying FraudPrevention to Asset Hub...\n");

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

  console.log("📦 Deploying FraudPrevention...");

  try {
    // Deploy FraudPrevention
    const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
    const fraud = await FraudPrevention.deploy(deployer.address);

    console.log("⏳ Waiting for deployment...");
    await fraud.waitForDeployment();

    const fraudAddress = await fraud.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log(`FraudPrevention: ${fraudAddress}`);
    console.log(`Admin: ${deployer.address}`);
    console.log("");

    // Verify configuration
    console.log("📋 Default Velocity Limits:");
    console.log("─────────────────────────────────────");
    const limits = await fraud.defaultLimits();
    console.log(`Hourly Transaction Limit: ${limits.hourlyTransactionLimit}`);
    console.log(`Daily Transaction Limit: ${limits.dailyTransactionLimit}`);
    console.log(`Hourly Amount Limit: ${ethers.formatUnits(limits.hourlyAmountLimit, 6)} USDC`);
    console.log(`Daily Amount Limit: ${ethers.formatUnits(limits.dailyAmountLimit, 6)} USDC`);
    console.log("");

    // Verify roles
    console.log("🔐 Roles:");
    console.log("─────────────────────────────────────");
    const DEFAULT_ADMIN_ROLE = await fraud.DEFAULT_ADMIN_ROLE();
    const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
    const EMERGENCY_ROLE = await fraud.EMERGENCY_ROLE();

    const isAdmin = await fraud.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    const isFraudManager = await fraud.hasRole(FRAUD_MANAGER_ROLE, deployer.address);
    const hasEmergency = await fraud.hasRole(EMERGENCY_ROLE, deployer.address);

    console.log(`Admin Role: ${isAdmin ? "✓" : "✗"}`);
    console.log(`Fraud Manager Role: ${isFraudManager ? "✓" : "✗"}`);
    console.log(`Emergency Role: ${hasEmergency ? "✓" : "✗"}`);
    console.log("");
    console.log(`FRAUD_MANAGER_ROLE: ${ethers.hexlify(FRAUD_MANAGER_ROLE)}`);
    console.log(`EMERGENCY_ROLE: ${ethers.hexlify(EMERGENCY_ROLE)}`);
    console.log("");

    // Verify metrics
    console.log("📊 Initial Metrics:");
    console.log("─────────────────────────────────────");
    const [totalBlacklisted, totalWhitelisted, totalViolations, totalValidated] =
      await fraud.getMetrics();
    console.log(`Total Blacklisted: ${totalBlacklisted}`);
    console.log(`Total Whitelisted: ${totalWhitelisted}`);
    console.log(`Total Violations: ${totalViolations}`);
    console.log(`Total Validated: ${totalValidated}`);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: network.name,
      chainId: (await ethers.provider.getNetwork()).chainId.toString(),
      contract: "FraudPrevention",
      address: fraudAddress,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      defaultLimits: {
        hourlyTransactionLimit: Number(limits.hourlyTransactionLimit),
        dailyTransactionLimit: Number(limits.dailyTransactionLimit),
        hourlyAmountLimit: limits.hourlyAmountLimit.toString(),
        dailyAmountLimit: limits.dailyAmountLimit.toString(),
      },
      roles: {
        admin: deployer.address,
        fraudManagerRole: ethers.hexlify(FRAUD_MANAGER_ROLE),
        emergencyRole: ethers.hexlify(EMERGENCY_ROLE),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    if (network.name === "paseo") {
      console.log(
        `https://blockscout-passet-hub.parity-testnet.parity.io/address/${fraudAddress}`
      );
    }
    console.log("");

    console.log("⚠️  Next Steps:");
    console.log("─────────────────────────────────────");
    console.log("1. Grant FRAUD_ROLE on PaymentSettlement to FraudPrevention:");
    console.log(`   paymentSettlement.grantRole(FRAUD_ROLE, ${fraudAddress})`);
    console.log("2. Grant FRAUD_MANAGER_ROLE to operational wallet:");
    console.log(`   fraudPrevention.grantRole(FRAUD_MANAGER_ROLE, operatorAddress)`);
    console.log("3. Configure custom velocity limits for high-value fintechs");
    console.log("4. Set up initial whitelist for trusted addresses");
    console.log("5. Integrate with off-chain fraud detection system");
    console.log("6. Transfer admin role to multi-sig");
    console.log("");

    console.log("✅ FraudPrevention deployment complete!");

    return { fraud, deploymentInfo };
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
