const fs = require("fs");
const path = require("path");

/**
 * Utility to update contract addresses in e2e test scripts after deployment
 * Run this after deploy-all.js with the deployed addresses
 */

function updateAddresses(addresses) {
  // Update e2e complete-flow.js
  const e2ePath = path.join(__dirname, "../e2e/complete-flow.js");
  let e2eContent = fs.readFileSync(e2ePath, "utf8");

  // Replace placeholder addresses
  e2eContent = e2eContent.replace(
    /usdc: "0x[^"]*"/,
    `usdc: "${addresses.usdc}"`
  );
  e2eContent = e2eContent.replace(
    /transactionRegistry: "0x[^"]*"/,
    `transactionRegistry: "${addresses.transactionRegistry}"`
  );
  e2eContent = e2eContent.replace(
    /crossBorderSettlement: "0x[^"]*"/,
    `crossBorderSettlement: "${addresses.crossBorderSettlement}"`
  );
  e2eContent = e2eContent.replace(
    /settlementOracle: "0x[^"]*"/,
    `settlementOracle: "${addresses.settlementOracle}"`
  );

  fs.writeFileSync(e2ePath, e2eContent);
  console.log("✅ Updated e2e/complete-flow.js");

  // Update .env file with addresses
  const envPath = path.join(__dirname, "../../.env");
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

  // Remove old addresses if they exist
  envContent = envContent.replace(/\nMOCK_USDC_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nTRANSACTION_REGISTRY_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nCROSS_BORDER_SETTLEMENT_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nFRAUD_PREVENTION_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nSETTLEMENT_ORACLE_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nTATAPAY_GOVERNANCE_ADDRESS=.*/g, "");
  envContent = envContent.replace(/\nYARA_SETTLEMENT_ADDRESS=.*/g, "");

  // Add new addresses
  envContent += `\n# Contract Addresses (Updated ${new Date().toISOString()})`;
  envContent += `\nMOCK_USDC_ADDRESS=${addresses.usdc}`;
  envContent += `\nTRANSACTION_REGISTRY_ADDRESS=${addresses.transactionRegistry}`;
  envContent += `\nCROSS_BORDER_SETTLEMENT_ADDRESS=${addresses.crossBorderSettlement}`;
  envContent += `\nFRAUD_PREVENTION_ADDRESS=${addresses.fraudPrevention}`;
  envContent += `\nSETTLEMENT_ORACLE_ADDRESS=${addresses.settlementOracle}`;
  envContent += `\nTATAPAY_GOVERNANCE_ADDRESS=${addresses.governance}`;
  envContent += `\nYARA_SETTLEMENT_ADDRESS=${addresses.yaraSettlement}`;
  envContent += "\n";

  fs.writeFileSync(envPath, envContent);
  console.log("✅ Updated .env file");

  // Create deployment record
  const deploymentRecord = {
    network: "paseo",
    deployedAt: new Date().toISOString(),
    addresses: addresses,
    blockExplorer: "https://blockscout-passet-hub.parity-testnet.parity.io"
  };

  const deploymentPath = path.join(__dirname, "../../deployments/paseo-latest.json");
  const deploymentsDir = path.dirname(deploymentPath);

  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(deploymentRecord, null, 2)
  );
  console.log("✅ Created deployment record: deployments/paseo-latest.json");
}

// If called directly from command line with addresses
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("\nUsage: node update-addresses.js <addresses-json>");
    console.log("\nExample:");
    console.log('node update-addresses.js \'{"usdc": "0x...", "transactionRegistry": "0x...", ...}\'');
    process.exit(1);
  }

  try {
    const addresses = JSON.parse(args[0]);
    updateAddresses(addresses);
    console.log("\n✅ All addresses updated successfully!");
  } catch (error) {
    console.error("❌ Error parsing addresses:", error);
    console.log("\nMake sure to provide valid JSON with all required addresses:");
    console.log("- usdc");
    console.log("- transactionRegistry");
    console.log("- crossBorderSettlement");
    console.log("- fraudPrevention");
    console.log("- settlementOracle");
    console.log("- governance");
    console.log("- yaraSettlement");
    process.exit(1);
  }
}

module.exports = { updateAddresses };