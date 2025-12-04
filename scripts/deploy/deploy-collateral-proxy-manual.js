const { ethers } = require("hardhat");

async function main() {
  console.log("\n🚀 Deploying CollateralPoolUpgradeable with UUPS Proxy (Manual)...\n");

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

  // Step 1: Deploy the implementation contract
  console.log("📦 Step 1: Deploying implementation contract...");
  const CollateralPoolUpgradeable = await ethers.getContractFactory(
    "contracts/core/CollateralPoolUpgradeable.sol:CollateralPoolUpgradeable"
  );
  const implementation = await CollateralPoolUpgradeable.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();
  console.log("✅ Implementation deployed:", implementationAddress);

  // Get implementation bytecode size
  const implCode = await ethers.provider.getCode(implementationAddress);
  const implSize = (implCode.length - 2) / 2;
  console.log("   Runtime size:", implSize, "bytes");
  console.log("");

  // Step 2: Encode the initialize function call
  console.log("📦 Step 2: Encoding initialize call...");
  const initializeData = implementation.interface.encodeFunctionData("initialize", [
    USDC_ADDRESS,
    ADMIN_ADDRESS,
    TREASURY_ADDRESS,
  ]);
  console.log("✅ Initialize data encoded");
  console.log("");

  // Step 3: Deploy the ERC1967 Proxy
  console.log("📦 Step 3: Deploying ERC1967 Proxy...");
  const TransparentProxy = await ethers.getContractFactory(
    "contracts/proxy/TransparentProxy.sol:TransparentProxy"
  );
  const proxy = await TransparentProxy.deploy(implementationAddress, initializeData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  console.log("✅ Proxy deployed:", proxyAddress);

  // Get proxy bytecode size
  const proxyCode = await ethers.provider.getCode(proxyAddress);
  const proxySize = (proxyCode.length - 2) / 2;
  console.log("   Runtime size:", proxySize, "bytes");
  console.log("");

  console.log("\n✅ Deployment successful!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Proxy Address:", proxyAddress);
  console.log("Implementation:", implementationAddress);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Step 4: Interact with the proxy as CollateralPool
  console.log("\n🔍 Verifying initialization...");
  const collateralPool = CollateralPoolUpgradeable.attach(proxyAddress);

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

  console.log("\n📊 Contract Sizes:");
  console.log("Proxy bytecode:", proxySize, "bytes ✅ (tiny!)");
  console.log("Implementation bytecode:", implSize, "bytes");
  console.log(
    "\n💡 The proxy is tiny and passes the 24KB limit!"
  );

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
        proxyBytecodeSize: proxySize,
        implementationBytecodeSize: implSize,
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
    console.error("\nError details:", error.message);
    if (error.error) {
      console.error("Inner error:", error.error);
    }
    process.exit(1);
  });
