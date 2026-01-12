const { ethers } = require("ethers");
require("dotenv").config();
const networks = require("../../config/networks");

async function main() {
  const network = networks.getNetwork("paseo");
  const provider = new ethers.JsonRpcProvider(network.rpcUrl);
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  console.log("\n🚀 Deploying TataPay to Paseo Asset Hub");
  console.log("📍 Deployer:", deployer.address);
  const balance = await provider.getBalance(deployer.address);
  console.log("💰 Balance:", ethers.formatEther(balance), "PAS\n");

  // Gas configuration for Asset Hub (1000 gwei required!)
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Load artifacts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const TransactionRegistry = require("../../artifacts/contracts/core/TransactionRegistry.sol/TransactionRegistry.json");
  const CrossBorderSettlement = require("../../artifacts/contracts/core/CrossBorderSettlement.sol/CrossBorderSettlement.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");
  const FraudPrevention = require("../../artifacts/contracts/core/FraudPrevention.sol/FraudPrevention.json");
  const TataPayGovernance = require("../../artifacts/contracts/core/TataPayGovernance.sol/TataPayGovernance.json");

  const delay = () => new Promise(r => setTimeout(r, 5000)); // Longer delay for Asset Hub

  // 1. Deploy SimpleUSDC
  console.log("1️⃣  Deploying SimpleUSDC...");
  const usdcFactory = new ethers.ContractFactory(SimpleUSDC.abi, SimpleUSDC.bytecode, deployer);
  const usdc = await usdcFactory.deploy({ ...gasConfig, gasLimit: 2000000 });
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log("✅ SimpleUSDC:", usdcAddress);
  await delay();

  // 2. Deploy TransactionRegistry
  console.log("\n2️⃣  Deploying TransactionRegistry...");
  const registryFactory = new ethers.ContractFactory(TransactionRegistry.abi, TransactionRegistry.bytecode, deployer);
  const registry = await registryFactory.deploy(deployer.address, { ...gasConfig, gasLimit: 3000000 });
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("✅ TransactionRegistry:", registryAddress);
  await delay();

  // 3. Deploy CrossBorderSettlement
  console.log("\n3️⃣  Deploying CrossBorderSettlement...");
  const settlementFactory = new ethers.ContractFactory(CrossBorderSettlement.abi, CrossBorderSettlement.bytecode, deployer);
  // For testnet, use deployer address as Yara settlement address placeholder
  const yaraSettlementAddress = deployer.address;
  const settlement = await settlementFactory.deploy(usdcAddress, deployer.address, yaraSettlementAddress, { ...gasConfig, gasLimit: 5000000 });
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log("✅ CrossBorderSettlement:", settlementAddress);
  console.log("   Yara Settlement Address (testnet):", yaraSettlementAddress);
  await delay();

  // 4. Deploy FraudPrevention
  console.log("\n4️⃣  Deploying FraudPrevention...");
  const fraudFactory = new ethers.ContractFactory(FraudPrevention.abi, FraudPrevention.bytecode, deployer);
  const fraud = await fraudFactory.deploy(deployer.address, { ...gasConfig, gasLimit: 6000000 });
  await fraud.waitForDeployment();
  const fraudAddress = await fraud.getAddress();
  console.log("✅ FraudPrevention:", fraudAddress);
  await delay();

  // 5. Deploy SettlementOracle (now pointing to CrossBorderSettlement)
  console.log("\n5️⃣  Deploying SettlementOracle...");
  const oracleFactory = new ethers.ContractFactory(SettlementOracle.abi, SettlementOracle.bytecode, deployer);
  const MIN_STAKE = ethers.parseUnits("100", 6); // 100 USDC (6 decimals)
  const oracle = await oracleFactory.deploy(settlementAddress, deployer.address, MIN_STAKE, { ...gasConfig, gasLimit: 6000000 });
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("✅ SettlementOracle:", oracleAddress);
  console.log("   Points to CrossBorderSettlement:", settlementAddress);
  await delay();

  // 6. Deploy TataPayGovernance
  console.log("\n6️⃣  Deploying TataPayGovernance...");
  const govFactory = new ethers.ContractFactory(TataPayGovernance.abi, TataPayGovernance.bytecode, deployer);
  const governance = await govFactory.deploy([deployer.address], 1, { ...gasConfig, gasLimit: 6000000 });
  await governance.waitForDeployment();
  const govAddress = await governance.getAddress();
  console.log("✅ TataPayGovernance:", govAddress);
  await delay();

  // 7. Setup roles
  console.log("\n7️⃣  Setting up roles...");

  // Grant RECORDER_ROLE on TransactionRegistry (deployer already has it from constructor)
  const RECORDER_ROLE = await registry.RECORDER_ROLE();
  console.log("✅ TransactionRegistry: RECORDER_ROLE → Deployer (set in constructor)");

  // Grant ORACLE_ROLE on CrossBorderSettlement to SettlementOracle
  const ORACLE_ROLE = await settlement.ORACLE_ROLE();
  const tx1 = await settlement.grantRole(ORACLE_ROLE, oracleAddress, { ...gasConfig, gasLimit: 200000 });
  await tx1.wait();
  console.log("✅ CrossBorderSettlement: ORACLE_ROLE → SettlementOracle");
  await delay();

  // Grant DEFAULT_ADMIN_ROLE to SettlementOracle so it can grant oracle roles during registration
  const DEFAULT_ADMIN_ROLE = await settlement.DEFAULT_ADMIN_ROLE();
  const tx2 = await settlement.grantRole(DEFAULT_ADMIN_ROLE, oracleAddress, { ...gasConfig, gasLimit: 200000 });
  await tx2.wait();
  console.log("✅ CrossBorderSettlement: DEFAULT_ADMIN_ROLE → SettlementOracle");
  await delay();

  // Grant FRAUD_MANAGER_ROLE on FraudPrevention to deployer for testing
  const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
  console.log("✅ FraudPrevention: FRAUD_MANAGER_ROLE → Deployer (set in constructor)");

  console.log("\n⚠️  Note: Oracles must register themselves via registerOracle() with stake");

  console.log("\n📋 Deployment Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`MOCK_USDC_ADDRESS=${usdcAddress}`);
  console.log(`TRANSACTION_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`CROSS_BORDER_SETTLEMENT_ADDRESS=${settlementAddress}`);
  console.log(`FRAUD_PREVENTION_ADDRESS=${fraudAddress}`);
  console.log(`SETTLEMENT_ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`TATAPAY_GOVERNANCE_ADDRESS=${govAddress}`);
  console.log(`YARA_SETTLEMENT_ADDRESS=${yaraSettlementAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("\n🔗 Block Explorer:");
  console.log(`https://blockscout-passet-hub.parity-testnet.parity.io/address/${usdcAddress}`);

  // Auto-update addresses in other scripts
  console.log("\n📝 Updating addresses in scripts...");
  const { updateAddresses } = require("../utils/update-addresses");

  const deployedAddresses = {
    usdc: usdcAddress,
    transactionRegistry: registryAddress,
    crossBorderSettlement: settlementAddress,
    fraudPrevention: fraudAddress,
    settlementOracle: oracleAddress,
    governance: govAddress,
    yaraSettlement: yaraSettlementAddress
  };

  try {
    updateAddresses(deployedAddresses);
    console.log("✅ Addresses updated in e2e scripts and .env!");
  } catch (error) {
    console.log("⚠️  Could not auto-update addresses:", error.message);
    console.log("\nRun manually:");
    console.log(`node scripts/utils/update-addresses.js '${JSON.stringify(deployedAddresses)}'`);
  }

  console.log("\n✅ All contracts deployed successfully!\n");

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
