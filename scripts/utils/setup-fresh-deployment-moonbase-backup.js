const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function setup() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  const oracle1 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);

  web3.eth.accounts.wallet.add(deployer);
  web3.eth.accounts.wallet.add(oracle1);

  console.log("\n🔧 Setting up fresh deployment...\n");

  // Load contracts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");

  const usdc = new web3.eth.Contract(SimpleUSDC.abi, network.contracts.usdc);
  const pool = new web3.eth.Contract(CollateralPool.abi, network.contracts.collateralPool);
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, network.contracts.paymentSettlement);

  // 1. Grant Oracle Role
  console.log("1️⃣  Granting ORACLE_ROLE to Oracle1...");
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  await settlement.methods.grantRole(ORACLE_ROLE, oracle1.address).send({ from: deployer.address, gas: 200000 });
  console.log("   ✅ Oracle role granted\n");

  // 2. Mint USDC
  console.log("2️⃣  Minting 1,000,000 USDC...");
  await usdc.methods.mint(deployer.address, "1000000000000").send({ from: deployer.address, gas: 100000 });
  const balance = await usdc.methods.balanceOf(deployer.address).call();
  console.log(`   ✅ Minted: ${Number(balance) / 1e6} USDC\n`);

  // 3. Deposit Collateral
  console.log("3️⃣  Depositing 100,000 USDC as collateral...");
  await usdc.methods.approve(network.contracts.collateralPool, "100000000000").send({ from: deployer.address, gas: 100000 });
  await pool.methods.deposit("100000000000").send({ from: deployer.address, gas: 200000 });
  const poolBalance = await pool.methods.balances(deployer.address).call();
  console.log(`   ✅ Deposited: ${Number(poolBalance.availableBalance) / 1e6} USDC\n`);

  console.log("✅ Setup complete!\n");
  process.exit(0);
}

setup().catch((error) => {
  console.error("\n❌ Setup failed:", error);
  process.exit(1);
});
