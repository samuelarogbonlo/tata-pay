const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking all deployed contracts...\n");

  const contracts = [
    { name: "CollateralPool (Proxy)", address: "0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9", factory: "CollateralPoolUpgradeable" },
    { name: "FraudPrevention", address: "0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f", factory: "FraudPrevention" },
    { name: "PaymentSettlement", address: "0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174", factory: "PaymentSettlement" },
    { name: "SettlementOracle", address: "0xe3c5Cf8E75af9B4790D764D1a34303b6720575Fb", factory: "SettlementOracle" },
    { name: "TataPayGovernance", address: "0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260", factory: "TataPayGovernance" },
  ];

  for (const contract of contracts) {
    console.log(`\n📦 ${contract.name}`);
    console.log(`   Address: ${contract.address}`);

    const code = await ethers.provider.getCode(contract.address);
    console.log(`   Code size: ${(code.length - 2) / 2} bytes`);

    const Contract = await ethers.getContractFactory(contract.factory);
    const instance = Contract.attach(contract.address);

    // Try a simple view function
    try {
      if (contract.factory === "CollateralPoolUpgradeable") {
        const version = await instance.version();
        console.log(`   ✅ version(): ${version}`);
      } else if (contract.factory === "FraudPrevention") {
        const hourly = await instance.DEFAULT_HOURLY_TX_LIMIT();
        console.log(`   ✅ DEFAULT_HOURLY_TX_LIMIT(): ${hourly}`);
      } else if (contract.factory === "PaymentSettlement") {
        const maxBatch = await instance.MAX_BATCH_SIZE();
        console.log(`   ✅ MAX_BATCH_SIZE(): ${maxBatch}`);
      } else if (contract.factory === "SettlementOracle") {
        const settlement = await instance.paymentSettlement();
        console.log(`   ✅ paymentSettlement(): ${settlement}`);
      } else if (contract.factory === "TataPayGovernance") {
        const delay = await instance.standardDelay();
        console.log(`   ✅ standardDelay(): ${delay / 3600}h`);
      }
    } catch (e) {
      console.log(`   ❌ Contract call failed: ${e.message}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
