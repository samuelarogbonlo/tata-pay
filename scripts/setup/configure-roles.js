const { ethers } = require("hardhat");

async function main() {
  console.log("\n🔐 Configuring Inter-Contract Roles\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const [admin] = await ethers.getSigners();
  console.log("Admin:", admin.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(admin.address)), "PAS\n");

  // Contract addresses
  const addresses = {
    CollateralPool: "0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9",
    FraudPrevention: "0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f",
    PaymentSettlement: "0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174",
    SettlementOracle: "0xEB7278C528817fB51c1837Cb0666c02922d542F1",
    TataPayGovernance: "0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260",
  };

  // Attach to contracts
  const CollateralPool = await ethers.getContractFactory(
    "contracts/core/CollateralPoolUpgradeable.sol:CollateralPoolUpgradeable"
  );
  const collateralPool = CollateralPool.attach(addresses.CollateralPool);

  const PaymentSettlement = await ethers.getContractFactory("PaymentSettlement");
  const paymentSettlement = PaymentSettlement.attach(addresses.PaymentSettlement);

  // Get role hashes
  const SETTLEMENT_ROLE = await collateralPool.SETTLEMENT_ROLE();
  const SLASHER_ROLE = await collateralPool.SLASHER_ROLE();
  const FRAUD_ROLE = await paymentSettlement.FRAUD_ROLE();
  const ORACLE_ROLE = await paymentSettlement.ORACLE_ROLE();

  console.log("📋 Checking Current Role Configuration:\n");

  // Check existing roles
  const hasSettlementRole = await collateralPool.hasRole(
    SETTLEMENT_ROLE,
    addresses.PaymentSettlement
  );
  const hasSlasherRole = await collateralPool.hasRole(
    SLASHER_ROLE,
    addresses.FraudPrevention
  );
  const hasFraudRole = await paymentSettlement.hasRole(
    FRAUD_ROLE,
    addresses.FraudPrevention
  );
  const hasOracleRole = await paymentSettlement.hasRole(
    ORACLE_ROLE,
    addresses.SettlementOracle
  );

  console.log("CollateralPool roles:");
  console.log(`  ${hasSettlementRole ? "✅" : "❌"} SETTLEMENT_ROLE → PaymentSettlement`);
  console.log(`  ${hasSlasherRole ? "✅" : "❌"} SLASHER_ROLE → FraudPrevention`);
  console.log("\nPaymentSettlement roles:");
  console.log(`  ${hasOracleRole ? "✅" : "❌"} ORACLE_ROLE → SettlementOracle`);
  console.log(`  ${hasFraudRole ? "✅" : "❌"} FRAUD_ROLE → FraudPrevention`);
  console.log();

  // Grant missing roles
  const rolesToGrant = [];

  if (!hasSlasherRole) {
    rolesToGrant.push({
      contract: "CollateralPool",
      role: "SLASHER_ROLE",
      grantee: "FraudPrevention",
    });
  }

  if (!hasFraudRole) {
    rolesToGrant.push({
      contract: "PaymentSettlement",
      role: "FRAUD_ROLE",
      grantee: "FraudPrevention",
    });
  }

  if (rolesToGrant.length === 0) {
    console.log("✅ All roles are already configured!\n");
    return;
  }

  console.log(`🔧 Granting ${rolesToGrant.length} missing roles...\n`);

  for (const roleConfig of rolesToGrant) {
    console.log(`Granting ${roleConfig.role} to ${roleConfig.grantee} on ${roleConfig.contract}...`);

    try {
      let tx;
      if (roleConfig.contract === "CollateralPool" && roleConfig.role === "SLASHER_ROLE") {
        tx = await collateralPool.grantRole(SLASHER_ROLE, addresses.FraudPrevention);
      } else if (roleConfig.contract === "PaymentSettlement" && roleConfig.role === "FRAUD_ROLE") {
        tx = await paymentSettlement.grantRole(FRAUD_ROLE, addresses.FraudPrevention);
      }

      console.log(`  Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log("  ✅ Role granted\n");
    } catch (error) {
      console.log(`  ❌ Failed: ${error.message}\n`);
    }
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 Role configuration complete!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  // Verify all roles
  console.log("🔍 Final Role Verification:\n");

  const finalSettlement = await collateralPool.hasRole(
    SETTLEMENT_ROLE,
    addresses.PaymentSettlement
  );
  const finalSlasher = await collateralPool.hasRole(
    SLASHER_ROLE,
    addresses.FraudPrevention
  );
  const finalFraud = await paymentSettlement.hasRole(
    FRAUD_ROLE,
    addresses.FraudPrevention
  );
  const finalOracle = await paymentSettlement.hasRole(
    ORACLE_ROLE,
    addresses.SettlementOracle
  );

  console.log("CollateralPool:");
  console.log(`  ${finalSettlement ? "✅" : "❌"} SETTLEMENT_ROLE → PaymentSettlement`);
  console.log(`  ${finalSlasher ? "✅" : "❌"} SLASHER_ROLE → FraudPrevention`);
  console.log("\nPaymentSettlement:");
  console.log(`  ${finalOracle ? "✅" : "❌"} ORACLE_ROLE → SettlementOracle`);
  console.log(`  ${finalFraud ? "✅" : "❌"} FRAUD_ROLE → FraudPrevention`);
  console.log();

  const allConfigured = finalSettlement && finalSlasher && finalFraud && finalOracle;
  if (allConfigured) {
    console.log("✅ All inter-contract roles properly configured!\n");
  } else {
    console.log("⚠️  Some roles are still missing. Review errors above.\n");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Configuration failed:", error);
    process.exit(1);
  });
