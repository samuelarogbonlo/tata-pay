const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("TataPayGovernance - Integration Tests", function () {
  // Constants
  const STANDARD_DELAY = 48n * 60n * 60n; // 48 hours
  const EMERGENCY_DELAY = 6n * 60n * 60n; // 6 hours
  const PROPOSAL_LIFETIME = 7n * 24n * 60n * 60n; // 7 days

  // Test fixture
  async function deployFixture() {
    const [admin, governor1, governor2, governor3, governor4, governor5, user1] =
      await ethers.getSigners();

    // Deploy TataPayGovernance with 3-of-5 configuration
    const TataPayGovernance = await ethers.getContractFactory("TataPayGovernance");
    const governance = await TataPayGovernance.deploy(
      [governor1.address, governor2.address, governor3.address, governor4.address, governor5.address],
      3 // 3-of-5 required approvals
    );

    // Deploy a mock target contract for testing proposals
    const MockTarget = await ethers.getContractFactory("contracts/mocks/MockTarget.sol:MockTarget");
    const target = await MockTarget.deploy();

    return {
      governance,
      target,
      admin,
      governor1,
      governor2,
      governor3,
      governor4,
      governor5,
      user1,
    };
  }

  describe("Deployment", function () {
    it("Should deploy with correct configuration", async function () {
      const { governance, governor1, governor2, governor3, governor4, governor5 } = await deployFixture();

      expect(await governance.requiredApprovals()).to.equal(3);
      expect(await governance.totalGovernors()).to.equal(5);
      expect(await governance.standardDelay()).to.equal(STANDARD_DELAY);
      expect(await governance.emergencyDelay()).to.equal(EMERGENCY_DELAY);
      expect(await governance.proposalLifetime()).to.equal(PROPOSAL_LIFETIME);

      // Verify all governors have correct roles
      const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
      const PROPOSER_ROLE = await governance.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await governance.EXECUTOR_ROLE();

      expect(await governance.hasRole(GOVERNOR_ROLE, governor1.address)).to.be.true;
      expect(await governance.hasRole(PROPOSER_ROLE, governor1.address)).to.be.true;
      expect(await governance.hasRole(EXECUTOR_ROLE, governor1.address)).to.be.true;
    });

    it("Should reject deployment with no governors", async function () {
      const TataPayGovernance = await ethers.getContractFactory("TataPayGovernance");

      await expect(
        TataPayGovernance.deploy([], 3)
      ).to.be.revertedWith("TataPayGovernance: No governors");
    });

    it("Should reject deployment with invalid required approvals", async function () {
      const TataPayGovernance = await ethers.getContractFactory("TataPayGovernance");
      const [gov1, gov2] = await ethers.getSigners();

      await expect(
        TataPayGovernance.deploy([gov1.address, gov2.address], 0)
      ).to.be.revertedWith("TataPayGovernance: Invalid required approvals");

      await expect(
        TataPayGovernance.deploy([gov1.address, gov2.address], 3)
      ).to.be.revertedWith("TataPayGovernance: Required > total");
    });
  });

  describe("Proposal Creation", function () {
    it("Should create standard proposal", async function () {
      const { governance, target, governor1 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      const tx = await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Set value to 42",
        0 // Standard
      );
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(governance, "ProposalCreated")
        .withArgs(0, governor1.address, target.target, "Set value to 42", 0, block.timestamp);

      const proposal = await governance.getProposal(0);
      expect(proposal.proposer).to.equal(governor1.address);
      expect(proposal.target).to.equal(target.target);
      expect(proposal.description).to.equal("Set value to 42");
      expect(proposal.proposalType).to.equal(0); // Standard
      expect(proposal.state).to.equal(0); // Pending
      expect(proposal.approvals).to.equal(0);
    });

    it("Should create emergency proposal", async function () {
      const { governance, target, governor1 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [100]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Emergency: Set value to 100",
        1 // Emergency
      );

      const proposal = await governance.getProposal(0);
      expect(proposal.proposalType).to.equal(1); // Emergency
    });

    it("Should reject proposal from non-proposer", async function () {
      const { governance, target, user1 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await expect(
        governance.connect(user1).propose(target.target, 0, data, "Test", 0)
      ).to.be.reverted;
    });

    it("Should reject proposal with invalid target", async function () {
      const { governance, governor1 } = await deployFixture();

      const data = "0x";

      await expect(
        governance.connect(governor1).propose(ethers.ZeroAddress, 0, data, "Test", 0)
      ).to.be.revertedWith("TataPayGovernance: Invalid target");
    });

    it("Should reject proposal with empty description", async function () {
      const { governance, target, governor1 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await expect(
        governance.connect(governor1).propose(target.target, 0, data, "", 0)
      ).to.be.revertedWith("TataPayGovernance: Empty description");
    });

    it("Should reject proposal creation when paused", async function () {
      const { governance, target, governor1, governor2, governor3 } = await deployFixture();

      const DEFAULT_ADMIN_ROLE = await governance.DEFAULT_ADMIN_ROLE();

      // Pause via governance proposal
      const pauseData = governance.interface.encodeFunctionData("pause", []);
      await governance.connect(governor1).propose(governance.target, 0, pauseData, "Pause governance", 0);

      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      await time.increase(STANDARD_DELAY + 1n);
      await governance.connect(governor1).execute(0);

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await expect(
        governance.connect(governor1).propose(target.target, 0, data, "Test", 0)
      ).to.be.reverted;
    });
  });

  describe("Proposal Approval", function () {
    async function setupWithProposal() {
      const fixture = await deployFixture();
      const { governance, target, governor1 } = fixture;

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Set value to 42",
        0 // Standard
      );

      return { ...fixture, proposalId: 0n, data };
    }

    it("Should allow governor to approve proposal", async function () {
      const { governance, governor1, proposalId } = await setupWithProposal();

      const tx = await governance.connect(governor1).approve(proposalId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(governance, "ProposalApproved")
        .withArgs(proposalId, governor1.address, 1, block.timestamp);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.approvals).to.equal(1);
      expect(proposal.state).to.equal(0); // Still Pending (needs 3 approvals)
    });

    it("Should transition to Approved after reaching threshold", async function () {
      const { governance, governor1, governor2, governor3, proposalId } = await setupWithProposal();

      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);

      const tx = await governance.connect(governor3).approve(proposalId);
      await tx.wait();

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.approvals).to.equal(3);
      expect(proposal.state).to.equal(1); // Approved
      expect(proposal.approvedAt).to.be.gt(0);
    });

    it("Should reject duplicate approval from same governor", async function () {
      const { governance, governor1, proposalId } = await setupWithProposal();

      await governance.connect(governor1).approve(proposalId);

      await expect(
        governance.connect(governor1).approve(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Already approved");
    });

    it("Should reject approval of non-pending proposal", async function () {
      const { governance, governor1, governor2, governor3, governor4, proposalId } = await setupWithProposal();

      // Get to Approved state
      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);
      await governance.connect(governor3).approve(proposalId);

      await expect(
        governance.connect(governor4).approve(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Not pending");
    });

    it("Should reject approval of expired proposal", async function () {
      const { governance, governor1, proposalId } = await setupWithProposal();

      // Fast forward past expiration
      await time.increase(PROPOSAL_LIFETIME + 1n);

      await expect(
        governance.connect(governor1).approve(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Expired");
    });

    it("Should reject approval when paused", async function () {
      const { governance, governor1, governor2, governor3, proposalId } = await setupWithProposal();

      // Pause via governance proposal
      const pauseData = governance.interface.encodeFunctionData("pause", []);
      await governance.connect(governor1).propose(governance.target, 0, pauseData, "Pause governance", 0);

      await governance.connect(governor1).approve(1); // Proposal ID 1 (pause)
      await governance.connect(governor2).approve(1);
      await governance.connect(governor3).approve(1);

      await time.increase(STANDARD_DELAY + 1n);
      await governance.connect(governor1).execute(1);

      await expect(
        governance.connect(governor1).approve(proposalId) // Original proposal (ID 0)
      ).to.be.reverted;
    });
  });

  describe("Proposal Execution", function () {
    async function setupWithApprovedProposal(proposalType = 0) {
      const fixture = await deployFixture();
      const { governance, target, governor1, governor2, governor3 } = fixture;

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Set value to 42",
        proposalType
      );

      const proposalId = 0n;

      // Get 3 approvals
      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);
      await governance.connect(governor3).approve(proposalId);

      return { ...fixture, proposalId, data };
    }

    it("Should execute standard proposal after timelock", async function () {
      const { governance, target, governor1, proposalId } = await setupWithApprovedProposal(0);

      // Fast forward past standard delay
      await time.increase(STANDARD_DELAY + 1n);

      const tx = await governance.connect(governor1).execute(proposalId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(governance, "ProposalExecuted")
        .withArgs(proposalId, governor1.address, true, block.timestamp);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.state).to.equal(2); // Executed

      // Verify target contract was called
      expect(await target.value()).to.equal(42);

      // Verify metrics
      const metrics = await governance.getMetrics();
      expect(metrics._totalExecuted).to.equal(1);
    });

    it("Should execute emergency proposal after emergency delay", async function () {
      const { governance, target, governor1, proposalId } = await setupWithApprovedProposal(1);

      // Fast forward past emergency delay (6 hours)
      await time.increase(EMERGENCY_DELAY + 1n);

      await governance.connect(governor1).execute(proposalId);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.state).to.equal(2); // Executed

      expect(await target.value()).to.equal(42);
    });

    it("Should reject execution before timelock", async function () {
      const { governance, governor1, proposalId } = await setupWithApprovedProposal(0);

      // Try to execute immediately
      await expect(
        governance.connect(governor1).execute(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Timelock not passed");
    });

    it("Should reject execution of non-approved proposal", async function () {
      const { governance, target, governor1 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Test",
        0
      );

      await time.increase(STANDARD_DELAY + 1n);

      await expect(
        governance.connect(governor1).execute(0)
      ).to.be.revertedWith("TataPayGovernance: Not approved");
    });

    it("Should reject execution of expired proposal", async function () {
      const { governance, governor1, proposalId } = await setupWithApprovedProposal(0);

      // Fast forward past expiration
      await time.increase(PROPOSAL_LIFETIME + 1n);

      await expect(
        governance.connect(governor1).execute(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Expired");
    });

    it("Should handle failed call execution", async function () {
      const { governance, target, governor1, governor2, governor3 } = await deployFixture();

      // Create proposal that will fail (invalid function)
      const data = "0x12345678"; // Invalid function selector

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Will fail",
        0
      );

      const proposalId = 0n;

      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);
      await governance.connect(governor3).approve(proposalId);

      await time.increase(STANDARD_DELAY + 1n);

      const tx = await governance.connect(governor1).execute(proposalId);

      await expect(tx)
        .to.emit(governance, "ProposalExecuted")
        .withArgs(proposalId, governor1.address, false, await time.latest());

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.state).to.equal(2); // Executed (even though call failed)
    });
  });

  describe("Proposal Cancellation", function () {
    async function setupWithProposal() {
      const fixture = await deployFixture();
      const { governance, target, governor1 } = fixture;

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Test",
        0
      );

      return { ...fixture, proposalId: 0n };
    }

    it("Should cancel pending proposal", async function () {
      const { governance, governor1, proposalId } = await setupWithProposal();

      const tx = await governance.connect(governor1).cancel(proposalId);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(governance, "ProposalCancelled")
        .withArgs(proposalId, governor1.address, block.timestamp);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.state).to.equal(3); // Cancelled

      const metrics = await governance.getMetrics();
      expect(metrics._totalCancelled).to.equal(1);
    });

    it("Should cancel approved proposal", async function () {
      const { governance, governor1, governor2, governor3, proposalId } = await setupWithProposal();

      // Approve first
      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);
      await governance.connect(governor3).approve(proposalId);

      // Cancel
      await governance.connect(governor1).cancel(proposalId);

      const proposal = await governance.getProposal(proposalId);
      expect(proposal.state).to.equal(3); // Cancelled
    });

    it("Should reject cancellation of executed proposal", async function () {
      const { governance, governor1, governor2, governor3, proposalId } = await setupWithProposal();

      await governance.connect(governor1).approve(proposalId);
      await governance.connect(governor2).approve(proposalId);
      await governance.connect(governor3).approve(proposalId);

      await time.increase(STANDARD_DELAY + 1n);
      await governance.connect(governor1).execute(proposalId);

      await expect(
        governance.connect(governor1).cancel(proposalId)
      ).to.be.revertedWith("TataPayGovernance: Cannot cancel");
    });
  });

  describe("Governor Management", function () {
    it("Should add new governor", async function () {
      const { governance, user1, governor1, governor2, governor3 } = await deployFixture();

      const DEFAULT_ADMIN_ROLE = await governance.DEFAULT_ADMIN_ROLE();

      // Contract is its own admin, need to call via proposal
      const data = governance.interface.encodeFunctionData("addGovernor", [user1.address]);

      await governance.connect(governor1).propose(
        governance.target,
        0,
        data,
        "Add new governor",
        0
      );

      // Approve and execute via governance
      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      await time.increase(STANDARD_DELAY + 1n);

      const tx = await governance.connect(governor1).execute(0);

      await expect(tx).to.emit(governance, "GovernorAdded");

      const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
      expect(await governance.hasRole(GOVERNOR_ROLE, user1.address)).to.be.true;
      expect(await governance.totalGovernors()).to.equal(6);
    });

    it("Should remove governor", async function () {
      const { governance, governor1, governor2, governor3, governor5 } = await deployFixture();

      const data = governance.interface.encodeFunctionData("removeGovernor", [governor5.address]);

      await governance.connect(governor1).propose(
        governance.target,
        0,
        data,
        "Remove governor5",
        0
      );

      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      await time.increase(STANDARD_DELAY + 1n);

      const tx = await governance.connect(governor1).execute(0);

      await expect(tx).to.emit(governance, "GovernorRemoved");

      const GOVERNOR_ROLE = await governance.GOVERNOR_ROLE();
      expect(await governance.hasRole(GOVERNOR_ROLE, governor5.address)).to.be.false;
      expect(await governance.totalGovernors()).to.equal(4);
    });

    it("Should reject removal when it would go below required threshold", async function () {
      const { governance, governor1, governor2, governor3, governor4, governor5 } = await deployFixture();

      // Try to remove 3 governors (would leave 2, but require 3)
      // Use only governor1 and governor2 for approvals since governor3, 4, 5 will be removed
      for (let i = 0; i < 3; i++) {
        const govToRemove = i === 0 ? governor3 : i === 1 ? governor4 : governor5;
        const data = governance.interface.encodeFunctionData("removeGovernor", [govToRemove.address]);

        await governance.connect(governor1).propose(
          governance.target,
          0,
          data,
          `Remove governor ${i}`,
          0
        );

        // Use governor3 for first iteration before it's removed
        if (i === 0) {
          await governance.connect(governor1).approve(i);
          await governance.connect(governor2).approve(i);
          await governance.connect(governor3).approve(i);
        } else {
          // After governor3 is removed, only use governor1, 2, and 5 (or 4 for second iteration)
          await governance.connect(governor1).approve(i);
          await governance.connect(governor2).approve(i);
          if (i === 1) {
            await governance.connect(governor4).approve(i);
          } else {
            await governance.connect(governor5).approve(i);
          }
        }

        await time.increase(STANDARD_DELAY + 1n);

        if (i < 2) {
          await governance.connect(governor1).execute(i);
        } else {
          // Third removal should fail (would go below required threshold)
          const tx = await governance.connect(governor1).execute(i);
          await expect(tx)
            .to.emit(governance, "ProposalExecuted")
            .withArgs(i, governor1.address, false, await time.latest());
        }
      }
    });
  });

  describe("Parameter Updates", function () {
    it("Should update governance parameters", async function () {
      const { governance, governor1, governor2, governor3 } = await deployFixture();

      const newRequired = 2n;
      const newStandard = 24n * 60n * 60n; // 24 hours
      const newEmergency = 3n * 60n * 60n; // 3 hours

      const data = governance.interface.encodeFunctionData("updateParameters", [
        newRequired,
        newStandard,
        newEmergency
      ]);

      await governance.connect(governor1).propose(
        governance.target,
        0,
        data,
        "Update parameters",
        0
      );

      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      await time.increase(STANDARD_DELAY + 1n);

      const tx = await governance.connect(governor1).execute(0);

      await expect(tx).to.emit(governance, "GovernanceParametersUpdated");

      expect(await governance.requiredApprovals()).to.equal(newRequired);
      expect(await governance.standardDelay()).to.equal(newStandard);
      expect(await governance.emergencyDelay()).to.equal(newEmergency);
    });

    it("Should reject invalid parameter updates", async function () {
      const { governance, governor1, governor2, governor3 } = await deployFixture();

      // Emergency >= Standard (invalid)
      const data = governance.interface.encodeFunctionData("updateParameters", [
        2,
        24 * 60 * 60,
        48 * 60 * 60 // Emergency >= Standard
      ]);

      await governance.connect(governor1).propose(
        governance.target,
        0,
        data,
        "Invalid params",
        0
      );

      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      await time.increase(STANDARD_DELAY + 1n);

      // Execute should fail
      const tx = await governance.connect(governor1).execute(0);
      await expect(tx)
        .to.emit(governance, "ProposalExecuted")
        .withArgs(0, governor1.address, false, await time.latest());
    });
  });

  describe("View Functions", function () {
    it("Should check if proposal can be executed", async function () {
      const { governance, target, governor1, governor2, governor3 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      await governance.connect(governor1).propose(
        target.target,
        0,
        data,
        "Test",
        0
      );

      // Pending - cannot execute
      let [canExec, reason] = await governance.canExecute(0);
      expect(canExec).to.be.false;
      expect(reason).to.equal("Not approved");

      // Approve
      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);

      // Approved but timelock not passed
      [canExec, reason] = await governance.canExecute(0);
      expect(canExec).to.be.false;
      expect(reason).to.equal("Timelock not passed");

      // After timelock
      await time.increase(STANDARD_DELAY + 1n);
      [canExec, reason] = await governance.canExecute(0);
      expect(canExec).to.be.true;
      expect(reason).to.equal("Can execute");
    });

    it("Should return metrics", async function () {
      const { governance, target, governor1, governor2, governor3 } = await deployFixture();

      const data = target.interface.encodeFunctionData("setValue", [42]);

      // Create and execute one proposal
      await governance.connect(governor1).propose(target.target, 0, data, "Test 1", 0);
      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);
      await time.increase(STANDARD_DELAY + 1n);
      await governance.connect(governor1).execute(0);

      // Create and cancel another
      await governance.connect(governor1).propose(target.target, 0, data, "Test 2", 0);
      await governance.connect(governor1).cancel(1);

      const [created, executed, cancelled, totalGovs, required] = await governance.getMetrics();
      expect(created).to.equal(2);
      expect(executed).to.equal(1);
      expect(cancelled).to.equal(1);
      expect(totalGovs).to.equal(5);
      expect(required).to.equal(3);
    });
  });

  describe("Emergency Functions", function () {
    it("Should pause and unpause", async function () {
      const { governance, governor1, governor2, governor3 } = await deployFixture();

      const DEFAULT_ADMIN_ROLE = await governance.DEFAULT_ADMIN_ROLE();

      // Grant admin role via governance
      const grantData = governance.interface.encodeFunctionData("grantRole", [DEFAULT_ADMIN_ROLE, governor1.address]);
      await governance.connect(governor1).propose(governance.target, 0, grantData, "Grant admin", 0);

      await governance.connect(governor1).approve(0);
      await governance.connect(governor2).approve(0);
      await governance.connect(governor3).approve(0);
      await time.increase(STANDARD_DELAY + 1n);
      await governance.connect(governor1).execute(0);

      // Now pause
      await governance.connect(governor1).pause();
      expect(await governance.paused()).to.be.true;

      // Unpause
      await governance.connect(governor1).unpause();
      expect(await governance.paused()).to.be.false;
    });
  });
});
