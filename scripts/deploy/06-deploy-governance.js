const { ethers } = require("hardhat");

/**
 * Deploy TataPayGovernance contract to Asset Hub
 *
 * This script deploys the TataPayGovernance contract which implements
 * multi-signature governance with timelocks for the Tata-Pay system.
 *
 * Features:
 * - Multi-signature approval (M-of-N configuration)
 * - Time-locked execution for security
 * - Proposal creation and execution
 * - Role management across system contracts
 * - Emergency actions with reduced delay
 */

async function main() {
  console.log("\n🚀 Deploying TataPayGovernance to Asset Hub...\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("📝 Deployment Details:");
  console.log("─────────────────────────────────────");
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} PAS`);
  console.log(`Network: ${network.name}`);
  console.log("");

  // Verify sufficient balance
  if (balance < ethers.parseEther("0.1")) {
    console.log("❌ Insufficient balance for deployment");
    console.log("   Get testnet tokens from:");
    console.log("   https://faucet.polkadot.io/?parachain=1111");
    console.log("");
    process.exit(1);
  }

  // Configure governance parameters
  console.log("⚙️  Governance Configuration:");
  console.log("─────────────────────────────────────");

  // Get governor addresses from environment or use defaults
  const governorAddresses = process.env.GOVERNOR_ADDRESSES
    ? process.env.GOVERNOR_ADDRESSES.split(",")
    : [deployer.address]; // Default to deployer only for testing

  const requiredApprovals = process.env.REQUIRED_APPROVALS
    ? parseInt(process.env.REQUIRED_APPROVALS)
    : Math.ceil(governorAddresses.length / 2); // Default to majority

  console.log(`Total Governors: ${governorAddresses.length}`);
  console.log(`Required Approvals: ${requiredApprovals} (${requiredApprovals}-of-${governorAddresses.length})`);
  console.log("\nGovernor Addresses:");
  governorAddresses.forEach((addr, i) => {
    console.log(`  ${i + 1}. ${addr}`);
  });
  console.log("");

  // Validate configuration
  if (governorAddresses.length === 0) {
    console.log("❌ No governor addresses provided");
    console.log("   Set GOVERNOR_ADDRESSES environment variable");
    console.log("   Example: export GOVERNOR_ADDRESSES=0x...,0x...,0x...");
    console.log("");
    process.exit(1);
  }

  if (requiredApprovals <= 0 || requiredApprovals > governorAddresses.length) {
    console.log("❌ Invalid required approvals");
    console.log(`   Must be between 1 and ${governorAddresses.length}`);
    console.log("");
    process.exit(1);
  }

  console.log("📦 Deploying TataPayGovernance...");

  try {
    // Deploy TataPayGovernance
    const TataPayGovernance = await ethers.getContractFactory("TataPayGovernance");
    const governance = await TataPayGovernance.deploy(
      governorAddresses,
      requiredApprovals
    );

    console.log("⏳ Waiting for deployment...");
    await governance.waitForDeployment();

    const governanceAddress = await governance.getAddress();

    console.log("\n✅ Deployment Successful!");
    console.log("─────────────────────────────────────");
    console.log(`TataPayGovernance: ${governanceAddress}`);
    console.log("");

    // Verify configuration
    console.log("📋 Configuration:");
    console.log("─────────────────────────────────────");
    const totalGovernors = await governance.totalGovernors();
    const required = await governance.requiredApprovals();
    const standardDelay = await governance.standardDelay();
    const emergencyDelay = await governance.emergencyDelay();
    const proposalLifetime = await governance.proposalLifetime();

    console.log(`Total Governors: ${totalGovernors}`);
    console.log(`Required Approvals: ${required}`);
    console.log(`Standard Delay: ${Number(standardDelay) / 3600} hours`);
    console.log(`Emergency Delay: ${Number(emergencyDelay) / 3600} hours`);
    console.log(`Proposal Lifetime: ${Number(proposalLifetime) / 86400} days`);
    console.log("");

    // Verify roles
    console.log("🔐 Roles:");
    console.log("─────────────────────────────────────");
    const DEFAULT_ADMIN_ROLE = await governance.DEFAULT_ADMIN_ROLE();
    const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
    const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();

    console.log(`DEFAULT_ADMIN_ROLE: ${ethers.hexlify(DEFAULT_ADMIN_ROLE)}`);
    console.log(`  Holder: ${governanceAddress} (contract itself)`);
    console.log("");
    console.log(`GOVERNOR_ROLE: ${ethers.hexlify(GOVERNOR_ROLE)}`);
    console.log(`PROPOSER_ROLE: ${ethers.hexlify(PROPOSER_ROLE)}`);
    console.log(`EXECUTOR_ROLE: ${ethers.hexlify(EXECUTOR_ROLE)}`);
    console.log("");

    // Verify each governor has correct roles
    console.log("Governor Role Verification:");
    for (let i = 0; i < governorAddresses.length; i++) {
      const addr = governorAddresses[i];
      const hasGovernor = await governance.hasRole(GOVERNOR_ROLE, addr);
      const hasProposer = await governance.hasRole(PROPOSER_ROLE, addr);
      const hasExecutor = await governance.hasRole(EXECUTOR_ROLE, addr);
      console.log(`  ${i + 1}. ${addr}`);
      console.log(`     Governor: ${hasGovernor ? "✓" : "✗"}`);
      console.log(`     Proposer: ${hasProposer ? "✓" : "✗"}`);
      console.log(`     Executor: ${hasExecutor ? "✓" : "✗"}`);
    }
    console.log("");

    // Verify metrics
    console.log("📊 Initial Metrics:");
    console.log("─────────────────────────────────────");
    const [totalCreated, totalExecuted, totalCancelled, _totalGovs, _required] =
      await governance.getMetrics();
    console.log(`Total Proposals Created: ${totalCreated}`);
    console.log(`Total Proposals Executed: ${totalExecuted}`);
    console.log(`Total Proposals Cancelled: ${totalCancelled}`);
    console.log(`Proposal Count: ${await governance.proposalCount()}`);
    console.log("");

    // Save deployment info
    const deploymentInfo = {
      network: network.name,
      chainId: (await ethers.provider.getNetwork()).chainId.toString(),
      contract: "TataPayGovernance",
      address: governanceAddress,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      configuration: {
        totalGovernors: Number(totalGovernors),
        requiredApprovals: Number(required),
        standardDelay: Number(standardDelay),
        emergencyDelay: Number(emergencyDelay),
        proposalLifetime: Number(proposalLifetime),
      },
      governors: governorAddresses,
      roles: {
        defaultAdminRole: ethers.hexlify(DEFAULT_ADMIN_ROLE),
        governorRole: ethers.hexlify(GOVERNOR_ROLE),
        proposerRole: ethers.hexlify(PROPOSER_ROLE),
        executorRole: ethers.hexlify(EXECUTOR_ROLE),
      },
    };

    console.log("💾 Deployment Info:");
    console.log(JSON.stringify(deploymentInfo, null, 2));
    console.log("");

    console.log("🔍 Verify on Block Explorer:");
    if (network.name === "paseo") {
      console.log(
        `https://blockscout-passet-hub.parity-testnet.parity.io/address/${governanceAddress}`
      );
    }
    console.log("");

    console.log("⚠️  Next Steps:");
    console.log("─────────────────────────────────────");
    console.log("1. Grant system roles to governance contract:");
    console.log("   - CollateralPool.DEFAULT_ADMIN_ROLE");
    console.log("   - PaymentSettlement.DEFAULT_ADMIN_ROLE");
    console.log("   - FraudPrevention.DEFAULT_ADMIN_ROLE");
    console.log("   - SettlementOracle.DEFAULT_ADMIN_ROLE");
    console.log("");
    console.log("2. Test governance flow:");
    console.log("   a. Create a test proposal");
    console.log("   b. Approve with required number of governors");
    console.log("   c. Wait for timelock period");
    console.log("   d. Execute proposal");
    console.log("");
    console.log("3. Example: Update CollateralPool fee");
    console.log("   const data = collateralPool.interface.encodeFunctionData('updateFee', [newFee])");
    console.log("   await governance.propose(collateralPoolAddress, 0, data, 'Update fee', 0)");
    console.log("   // Get M approvals");
    console.log("   await governance.approve(proposalId) // x M governors");
    console.log("   // Wait 48 hours");
    console.log("   await governance.execute(proposalId)");
    console.log("");
    console.log("4. Setup monitoring for:");
    console.log("   - ProposalCreated events");
    console.log("   - ProposalApproved events");
    console.log("   - ProposalExecuted events");
    console.log("   - ProposalCancelled events");
    console.log("");
    console.log("5. Document governance procedures for team");
    console.log("6. Consider hardware wallets for governor keys");
    console.log("7. Establish emergency action procedures");
    console.log("");

    console.log("📖 Governance Workflow:");
    console.log("─────────────────────────────────────");
    console.log("Standard Proposal (48h delay):");
    console.log("  1. Any governor creates proposal");
    console.log(`  2. ${required} governors approve`);
    console.log("  3. Wait 48 hours after approval");
    console.log("  4. Any executor executes proposal");
    console.log("");
    console.log("Emergency Proposal (6h delay):");
    console.log("  1. Any governor creates emergency proposal");
    console.log(`  2. ${required} governors approve`);
    console.log("  3. Wait 6 hours after approval");
    console.log("  4. Any executor executes proposal");
    console.log("");
    console.log("Cancellation:");
    console.log("  - Any governor can cancel Pending or Approved proposal");
    console.log("");
    console.log("Expiration:");
    console.log("  - Proposals expire after 7 days if not executed");
    console.log("");

    console.log("🔐 Security Considerations:");
    console.log("─────────────────────────────────────");
    console.log("- Contract is its own admin (self-governance)");
    console.log("- All admin actions require governance proposals");
    console.log("- Timelock provides window to detect malicious proposals");
    console.log("- Proposal expiration prevents indefinite approvals");
    console.log("- Multi-sig prevents single point of failure");
    console.log("- Role-based access control for different operations");
    console.log("");

    console.log("✅ TataPayGovernance deployment complete!");

    return { governance, deploymentInfo };
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    throw error;
  }
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

module.exports = { main };
