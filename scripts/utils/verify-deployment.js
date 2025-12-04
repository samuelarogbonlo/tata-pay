const { ethers } = require("hardhat");

async function main() {
  console.log("\n🔍 Verifying Paseo Asset Hub Deployment\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const addresses = {
    CollateralPool: "0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9",
    FraudPrevention: "0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f",
    PaymentSettlement: "0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174",
    SettlementOracle: "0xEB7278C528817fB51c1837Cb0666c02922d542F1",
    TataPayGovernance: "0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260",
  };

  let allPassed = true;

  // Check CollateralPool (Proxy)
  console.log("📦 1. CollateralPool (UUPS Proxy)");
  console.log(`   Address: ${addresses.CollateralPool}`);
  try {
    const CollateralPool = await ethers.getContractFactory(
      "contracts/core/CollateralPoolUpgradeable.sol:CollateralPoolUpgradeable"
    );
    const pool = CollateralPool.attach(addresses.CollateralPool);

    const code = await ethers.provider.getCode(addresses.CollateralPool);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const treasury = await pool.treasury();
    const withdrawalDelay = await pool.withdrawalDelay();
    const version = await pool.version();

    console.log(`   ✅ Treasury: ${treasury}`);
    console.log(`   ✅ Withdrawal Delay: ${withdrawalDelay} seconds`);
    console.log(`   ✅ Version: ${version}`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    allPassed = false;
  }
  console.log();

  // Check FraudPrevention
  console.log("🛡️  2. FraudPrevention");
  console.log(`   Address: ${addresses.FraudPrevention}`);
  try {
    const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
    const fraud = FraudPrevention.attach(addresses.FraudPrevention);

    const code = await ethers.provider.getCode(addresses.FraudPrevention);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const limits = await fraud.defaultLimits();
    const totalBlacklisted = await fraud.totalBlacklisted();

    console.log(`   ✅ Daily Amount Limit: $${ethers.formatUnits(limits.dailyAmountLimit, 6)}`);
    console.log(`   ✅ Hourly Amount Limit: $${ethers.formatUnits(limits.hourlyAmountLimit, 6)}`);
    console.log(`   ✅ Total Blacklisted: ${totalBlacklisted}`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    allPassed = false;
  }
  console.log();

  // Check PaymentSettlement
  console.log("💰 3. PaymentSettlement");
  console.log(`   Address: ${addresses.PaymentSettlement}`);
  try {
    const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
    const settlement = PaymentSettlement.attach(addresses.PaymentSettlement);

    const code = await ethers.provider.getCode(addresses.PaymentSettlement);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const maxBatchSize = await settlement.MAX_BATCH_SIZE();
    const settlementTimeout = await settlement.SETTLEMENT_TIMEOUT();
    const collateralPool = await settlement.collateralPool();

    console.log(`   ✅ Max Batch Size: ${maxBatchSize}`);
    console.log(`   ✅ Settlement Timeout: ${settlementTimeout / 3600n} hours`);
    console.log(`   ✅ Collateral Pool: ${collateralPool}`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    allPassed = false;
  }
  console.log();

  // Check SettlementOracle
  console.log("🔮 4. SettlementOracle");
  console.log(`   Address: ${addresses.SettlementOracle}`);
  try {
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const oracle = SettlementOracle.attach(addresses.SettlementOracle);

    const code = await ethers.provider.getCode(addresses.SettlementOracle);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const paymentSettlement = await oracle.paymentSettlement();
    const minStake = await oracle.minimumStake();
    const threshold = await oracle.approvalThreshold();

    console.log(`   ✅ PaymentSettlement: ${paymentSettlement}`);
    console.log(`   ✅ Minimum Stake: ${ethers.formatEther(minStake)} PAS`);
    console.log(`   ✅ Approval Threshold: ${threshold}`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    allPassed = false;
  }
  console.log();

  // Check TataPayGovernance
  console.log("⚖️  5. TataPayGovernance");
  console.log(`   Address: ${addresses.TataPayGovernance}`);
  try {
    const TataPayGovernance = await ethers.getContractFactory("TataPayGovernance");
    const gov = TataPayGovernance.attach(addresses.TataPayGovernance);

    const code = await ethers.provider.getCode(addresses.TataPayGovernance);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const requiredApprovals = await gov.requiredApprovals();
    const totalGovernors = await gov.totalGovernors();
    const standardDelay = await gov.standardDelay();

    console.log(`   ✅ Required Approvals: ${requiredApprovals} of ${totalGovernors}`);
    console.log(`   ✅ Total Governors: ${totalGovernors}`);
    console.log(`   ✅ Standard Delay: ${standardDelay / 3600n} hours`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    allPassed = false;
  }
  console.log();

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  if (allPassed) {
    console.log("✅ ALL CONTRACTS VERIFIED SUCCESSFULLY!");
    console.log("\n🎉 Milestone 1 deployment complete and functional");
  } else {
    console.log("❌ Some contracts failed verification");
    console.log("Review errors above and redeploy if needed");
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
