const { ethers, upgrades } = require("hardhat");

async function main() {
  console.log("\n🚀 Deploying CollateralPoolUpgradeable with UUPS Proxy...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "PAS");
  console.log("Network:", network.name);
  console.log("");

  // USDC precompile address on Asset Hub
  const USDC_ADDRESS = "0x0000053900000000000000000000000000000000";
  const ADMIN_ADDRESS = deployer.address;
  const TREASURY_ADDRESS = deployer.address; // Use deployer as treasury for testing

  console.log("Configuration:");
  console.log("- USDC Address:", USDC_ADDRESS);
  console.log("- Admin:", ADMIN_ADDRESS);
  console.log("- Treasury:", TREASURY_ADDRESS);
  console.log("");

  // Deploy upgradeable CollateralPool with proxy
  console.log("📦 Deploying implementation contract...");
  const CollateralPoolUpgradeable = await ethers.getContractFactory(
    "contracts/core/CollateralPoolUpgradeable.sol:CollateralPoolUpgradeable"
  );

  console.log("📦 Deploying proxy and calling initialize...");
  const collateralPool = await upgrades.deployProxy(
    CollateralPoolUpgradeable,
    [USDC_ADDRESS, ADMIN_ADDRESS, TREASURY_ADDRESS],
    {
      kind: "uups",
      initializer: "initialize",
    }
  );

  await collateralPool.waitForDeployment();

  const proxyAddress = await collateralPool.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(
    proxyAddress
  );

  console.log("\n✅ Deployment successful!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation:", implementationAddress);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Verify contract is initialized correctly
  console.log("\n🔍 Verifying initialization...");
  const treasury = await collateralPool.treasury();
  const withdrawalDelay = await collateralPool.withdrawalDelay();
  const version = await collateralPool.version();

  console.log("Treasury:", treasury);
  console.log("Withdrawal Delay:", withdrawalDelay.toString(), "seconds");
  console.log("Version:", version);

  // Check roles
  const DEFAULT_ADMIN_ROLE = await collateralPool.DEFAULT_ADMIN_ROLE();
  const UPGRADER_ROLE = await collateralPool.UPGRADER_ROLE();
  const hasAdminRole = await collateralPool.hasRole(DEFAULT_ADMIN_ROLE, ADMIN_ADDRESS);
  const hasUpgraderRole = await collateralPool.hasRole(UPGRADER_ROLE, ADMIN_ADDRESS);

  console.log("\n🔐 Role Verification:");
  console.log("Has Admin Role:", hasAdminRole);
  console.log("Has Upgrader Role:", hasUpgraderRole);

  // Get deployed bytecode size
  const code = await ethers.provider.getCode(implementationAddress);
  const runtimeSize = (code.length - 2) / 2; // Subtract '0x' and divide by 2 for bytes
  console.log("\n📊 Contract Size:");
  console.log("Runtime bytecode:", runtimeSize, "bytes");

  console.log("\n✨ Deployment complete!");
  console.log("\nNext steps:");
  console.log("1. Grant SETTLEMENT_ROLE to PaymentSettlement contract");
  console.log("2. Grant SLASHER_ROLE to FraudPrevention contract");
  console.log("3. Verify contracts on BlockScout");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      CollateralPoolUpgradeable: {
        proxy: proxyAddress,
        implementation: implementationAddress,
        runtimeBytecodeSize: runtimeSize,
        version: version,
      },
    },
  };

  console.log("\n📝 Deployment Info:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
