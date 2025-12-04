const { ethers } = require("hardhat");

/**
 * Multi-Signature Wallet Setup Script (3-of-5)
 *
 * ⚠️  IMPORTANT: This is a PLANNING and KEY GENERATION tool only.
 * It does NOT deploy an actual multi-sig wallet on-chain.
 *
 * What this script does:
 * - Generates 5 test signer addresses and private keys
 * - Calculates a deterministic multi-sig address (for planning)
 * - Creates documentation and .env entries
 * - Outputs security guidelines and checklists
 *
 * What this script does NOT do:
 * - Deploy a multi-sig contract on-chain
 * - Create a Gnosis Safe wallet
 * - Configure Polkadot multi-sig pallet
 * - Set up actual on-chain signature collection
 *
 * For ACTUAL multi-sig deployment, you must:
 * 1. Deploy Gnosis Safe contract (when available on Asset Hub)
 * 2. Use Polkadot.js Apps to create native multi-sig via pallet
 * 3. Deploy a custom multi-sig smart contract
 * 4. Configure Safe SDK for signature collection
 *
 * This script is Step 0: Planning and key management preparation.
 */

// Configuration
const MULTISIG_CONFIG = {
  threshold: 3, // 3 signatures required
  signers: 5,   // 5 total signers
};

/**
 * Generate test signer addresses for development
 * In production, these should be replaced with real team addresses
 */
async function generateTestSigners(count) {
  console.log(`\n📝 Generating ${count} test signer addresses...\n`);

  const signers = [];

  for (let i = 0; i < count; i++) {
    const wallet = ethers.Wallet.createRandom();
    signers.push({
      index: i + 1,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic.phrase,
    });
  }

  return signers;
}

/**
 * Display multi-sig configuration
 */
function displayConfig(signers) {
  console.log("⚙️  Multi-Sig Configuration:");
  console.log("─────────────────────────────────────");
  console.log(`Threshold: ${MULTISIG_CONFIG.threshold} of ${MULTISIG_CONFIG.signers}`);
  console.log(`Type: ${MULTISIG_CONFIG.threshold}-of-${MULTISIG_CONFIG.signers} Multi-Signature Wallet`);
  console.log("");

  console.log("👥 Signers:");
  console.log("─────────────────────────────────────");
  signers.forEach((signer) => {
    console.log(`Signer ${signer.index}:`);
    console.log(`  Address: ${signer.address}`);
    console.log(`  Private Key: ${signer.privateKey}`);
    console.log("");
  });
}

/**
 * Calculate deterministic multi-sig address (Ethereum-style)
 * For production, use Gnosis Safe factory or native Polkadot multi-sig
 */
function calculateMultisigAddress(signers, threshold) {
  // Sort addresses for deterministic calculation
  const sortedAddresses = signers
    .map(s => s.address)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  // Simple hash-based multi-sig address generation
  // In production, use proper multi-sig factory
  const packed = ethers.solidityPacked(
    ["address[]", "uint256"],
    [sortedAddresses, threshold]
  );

  const hash = ethers.keccak256(packed);

  // Take first 20 bytes for address
  const multisigAddress = "0x" + hash.slice(26);

  return multisigAddress;
}

/**
 * Create deployment checklist for multi-sig
 */
function createChecklist(multisigAddress, signers) {
  console.log("\n📋 Next Steps for ACTUAL Multi-Sig Deployment:");
  console.log("─────────────────────────────────────");
  console.log("⚠️  The calculated address below is NOT deployed on-chain yet!");
  console.log("");
  console.log("To create a real multi-sig wallet, you must:");
  console.log("[ ] 1. Deploy Gnosis Safe factory contract (or use existing)");
  console.log("[ ] 2. Create Safe wallet with these 5 signers");
  console.log("[ ] 3. Set threshold to 3 signatures");
  console.log("[ ] 4. Fund the actual deployed multi-sig address");
  console.log("[ ] 5. Transfer contract ownership to deployed multi-sig");
  console.log("[ ] 6. Test signature collection with test transaction");
  console.log("[ ] 7. Distribute keys to team (hardware wallets)");
  console.log("[ ] 8. Document emergency recovery procedures");
  console.log("");

  console.log("💰 Multi-Sig Address (calculated for planning):");
  console.log(multisigAddress);
  console.log("");
  console.log("⚠️  DO NOT SEND FUNDS to this address yet!");
  console.log("   This is NOT a deployed contract.");
  console.log("   Deploy actual multi-sig first (steps above).");
  console.log("");
}

/**
 * Generate .env entries for signers
 */
function generateEnvEntries(signers) {
  console.log("\n🔐 Environment Variables (.env):");
  console.log("─────────────────────────────────────");
  console.log("# Multi-Sig Signers (3-of-5)");

  signers.forEach((signer) => {
    console.log(`SIGNER_${signer.index}_ADDRESS=${signer.address}`);
    console.log(`SIGNER_${signer.index}_PRIVATE_KEY=${signer.privateKey}`);
  });

  console.log("");
}

/**
 * Create multi-sig wallet documentation
 */
function generateDocumentation(multisigAddress, signers) {
  const doc = {
    title: "Tata-Pay Multi-Signature Wallet Configuration",
    version: "1.0.0",
    date: new Date().toISOString(),
    configuration: {
      threshold: MULTISIG_CONFIG.threshold,
      totalSigners: MULTISIG_CONFIG.signers,
      type: `${MULTISIG_CONFIG.threshold}-of-${MULTISIG_CONFIG.signers}`,
    },
    multisigAddress: multisigAddress,
    signers: signers.map((s) => ({
      index: s.index,
      address: s.address,
      role: `Signer ${s.index}`,
    })),
    securityGuidelines: [
      "Store private keys in hardware wallets (Ledger, Trezor)",
      "Distribute signers across different geographic locations",
      "Never share private keys via insecure channels",
      "Implement key rotation every 6 months",
      "Set up social recovery with designated guardians",
      "Test signature collection workflow on testnet first",
    ],
    emergencyProcedures: [
      "If a signer's key is compromised, rotate multi-sig immediately",
      "Maintain 24/7 availability for emergency signatures",
      "Document all multi-sig transactions with reason and approvers",
      "Set up automated alerts for multi-sig proposals",
    ],
    usage: {
      proposeTransaction: "Propose new transaction via multi-sig interface",
      collectSignatures: "Collect minimum 3 signatures from 5 signers",
      executeTransaction: "Execute after threshold reached",
      cancelTransaction: "Any signer can cancel pending transaction",
    },
  };

  return doc;
}

/**
 * Main execution
 */
async function main() {
  console.log("\n🔐 Tata-Pay Multi-Signature Wallet Setup");
  console.log("═════════════════════════════════════════════════════");
  console.log("\n⚠️  IMPORTANT: This is a PLANNING TOOL ONLY");
  console.log("   This does NOT deploy an actual multi-sig wallet on-chain.");
  console.log("   See script header for actual deployment instructions.\n");

  // Generate test signers
  const signers = await generateTestSigners(MULTISIG_CONFIG.signers);

  // Display configuration
  displayConfig(signers);

  // Calculate multi-sig address
  const multisigAddress = calculateMultisigAddress(signers, MULTISIG_CONFIG.threshold);

  console.log("🏦 Calculated Multi-Sig Address:");
  console.log("─────────────────────────────────────");
  console.log(multisigAddress);
  console.log("");
  console.log("⚠️  Note: This is a deterministic calculation.");
  console.log("   Deploy Gnosis Safe or multi-sig contract for production.");
  console.log("");

  // Generate checklist
  createChecklist(multisigAddress, signers);

  // Generate .env entries
  generateEnvEntries(signers);

  // Generate documentation
  const documentation = generateDocumentation(multisigAddress, signers);

  console.log("📄 Documentation Generated:");
  console.log(JSON.stringify(documentation, null, 2));
  console.log("");

  // Save to file
  const fs = require("fs");
  const path = require("path");

  const outputPath = path.join(__dirname, "../../docs/multisig-setup.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(documentation, null, 2));

  console.log("✅ Multi-sig configuration saved to:");
  console.log(`   ${outputPath}`);
  console.log("");

  console.log("🎯 Next Steps:");
  console.log("─────────────────────────────────────");
  console.log("1. Review generated signer addresses and keys");
  console.log("2. For PRODUCTION: Replace with real team addresses");
  console.log("3. Deploy Gnosis Safe contract (when available)");
  console.log("4. Update .env with production signer keys");
  console.log("5. Test signature collection workflow");
  console.log("");

  console.log("⚠️  SECURITY WARNING:");
  console.log("─────────────────────────────────────");
  console.log("• These are TEST keys for development only");
  console.log("• NEVER use these keys with real funds");
  console.log("• For production, use hardware wallets");
  console.log("• Store keys in secure, encrypted storage");
  console.log("");

  return {
    multisigAddress,
    signers,
    documentation,
  };
}

// Execute
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Error:", error);
      process.exit(1);
    });
}

module.exports = { main, generateTestSigners, calculateMultisigAddress };
