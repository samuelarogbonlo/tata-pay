const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function main() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  const oracle1 = web3.eth.accounts.privateKeyToAccount(process.env.ORACLE1_PRIVATE_KEY);

  web3.eth.accounts.wallet.add(deployer);

  console.log("\n🔐 Granting ORACLE_ROLE for Testing\n");

  const SETTLEMENT_ADDRESS = network.contracts.paymentSettlement;

  // Load contract
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, SETTLEMENT_ADDRESS);

  // Get ORACLE_ROLE
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  console.log("ORACLE_ROLE:", ORACLE_ROLE);

  // Check if deployer has DEFAULT_ADMIN_ROLE
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const isAdmin = await settlement.methods.hasRole(DEFAULT_ADMIN_ROLE, deployer.address).call();
  console.log("Deployer is admin:", isAdmin);

  if (!isAdmin) {
    console.log("\n❌ Deployer does not have admin rights on PaymentSettlement");
    console.log("   Cannot grant ORACLE_ROLE");
    process.exit(1);
  }

  // Grant ORACLE_ROLE to oracle1
  console.log("\n📝 Granting ORACLE_ROLE to oracle1...");
  console.log("   Oracle1:", oracle1.address);

  try {
    const tx = await settlement.methods.grantRole(ORACLE_ROLE, oracle1.address).send({
      from: deployer.address,
      gas: 200000
    });

    console.log("✅ ORACLE_ROLE granted!");
    console.log("   Tx:", tx.transactionHash);

    // Verify
    const hasRole = await settlement.methods.hasRole(ORACLE_ROLE, oracle1.address).call();
    console.log("\n🔍 Verification:");
    console.log("   Oracle1 has ORACLE_ROLE:", hasRole);

  } catch (error) {
    console.log("❌ Failed to grant role:", error.message);
    process.exit(1);
  }

  console.log("\n");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
