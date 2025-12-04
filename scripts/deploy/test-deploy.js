const { ethers } = require("hardhat");

async function main() {
  console.log("\n🧪 Testing deployment to Paseo...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "PAS");
  console.log("Network:", network.name);
  console.log("");

  // Deploy smallest contract first
  console.log("Deploying MockTarget...");
  const MockTarget = await ethers.getContractFactory("contracts/mocks/MockTarget.sol:MockTarget");
  const target = await MockTarget.deploy();

  console.log("Waiting for deployment...");
  await target.waitForDeployment();

  const address = await target.getAddress();
  console.log("\n✅ MockTarget deployed:", address);
  console.log("");

  // Get bytecode size
  const code = await ethers.provider.getCode(address);
  console.log("Deployed bytecode size:", code.length / 2 - 1, "bytes");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error:", error);
    process.exit(1);
  });
