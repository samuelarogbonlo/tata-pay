const { ethers } = require("hardhat");

/**
 * Deploy CollateralPool contract to Asset Hub
 *
 * This script deploys the CollateralPool contract which manages
 * USDC collateral from fintechs for payment settlements.
 *
 * Features:
 * - Minimum deposit: 1000 USDC (6 decimals)
 * - Withdrawal delay: 24 hours default
 * - Lock/unlock for settlements
 * - Slashing for fraud
 * - Emergency controls
 */

async function main() {
  console.log("\n🚀 Deploying CollateralPool to Asset Hub...\n");

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

  // Treasury address (for now, use deployer; in production use multi-sig)
  const treasuryAddress = deployer.address;

  console.log("📦 Deploying CollateralPool...");

  try {
    // Deploy CollateralPool
    const CollateralPool = await ethers.getContractFactory("CollateralPool");
    const pool = await CollateralPool.deploy(
      USDC_PRECOMPILE,       // USDC token address
      deployer.address,       // Admin address
      treasuryAddress         // Treasury address
    );

    console.log("⏳ Waiting for deployment...");
    await pool.waitForDeployment();

    const poolAddress = await pool.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log(`CollateralPool: ${poolAddress}`);
    console.log(`Treasury: ${treasuryAddress}`);
    console.log(`Admin: ${deployer.address}`);
    console.log("");

    // Verify configuration
    console.log("📋 Configuration:");
    console.log("─────────────────────────────────────");
    const withdrawalDelay = await pool.withdrawalDelay();
    const minimumDeposit = await pool.MINIMUM_DEPOSIT();
    const treasury = await pool.treasury();

    console.log(`Withdrawal Delay: ${Number(withdrawalDelay) / 3600} hours`);
    console.log(`Minimum Deposit: ${ethers.formatUnits(minimumDeposit, 6)} USDC`);
    console.log(`Treasury: ${treasury}`);
    console.log("");

    // Verify roles
    console.log("🔐 Roles:");
    console.log("─────────────────────────────────────");
    const DEFAULT_ADMIN_ROLE = await pool.DEFAULT_ADMIN_ROLE();
    const EMERGENCY_ROLE = await pool.EMERGENCY_ROLE();

    const isAdmin = await pool.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    const hasEmergency = await pool.hasRole(EMERGENCY_ROLE, deployer.address);

    console.log(`Admin Role: ${isAdmin ? "✓" : "✗"}`);
    console.log(`Emergency Role: ${hasEmergency ? "✓" : "✗"}`);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: network.name,
      chainId: (await ethers.provider.getNetwork()).chainId.toString(),
      contract: "CollateralPool",
      address: poolAddress,
      deployer: deployer.address,
      treasury: treasuryAddress,
      usdcAddress: USDC_PRECOMPILE,
      timestamp: new Date().toISOString(),
      configuration: {
        withdrawalDelay: Number(withdrawalDelay),
        minimumDeposit: minimumDeposit.toString(),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    if (network.name === "paseo") {
      console.log(
        `https://blockscout-passet-hub.parity-testnet.parity.io/address/${poolAddress}`
      );
    }
    console.log("");

    console.log("⚠️  Next Steps:");
    console.log("─────────────────────────────────────");
    console.log("1. Grant SETTLEMENT_ROLE to PaymentSettlement contract");
    console.log("2. Grant SLASHER_ROLE to FraudPrevention contract");
    console.log("3. Update treasury to multi-sig wallet");
    console.log("4. Transfer admin role to multi-sig");
    console.log("5. Test deposit/withdrawal on testnet");
    console.log("");

    console.log("✅ CollateralPool deployment complete!");

    return { pool, deploymentInfo };
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
