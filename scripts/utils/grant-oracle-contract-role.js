const { Web3 } = require("web3");
require("dotenv").config();
const networks = require("../../config/networks");

async function main() {
  const network = networks.getNetwork("moonbase");
  const web3 = new Web3(network.rpcUrl);
  const deployer = web3.eth.accounts.privateKeyToAccount(process.env.PRIVATE_KEY);
  web3.eth.accounts.wallet.add(deployer);

  console.log("\n🔐 Granting ORACLE_ROLE to SettlementOracle Contract\n");

  const SETTLEMENT_ADDRESS = network.contracts.paymentSettlement;
  const ORACLE_CONTRACT_ADDRESS = network.contracts.settlementOracle;

  console.log("PaymentSettlement:", SETTLEMENT_ADDRESS);
  console.log("SettlementOracle: ", ORACLE_CONTRACT_ADDRESS);
  console.log("Deployer:         ", deployer.address);
  console.log();

  // Load PaymentSettlement contract
  const PaymentSettlement = require("../../artifacts/contracts/core/PaymentSettlement.sol/PaymentSettlement.json");
  const settlement = new web3.eth.Contract(PaymentSettlement.abi, SETTLEMENT_ADDRESS);

  // Get ORACLE_ROLE
  const ORACLE_ROLE = await settlement.methods.ORACLE_ROLE().call();
  console.log("ORACLE_ROLE:", ORACLE_ROLE);

  // Check if deployer has admin rights
  const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const isAdmin = await settlement.methods.hasRole(DEFAULT_ADMIN_ROLE, deployer.address).call();
  console.log("Deployer is admin:", isAdmin);

  if (!isAdmin) {
    console.log("\n❌ Deployer does not have admin rights. Cannot grant role.");
    process.exit(1);
  }

  // Check if SettlementOracle already has the role
  const alreadyHasRole = await settlement.methods.hasRole(ORACLE_ROLE, ORACLE_CONTRACT_ADDRESS).call();
  console.log("SettlementOracle already has role:", alreadyHasRole);

  if (alreadyHasRole) {
    console.log("\n✅ SettlementOracle already has ORACLE_ROLE!");
    process.exit(0);
  }

  // Grant ORACLE_ROLE to SettlementOracle contract
  console.log("\n📝 Granting ORACLE_ROLE to SettlementOracle contract...");

  try {
    const tx = await settlement.methods.grantRole(ORACLE_ROLE, ORACLE_CONTRACT_ADDRESS).send({
      from: deployer.address,
      gas: 200000
    });

    console.log("✅ ORACLE_ROLE granted to SettlementOracle contract!");
    console.log("   Tx:", tx.transactionHash);

    // Verify
    const hasRole = await settlement.methods.hasRole(ORACLE_ROLE, ORACLE_CONTRACT_ADDRESS).call();
    console.log("\n🔍 Verification:");
    console.log("   SettlementOracle has ORACLE_ROLE:", hasRole);

  } catch (error) {
    console.log("❌ Failed to grant role:", error.message);
    process.exit(1);
  }

  console.log("\n💡 Now oracle1 should call SettlementOracle.approveBatch()");
  console.log("   which will then call PaymentSettlement.approveBatch()\n");

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
