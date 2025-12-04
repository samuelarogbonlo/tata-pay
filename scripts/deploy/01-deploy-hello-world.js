const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting Hello World deployment to Paseo Asset Hub...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("📝 Deployment Details:");
  console.log("─────────────────────────────────────");
  console.log("Deployer address:", deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "PAS");
  console.log("Network:", (await ethers.provider.getNetwork()).name);
  console.log("Chain ID:", (await ethers.provider.getNetwork()).chainId);
  console.log("");

  // Check if deployer has sufficient balance
  if (balance === 0n) {
    console.log("❌ ERROR: Deployer has zero balance!");
    console.log("📍 Get testnet tokens from:");
    console.log("   https://faucet.polkadot.io/?parachain=1111");
    console.log("");
    process.exit(1);
  }

  console.log("📦 Deploying MyToken (Hello World)...");

  try {
    // Deploy MyToken contract with initial supply
    // 1,000,000 tokens with 18 decimals
    const initialSupply = ethers.parseEther("1000000");

    const MyToken = await ethers.getContractFactory("MyToken");
    const myToken = await MyToken.deploy(initialSupply);

    console.log("⏳ Waiting for deployment...");
    await myToken.waitForDeployment();

    const tokenAddress = await myToken.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log("Contract Address:", tokenAddress);
    console.log("Transaction Hash:", myToken.deploymentTransaction().hash);
    console.log("Block Number:", myToken.deploymentTransaction().blockNumber);
    console.log("");

    // Get contract details
    const name = await myToken.name();
    const symbol = await myToken.symbol();
    const totalSupply = await myToken.totalSupply();

    console.log("📋 Token Details:");
    console.log("─────────────────────────────────────");
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Total Supply:", ethers.formatEther(totalSupply));
    console.log("Owner:", deployer.address);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: (await ethers.provider.getNetwork()).name,
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      contract: "MyToken",
      address: tokenAddress,
      deployer: deployer.address,
      transactionHash: myToken.deploymentTransaction().hash,
      blockNumber: myToken.deploymentTransaction().blockNumber,
      timestamp: new Date().toISOString(),
      tokenDetails: {
        name,
        symbol,
        totalSupply: ethers.formatEther(totalSupply),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    console.log(`https://blockscout-passet-hub.parity-testnet.parity.io/address/${tokenAddress}`);
    console.log("");

    console.log("✅ Hello World deployment complete!");

    return deploymentInfo;

  } catch (error) {
    console.error("\n❌ Deployment failed!");
    console.error("Error:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.log("\n💡 Tip: Get testnet tokens from:");
      console.log("   https://faucet.polkadot.io/?parachain=1111");
    }

    process.exit(1);
  }
}

// Execute deployment
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
