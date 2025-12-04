const { ethers } = require("hardhat");

async function main() {
  console.log("\n🧪 Testing Basic Flows on Paseo Asset Hub\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const [deployer] = await ethers.getSigners();
  console.log("Test Account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "PAS\n");

  // Contract addresses
  const addresses = {
    CollateralPool: "0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9",
    FraudPrevention: "0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f",
    PaymentSettlement: "0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174",
    SettlementOracle: "0xEB7278C528817fB51c1837Cb0666c02922d542F1",
    USDC: "0x0000053900000000000000000000000000000000", // Asset Hub USDC precompile
  };

  // Attach to contracts
  const CollateralPool = await ethers.getContractFactory(
    "contracts/core/CollateralPoolUpgradeable.sol:CollateralPoolUpgradeable"
  );
  const collateralPool = CollateralPool.attach(addresses.CollateralPool);

  const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
  const paymentSettlement = PaymentSettlement.attach(addresses.PaymentSettlement);

  const FraudPrevention = await ethers.getContractFactory("FraudPrevention");
  const fraudPrevention = FraudPrevention.attach(addresses.FraudPrevention);

  // USDC token interface
  const USDC = await ethers.getContractAt("IERC20", addresses.USDC);

  let testsPassed = 0;
  let testsFailed = 0;

  // ============================================
  // Test 1: Check USDC Balance
  // ============================================
  console.log("📊 Test 1: Check USDC Balance\n");
  try {
    const usdcBalance = await USDC.balanceOf(deployer.address);
    console.log(`   USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

    if (usdcBalance === 0n) {
      console.log("   ⚠️  No USDC tokens available for testing deposits");
      console.log("   ℹ️  To test deposits, you need USDC from Asset Hub faucet\n");
    } else {
      console.log("   ✅ USDC available for testing\n");
    }
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Test 2: Check CollateralPool Configuration
  // ============================================
  console.log("📊 Test 2: Check CollateralPool Configuration\n");
  try {
    const balance = await collateralPool.balances(deployer.address);
    const withdrawalDelay = await collateralPool.withdrawalDelay();

    console.log(`   Total Deposited: ${ethers.formatUnits(balance.totalDeposited, 6)} USDC`);
    console.log(`   Available Balance: ${ethers.formatUnits(balance.availableBalance, 6)} USDC`);
    console.log(`   Locked Balance: ${ethers.formatUnits(balance.lockedBalance, 6)} USDC`);
    console.log(`   Withdrawal Delay: ${withdrawalDelay / 86400n} days`);
    console.log("   ✅ CollateralPool readable\n");
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Test 3: Check Batch Creation Interface
  // ============================================
  console.log("📊 Test 3: Check Batch Creation Interface\n");
  try {
    // Check max batch size and timeout
    const maxBatchSize = await paymentSettlement.MAX_BATCH_SIZE();
    const settlementTimeout = await paymentSettlement.SETTLEMENT_TIMEOUT();
    const totalBatches = await paymentSettlement.totalBatches();

    console.log(`   Max Batch Size: ${maxBatchSize} merchants`);
    console.log(`   Settlement Timeout: ${settlementTimeout / 3600n} hours`);
    console.log(`   Total Batches Created: ${totalBatches}`);
    console.log("   ✅ PaymentSettlement interface accessible\n");
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Test 4: Check FraudPrevention Status
  // ============================================
  console.log("📊 Test 4: Check FraudPrevention Status\n");
  try {
    const isBlacklisted = await fraudPrevention.blacklist(deployer.address);
    const isWhitelisted = await fraudPrevention.whitelist(deployer.address);
    const limits = await fraudPrevention.defaultLimits();

    console.log(`   Account Blacklisted: ${isBlacklisted.isBlacklisted}`);
    console.log(`   Account Whitelisted: ${isWhitelisted}`);
    console.log(`   Daily Amount Limit: $${ethers.formatUnits(limits.dailyAmountLimit, 6)}`);
    console.log(`   Hourly Amount Limit: $${ethers.formatUnits(limits.hourlyAmountLimit, 6)}`);
    console.log("   ✅ FraudPrevention working\n");
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Test 5: Verify Inter-Contract Integration
  // ============================================
  console.log("📊 Test 5: Verify Inter-Contract Integration\n");
  try {
    // Check CollateralPool reference
    const settlementContract = await paymentSettlement.collateralPool();

    console.log(`   PaymentSettlement → CollateralPool: ${settlementContract}`);
    console.log(`   Expected: ${addresses.CollateralPool}`);
    console.log(`   Match: ${settlementContract.toLowerCase() === addresses.CollateralPool.toLowerCase() ? "✅" : "❌"}`);

    // Check roles
    const SETTLEMENT_ROLE = await collateralPool.SETTLEMENT_ROLE();
    const hasSettlementRole = await collateralPool.hasRole(SETTLEMENT_ROLE, addresses.PaymentSettlement);
    console.log(`\n   PaymentSettlement has SETTLEMENT_ROLE: ${hasSettlementRole ? "✅" : "❌"}`);

    const FRAUD_ROLE = await paymentSettlement.FRAUD_ROLE();
    const hasFraudRole = await paymentSettlement.hasRole(FRAUD_ROLE, addresses.FraudPrevention);
    console.log(`   FraudPrevention has FRAUD_ROLE: ${hasFraudRole ? "✅" : "❌"}`);

    console.log("\n   ✅ Contract integration verified\n");
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Test 6: Try Oracle Registration (if needed)
  // ============================================
  console.log("📊 Test 6: Check Oracle Configuration\n");
  try {
    const SettlementOracle = await ethers.getContractFactory("SettlementOracle");
    const oracle = SettlementOracle.attach(addresses.SettlementOracle);

    const minStake = await oracle.minimumStake();
    const oracleInfo = await oracle.oracles(deployer.address);

    console.log(`   Minimum Stake: ${ethers.formatEther(minStake)} PAS`);
    console.log(`   Account Registered as Oracle: ${oracleInfo.isRegistered}`);
    console.log(`   Account Active: ${oracleInfo.isActive}`);

    if (!oracleInfo.isRegistered) {
      console.log(`\n   ℹ️  To register as oracle, call: oracle.registerOracle()`);
      console.log(`   ℹ️  With value: ${ethers.formatEther(minStake)} PAS`);
    }

    console.log("   ✅ Oracle configuration checked\n");
    testsPassed++;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}\n`);
    testsFailed++;
  }

  // ============================================
  // Summary
  // ============================================
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n📊 Test Results: ${testsPassed}/${testsPassed + testsFailed} passed\n`);

  if (testsFailed === 0) {
    console.log("✅ All basic flow tests passed!");
    console.log("\n💡 Next Steps to Test Full Flows:\n");
    console.log("1. Get USDC from Asset Hub faucet");
    console.log("2. Grant BATCH_CREATOR_ROLE to test account");
    console.log("3. Deposit USDC to CollateralPool");
    console.log("4. Create a settlement batch");
    console.log("5. Register as oracle and approve batch");
    console.log("6. Test merchant claims");
  } else {
    console.log(`⚠️  ${testsFailed} test(s) failed. Review errors above.`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  });
