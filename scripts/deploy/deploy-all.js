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
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");
  const FraudPrevention = require("../../artifacts/contracts/core/FraudPrevention.sol/FraudPrevention.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
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

  // 2. Deploy CollateralPool
  console.log("\n2️⃣  Deploying CollateralPool...");
  const poolFactory = new ethers.ContractFactory(CollateralPool.abi, CollateralPool.bytecode, deployer);
  const pool = await poolFactory.deploy(usdcAddress, deployer.address, deployer.address, { ...gasConfig, gasLimit: 3000000 });
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log("✅ CollateralPool:", poolAddress);
  await delay();

  // 3. Deploy SettlementOracle
  console.log("\n3️⃣  Deploying SettlementOracle...");
  const oracleFactory = new ethers.ContractFactory(SettlementOracle.abi, SettlementOracle.bytecode, deployer);
  const MIN_STAKE = ethers.parseUnits("100", 6); // 100 USDC (6 decimals)
  const oracle = await oracleFactory.deploy(deployer.address, deployer.address, MIN_STAKE, { ...gasConfig, gasLimit: 6000000 });
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("✅ SettlementOracle:", oracleAddress);
  await delay();

  // 4. Deploy FraudPrevention
  console.log("\n4️⃣  Deploying FraudPrevention...");
  const fraudFactory = new ethers.ContractFactory(FraudPrevention.abi, FraudPrevention.bytecode, deployer);
  const fraud = await fraudFactory.deploy(deployer.address, { ...gasConfig, gasLimit: 6000000 });
  await fraud.waitForDeployment();
  const fraudAddress = await fraud.getAddress();
  console.log("✅ FraudPrevention:", fraudAddress);
  await delay();

  // 5. Deploy PaymentSettlement
  console.log("\n5️⃣  Deploying PaymentSettlement...");
  const settlementFactory = new ethers.ContractFactory(PaymentSettlement.abi, PaymentSettlement.bytecode, deployer);
  const settlement = await settlementFactory.deploy(usdcAddress, poolAddress, deployer.address, { ...gasConfig, gasLimit: 5000000 });
  await settlement.waitForDeployment();
  const settlementAddress = await settlement.getAddress();
  console.log("✅ PaymentSettlement:", settlementAddress);
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

  // Grant SETTLEMENT_ROLE on CollateralPool
  const SETTLEMENT_ROLE = await pool.SETTLEMENT_ROLE();
  const tx1 = await pool.grantRole(SETTLEMENT_ROLE, settlementAddress, { ...gasConfig, gasLimit: 200000 });
  await tx1.wait();
  console.log("✅ CollateralPool: SETTLEMENT_ROLE → PaymentSettlement");
  await delay();

  // Grant FRAUD_MANAGER_ROLE on FraudPrevention
  const FRAUD_MANAGER_ROLE = await fraud.FRAUD_MANAGER_ROLE();
  const tx2 = await fraud.grantRole(FRAUD_MANAGER_ROLE, settlementAddress, { ...gasConfig, gasLimit: 200000 });
  await tx2.wait();
  console.log("✅ FraudPrevention: FRAUD_MANAGER_ROLE → PaymentSettlement");

  console.log("\n⚠️  Note: Oracles must register themselves via registerOracle() with stake");

  console.log("\n📋 Deployment Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`MOCK_USDC_ADDRESS=${usdcAddress}`);
  console.log(`COLLATERAL_POOL_ADDRESS=${poolAddress}`);
  console.log(`PAYMENT_SETTLEMENT_ADDRESS=${settlementAddress}`);
  console.log(`FRAUD_PREVENTION_ADDRESS=${fraudAddress}`);
  console.log(`SETTLEMENT_ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`TATAPAY_GOVERNANCE_ADDRESS=${govAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  console.log("\n🔗 Block Explorer:");
  console.log(`https://blockscout-passet-hub.parity-testnet.parity.io/address/${usdcAddress}`);

  console.log("\n✅ All contracts deployed successfully!\n");

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
