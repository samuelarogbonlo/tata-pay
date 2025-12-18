const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function main() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  const oracle1 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);
  const oracle2 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE2_PRIVATE_KEY);

  web3.eth.accounts.wallet.add(deployer);
  web3.eth.accounts.wallet.add(oracle1);
  web3.eth.accounts.wallet.add(oracle2);

  console.log("\n🚀 Deploying TataPay to Moonbase Alpha");
  console.log("📍 Deployer:", deployer.address);
  console.log("💰 Balance:", web3.utils.fromWei(await web3.eth.getBalance(deployer.address), "ether"), "DEV\n");

  // Load artifacts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");
  const FraudPrevention = require("../../artifacts/contracts/core/FraudPrevention.sol/FraudPrevention.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const TataPayGovernance = require("../../artifacts/contracts/core/TataPayGovernance.sol/TataPayGovernance.json");

  const delay = () => new Promise(r => setTimeout(r, 3000));

  // 1. Deploy SimpleUSDC
  console.log("1️⃣  Deploying SimpleUSDC...");
  const usdcContract = new web3.eth.Contract(SimpleUSDC.abi);
  const usdc = await usdcContract.deploy({ data: SimpleUSDC.bytecode }).send({ from: deployer.address, gas: 2000000 });
  const usdcAddress = usdc.options.address;
  console.log("✅ SimpleUSDC:", usdcAddress);
  await delay();

  // 2. Deploy CollateralPool
  console.log("\n2️⃣  Deploying CollateralPool...");
  const poolContract = new web3.eth.Contract(CollateralPool.abi);
  const pool = await poolContract.deploy({
    data: CollateralPool.bytecode,
    arguments: [usdcAddress, deployer.address, deployer.address]
  }).send({ from: deployer.address, gas: 3000000 });
  const poolAddress = pool.options.address;
  console.log("✅ CollateralPool:", poolAddress);
  await delay();

  // 3. Deploy SettlementOracle (with temporary payment settlement address)
  console.log("\n3️⃣  Deploying SettlementOracle...");
  const oracleContract = new web3.eth.Contract(SettlementOracle.abi);
  const MIN_STAKE = web3.utils.toWei("100", "ether"); // 100 USDC (6 decimals, but using ether for simplicity)
  const oracle = await oracleContract.deploy({
    data: SettlementOracle.bytecode,
    arguments: [deployer.address, deployer.address, MIN_STAKE] // Temporary payment settlement = deployer
  }).send({ from: deployer.address, gas: 6000000 }); // Increased gas
  const oracleAddress = oracle.options.address;
  console.log("✅ SettlementOracle:", oracleAddress);
  await delay();

  // 4. Deploy FraudPrevention
  console.log("\n4️⃣  Deploying FraudPrevention...");
  const fraudContract = new web3.eth.Contract(FraudPrevention.abi);
  const fraud = await fraudContract.deploy({
    data: FraudPrevention.bytecode,
    arguments: [deployer.address]
  }).send({ from: deployer.address, gas: 6000000 }); // Increased gas
  const fraudAddress = fraud.options.address;
  console.log("✅ FraudPrevention:", fraudAddress);
  await delay();

  // 5. Deploy PaymentSettlement
  console.log("\n5️⃣  Deploying PaymentSettlement...");
  const settlementContract = new web3.eth.Contract(PaymentSettlement.abi);
  const settlement = await settlementContract.deploy({
    data: PaymentSettlement.bytecode,
    arguments: [usdcAddress, poolAddress, deployer.address]
  }).send({ from: deployer.address, gas: 5000000 });
  const settlementAddress = settlement.options.address;
  console.log("✅ PaymentSettlement:", settlementAddress);
  await delay();

  // 6. Deploy TataPayGovernance
  console.log("\n6️⃣  Deploying TataPayGovernance...");
  const govContract = new web3.eth.Contract(TataPayGovernance.abi);
  const governance = await govContract.deploy({
    data: TataPayGovernance.bytecode,
    arguments: [[deployer.address], 1] // governors array, required approvals
  }).send({ from: deployer.address, gas: 6000000 }); // Increased gas
  const govAddress = governance.options.address;
  console.log("✅ TataPayGovernance:", govAddress);
  await delay();

  // 7. Setup roles
  console.log("\n7️⃣  Setting up roles...");

  // Grant SETTLEMENT_ROLE on CollateralPool
  const SETTLEMENT_ROLE = await pool.methods.SETTLEMENT_ROLE().call();
  await pool.methods.grantRole(SETTLEMENT_ROLE, settlementAddress).send({ from: deployer.address, gas: 200000 });
  console.log("✅ CollateralPool: SETTLEMENT_ROLE → PaymentSettlement");

  // Grant FRAUD_CHECKER_ROLE on FraudPrevention
  const FRAUD_CHECKER_ROLE = await fraud.methods.FRAUD_CHECKER_ROLE().call();
  await fraud.methods.grantRole(FRAUD_CHECKER_ROLE, deployer.address).send({ from: deployer.address, gas: 200000 });
  console.log("✅ FraudPrevention: FRAUD_CHECKER_ROLE → deployer");

  console.log("\n⚠️  Note: Oracles must register themselves via registerOracle() with stake");

  console.log("\n📋 Deployment Summary");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`MOCK_USDC_ADDRESS=${usdcAddress}`);
  console.log(`COLLATERAL_POOL_ADDRESS=${poolAddress}`);
  console.log(`PAYMENT_SETTLEMENT_ADDRESS=${settlementAddress}`);
  console.log(`FRAUD_PREVENTION_ADDRESS=${fraudAddress}`);
  console.log(`SETTLEMENT_ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`TATAPAY_GOVERNANCE_ADDRESS=${govAddress}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
