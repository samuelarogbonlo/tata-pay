const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

/**
 * Oracle Registration Script
 *
 * Registers an oracle with the SettlementOracle contract.
 * Requires staking USDC as collateral (minimum stake defined in contract).
 *
 * Usage:
 *   node scripts/oracle/register-oracle.js [network]
 *
 * Prerequisites:
 * - Oracle account must have sufficient USDC for staking
 * - USDC must be approved for SettlementOracle contract
 */

async function main() {
  const networkName = process.argv[2] || "moonbase";
  const network = networks.getNetwork(networkName);
  const web3 = new Web3(network.rpcUrl);

  // Load oracle account
  if (!process.env.ORACLE1_PRIVATE_KEY) {
    console.error("❌ Error: ORACLE1_PRIVATE_KEY not found in .env");
    process.exit(1);
  }

  const oracle = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);
  web3.eth.accounts.wallet.add(oracle);

  console.log("\n🔮 Oracle Registration\n");
  console.log("Network:", network.name);
  console.log("Oracle:", oracle.address);
  console.log("SettlementOracle:", network.contracts.settlementOracle);
  console.log();

  // Load contracts
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");

  const settlementOracle = new web3.eth.Contract(SettlementOracle.abi, network.contracts.settlementOracle);
  const usdc = new web3.eth.Contract(SimpleUSDC.abi, network.contracts.usdc);

  // Get minimum stake requirement
  const minStake = await settlementOracle.methods.minimumStake().call();
  console.log(`Minimum stake required: ${Number(minStake) / 1e6} USDC`);

  // Check oracle balance
  const balance = await usdc.methods.balanceOf(oracle.address).call();
  console.log(`Oracle USDC balance: ${Number(balance) / 1e6} USDC`);

  if (Number(balance) < Number(minStake)) {
    console.error("\n❌ Error: Insufficient USDC balance for registration");
    console.error(`   Required: ${Number(minStake) / 1e6} USDC`);
    console.error(`   Available: ${Number(balance) / 1e6} USDC`);
    process.exit(1);
  }

  // Check if already registered
  const isRegistered = await settlementOracle.methods.isOracleRegistered(oracle.address).call();
  if (isRegistered) {
    console.log("\n✅ Oracle already registered!");
    const oracleInfo = await settlementOracle.methods.oracles(oracle.address).call();
    console.log(`   Stake: ${Number(oracleInfo.stake) / 1e6} USDC`);
    console.log(`   Active: ${oracleInfo.isActive}`);
    process.exit(0);
  }

  // Approve USDC
  console.log("\n1️⃣  Approving USDC...");
  const approveTx = await usdc.methods.approve(network.contracts.settlementOracle, minStake).send({
    from: oracle.address,
    gas: 100000
  });
  console.log("   ✅ USDC approved");
  console.log("   Tx:", approveTx.transactionHash);

  // Register oracle
  console.log("\n2️⃣  Registering oracle...");
  try {
    const registerTx = await settlementOracle.methods.registerOracle(minStake).send({
      from: oracle.address,
      gas: 300000
    });

    console.log("   ✅ Oracle registered successfully!");
    console.log("   Tx:", registerTx.transactionHash);

    // Verify registration
    const oracleInfo = await settlementOracle.methods.oracles(oracle.address).call();
    console.log("\n3️⃣  Verification:");
    console.log(`   Stake: ${Number(oracleInfo.stake) / 1e6} USDC`);
    console.log(`   Active: ${oracleInfo.isActive}`);
    console.log(`   Is Registered: ${await settlementOracle.methods.isOracleRegistered(oracle.address).call()}`);

  } catch (error) {
    console.error("\n❌ Registration failed:", error.message);
    process.exit(1);
  }

  console.log("\n✅ Oracle registration complete!\n");
  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
