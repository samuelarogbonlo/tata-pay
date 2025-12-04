const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking SettlementOracle deployment...\n");

  const oracleAddress = "0xEB7278C528817fB51c1837Cb0666c02922d542F1";

  // Check if contract exists
  const code = await ethers.provider.getCode(oracleAddress);
  console.log("Contract exists:", code !== "0x");
  console.log("Code size:", (code.length - 2) / 2, "bytes\n");

  // Try to interact with it
  const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
  const oracle = SettlementOracle.attach(oracleAddress);

  console.log("Testing contract calls:\n");

  try {
    const paymentSettlement = await oracle.paymentSettlement();
    console.log("✅ paymentSettlement():", paymentSettlement);
  } catch (e) {
    console.log("❌ paymentSettlement() failed:", e.message);
  }

  try {
    const minStake = await oracle.minimumStake();
    console.log("✅ minimumStake():", ethers.formatEther(minStake), "PAS");
  } catch (e) {
    console.log("❌ minimumStake() failed:", e.message);
  }

  try {
    const threshold = await oracle.approvalThreshold();
    console.log("✅ approvalThreshold():", threshold.toString());
  } catch (e) {
    console.log("❌ approvalThreshold() failed:", e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
