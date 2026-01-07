const { ethers } = require("ethers");
require("dotenv").config();

async function setup() {
  const provider = new ethers.JsonRpcProvider("https://testnet-passet-hub-eth-rpc.polkadot.io");
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const oracle1 = new ethers.Wallet(process.env.ORACLE1_PRIVATE_KEY, provider);

  console.log("\n🔧 Setting up Paseo deployment...\n");

  // Gas configuration for Asset Hub
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Contract addresses from deployment
  const addresses = {
    usdc: "0xd1bBE61C683B339dE9733b928616C1594e770A3c",
    collateralPool: "0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc",
    paymentSettlement: "0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF",
  };

  // Load ABIs
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const CollateralPool = require("../../artifacts/contracts/core/CollateralPool.sol/CollateralPool.json");
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");

  const usdc = new ethers.Contract(addresses.usdc, SimpleUSDC.abi, deployer);
  const pool = new ethers.Contract(addresses.collateralPool, CollateralPool.abi, deployer);
  const settlement = new ethers.Contract(addresses.paymentSettlement, PaymentSettlement.abi, deployer);

  // 1. Grant Oracle Role
  console.log("1️⃣  Granting ORACLE_ROLE to Oracle1...");
  const ORACLE_ROLE = await settlement.ORACLE_ROLE();
  const tx1 = await settlement.grantRole(ORACLE_ROLE, oracle1.address, { ...gasConfig, gasLimit: 200000 });
  await tx1.wait();
  console.log("   ✅ Oracle role granted to", oracle1.address, "\n");

  // 2. Mint USDC
  console.log("2️⃣  Minting 1,000,000 USDC...");
  const tx2 = await usdc.mint(deployer.address, "1000000000000", { ...gasConfig, gasLimit: 200000 });
  await tx2.wait();
  const balance = await usdc.balanceOf(deployer.address);
  console.log(`   ✅ Minted: ${ethers.formatUnits(balance, 6)} USDC\n`);

  // 3. Deposit Collateral
  console.log("3️⃣  Depositing 100,000 USDC as collateral...");
  const tx3 = await usdc.approve(addresses.collateralPool, "100000000000", { ...gasConfig, gasLimit: 100000 });
  await tx3.wait();
  const tx4 = await pool.deposit("100000000000", { ...gasConfig, gasLimit: 300000 });
  await tx4.wait();
  const poolBalance = await pool.balances(deployer.address);
  console.log(`   ✅ Deposited: ${ethers.formatUnits(poolBalance.availableBalance, 6)} USDC\n`);

  console.log("✅ Setup complete!\n");
  process.exit(0);
}

setup().catch((error) => {
  console.error("\n❌ Setup failed:", error);
  process.exit(1);
});
