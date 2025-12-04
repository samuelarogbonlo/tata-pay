// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title TataPayGovernance
 * @notice Multi-sig governance with timelock for Tata-Pay system
 *
 * Features:
 * - Multi-signature approval for critical operations
 * - Timelock delay for security
 * - Proposal creation and execution
 * - Role management across system contracts
 * - Emergency actions with reduced delay
 *
 * Security:
 * - M-of-N signature requirement
 * - Time-locked execution
 * - Proposal expiration
 * - Role-based access control
 */
contract TataPayGovernance is AccessControl, Pausable, ReentrancyGuard {
    // ============ Roles ============

    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    // ============ Enums ============

    enum ProposalState {
        Pending,    // Created, waiting for approvals
        Approved,   // Enough approvals, waiting for timelock
        Executed,   // Successfully executed
        Cancelled,  // Cancelled before execution
        Expired     // Passed expiration time
    }

    enum ProposalType {
        Standard,   // Standard 48-hour timelock
        Emergency   // Emergency 6-hour timelock
    }

    // ============ Structs ============

    struct Proposal {
        uint256 id;
        address proposer;
        address target;           // Contract to call
        uint256 value;            // ETH value to send
        bytes data;               // Function call data
        string description;
        ProposalType proposalType;
        ProposalState state;
        uint256 approvals;
        uint256 createdAt;
        uint256 approvedAt;
        uint256 executedAt;
        uint256 expiresAt;
    }

    // ============ State Variables ============

    // Governance parameters
    uint256 public requiredApprovals;       // M in M-of-N
    uint256 public totalGovernors;          // N in M-of-N
    uint256 public standardDelay;           // 48 hours
    uint256 public emergencyDelay;          // 6 hours
    uint256 public proposalLifetime;        // 7 days

    // Proposal tracking
    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasApproved;
    uint256 public proposalCount;

    // Metrics
    uint256 public totalProposalsCreated;
    uint256 public totalProposalsExecuted;
    uint256 public totalProposalsCancelled;

    // ============ Events ============

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address target,
        string description,
        ProposalType proposalType,
        uint256 timestamp
    );

    event ProposalApproved(
        uint256 indexed proposalId,
        address indexed approver,
        uint256 approvals,
        uint256 timestamp
    );

    event ProposalExecuted(
        uint256 indexed proposalId,
        address indexed executor,
        bool success,
        uint256 timestamp
    );

    event ProposalCancelled(
        uint256 indexed proposalId,
        address indexed canceller,
        uint256 timestamp
    );

    event GovernanceParametersUpdated(
        uint256 requiredApprovals,
        uint256 standardDelay,
        uint256 emergencyDelay,
        uint256 timestamp
    );

    event GovernorAdded(
        address indexed governor,
        uint256 timestamp
    );

    event GovernorRemoved(
        address indexed governor,
        uint256 timestamp
    );

    // ============ Constructor ============

    /**
     * @notice Initialize TataPayGovernance
     * @param _governors Initial governor addresses
     * @param _requiredApprovals Required approvals (M)
     */
    constructor(
        address[] memory _governors,
        uint256 _requiredApprovals
    ) {
        require(_governors.length > 0, "TataPayGovernance: No governors");
        require(_requiredApprovals > 0, "TataPayGovernance: Invalid required approvals");
        require(_requiredApprovals <= _governors.length, "TataPayGovernance: Required > total");

        _grantRole(DEFAULT_ADMIN_ROLE, address(this)); // Contract is its own admin

        // Grant governor roles
        for (uint256 i = 0; i < _governors.length; i++) {
            require(_governors[i] != address(0), "TataPayGovernance: Invalid governor");
            _grantRole(GOVERNOR_ROLE, _governors[i]);
            _grantRole(PROPOSER_ROLE, _governors[i]);
            _grantRole(EXECUTOR_ROLE, _governors[i]);
        }

        requiredApprovals = _requiredApprovals;
        totalGovernors = _governors.length;

        // Set default delays
        standardDelay = 48 hours;
        emergencyDelay = 6 hours;
        proposalLifetime = 7 days;
    }

    // ============ External Functions ============

    /**
     * @notice Create new proposal
     * @param target Target contract address
     * @param value ETH value to send
     * @param data Call data
     * @param description Proposal description
     * @param proposalType Standard or Emergency
     * @return proposalId New proposal ID
     */
    function propose(
        address target,
        uint256 value,
        bytes calldata data,
        string calldata description,
        ProposalType proposalType
    ) external onlyRole(PROPOSER_ROLE) whenNotPaused returns (uint256 proposalId) {
        require(target != address(0), "TataPayGovernance: Invalid target");
        require(bytes(description).length > 0, "TataPayGovernance: Empty description");

        proposalId = proposalCount++;

        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            target: target,
            value: value,
            data: data,
            description: description,
            proposalType: proposalType,
            state: ProposalState.Pending,
            approvals: 0,
            createdAt: block.timestamp,
            approvedAt: 0,
            executedAt: 0,
            expiresAt: block.timestamp + proposalLifetime
        });

        totalProposalsCreated++;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            target,
            description,
            proposalType,
            block.timestamp
        );

        return proposalId;
    }

    /**
     * @notice Approve proposal
     * @param proposalId Proposal ID to approve
     */
    function approve(
        uint256 proposalId
    ) external onlyRole(GOVERNOR_ROLE) whenNotPaused {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.state == ProposalState.Pending, "TataPayGovernance: Not pending");
        require(block.timestamp < proposal.expiresAt, "TataPayGovernance: Expired");
        require(!hasApproved[proposalId][msg.sender], "TataPayGovernance: Already approved");

        hasApproved[proposalId][msg.sender] = true;
        proposal.approvals++;

        emit ProposalApproved(
            proposalId,
            msg.sender,
            proposal.approvals,
            block.timestamp
        );

        // If threshold reached, move to Approved state
        if (proposal.approvals >= requiredApprovals) {
            proposal.state = ProposalState.Approved;
            proposal.approvedAt = block.timestamp;
        }
    }

    /**
     * @notice Execute approved proposal after timelock
     * @param proposalId Proposal ID to execute
     */
    function execute(
        uint256 proposalId
    ) external nonReentrant onlyRole(EXECUTOR_ROLE) returns (bool success) {
        Proposal storage proposal = proposals[proposalId];

        require(proposal.state == ProposalState.Approved, "TataPayGovernance: Not approved");
        require(block.timestamp < proposal.expiresAt, "TataPayGovernance: Expired");

        // Check timelock
        uint256 delay = proposal.proposalType == ProposalType.Emergency
            ? emergencyDelay
            : standardDelay;

        require(
            block.timestamp >= proposal.approvedAt + delay,
            "TataPayGovernance: Timelock not passed"
        );

        // Execute proposal
        proposal.state = ProposalState.Executed;
        proposal.executedAt = block.timestamp;

        (success, ) = proposal.target.call{value: proposal.value}(proposal.data);

        totalProposalsExecuted++;

        emit ProposalExecuted(proposalId, msg.sender, success, block.timestamp);

        return success;
    }

    /**
     * @notice Cancel pending or approved proposal
     * @param proposalId Proposal ID to cancel
     */
    function cancel(
        uint256 proposalId
    ) external onlyRole(GOVERNOR_ROLE) {
        Proposal storage proposal = proposals[proposalId];

        require(
            proposal.state == ProposalState.Pending ||
            proposal.state == ProposalState.Approved,
            "TataPayGovernance: Cannot cancel"
        );

        proposal.state = ProposalState.Cancelled;
        totalProposalsCancelled++;

        emit ProposalCancelled(proposalId, msg.sender, block.timestamp);
    }

    /**
     * @notice Add new governor
     * @param governor New governor address
     */
    function addGovernor(
        address governor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(governor != address(0), "TataPayGovernance: Invalid governor");
        require(!hasRole(GOVERNOR_ROLE, governor), "TataPayGovernance: Already governor");

        _grantRole(GOVERNOR_ROLE, governor);
        _grantRole(PROPOSER_ROLE, governor);
        _grantRole(EXECUTOR_ROLE, governor);

        totalGovernors++;

        emit GovernorAdded(governor, block.timestamp);
    }

    /**
     * @notice Remove governor
     * @param governor Governor address to remove
     */
    function removeGovernor(
        address governor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(hasRole(GOVERNOR_ROLE, governor), "TataPayGovernance: Not governor");
        require(totalGovernors > requiredApprovals, "TataPayGovernance: Cannot reduce below required");

        _revokeRole(GOVERNOR_ROLE, governor);
        _revokeRole(PROPOSER_ROLE, governor);
        _revokeRole(EXECUTOR_ROLE, governor);

        totalGovernors--;

        emit GovernorRemoved(governor, block.timestamp);
    }

    /**
     * @notice Update governance parameters
     * @param _requiredApprovals New required approvals
     * @param _standardDelay New standard delay
     * @param _emergencyDelay New emergency delay
     */
    function updateParameters(
        uint256 _requiredApprovals,
        uint256 _standardDelay,
        uint256 _emergencyDelay
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_requiredApprovals > 0, "TataPayGovernance: Invalid required");
        require(_requiredApprovals <= totalGovernors, "TataPayGovernance: Required > total");
        require(_emergencyDelay < _standardDelay, "TataPayGovernance: Emergency >= standard");

        requiredApprovals = _requiredApprovals;
        standardDelay = _standardDelay;
        emergencyDelay = _emergencyDelay;

        emit GovernanceParametersUpdated(
            _requiredApprovals,
            _standardDelay,
            _emergencyDelay,
            block.timestamp
        );
    }

    /**
     * @notice Pause proposal creation
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause proposal creation
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get proposal details
     * @param proposalId Proposal ID
     * @return proposal Proposal struct
     */
    function getProposal(
        uint256 proposalId
    ) external view returns (Proposal memory proposal) {
        return proposals[proposalId];
    }

    /**
     * @notice Check if proposal can be executed
     * @param proposalId Proposal ID
     * @return executable True if executable
     * @return reason Reason if not executable
     */
    function canExecute(
        uint256 proposalId
    ) external view returns (bool executable, string memory reason) {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.state != ProposalState.Approved) {
            return (false, "Not approved");
        }

        if (block.timestamp >= proposal.expiresAt) {
            return (false, "Expired");
        }

        uint256 delay = proposal.proposalType == ProposalType.Emergency
            ? emergencyDelay
            : standardDelay;

        if (block.timestamp < proposal.approvedAt + delay) {
            return (false, "Timelock not passed");
        }

        return (true, "Can execute");
    }

    /**
     * @notice Get metrics
     * @return _totalCreated Total proposals created
     * @return _totalExecuted Total proposals executed
     * @return _totalCancelled Total proposals cancelled
     * @return _totalGovernors Total governors
     * @return _requiredApprovals Required approvals
     */
    function getMetrics() external view returns (
        uint256 _totalCreated,
        uint256 _totalExecuted,
        uint256 _totalCancelled,
        uint256 _totalGovernors,
        uint256 _requiredApprovals
    ) {
        return (
            totalProposalsCreated,
            totalProposalsExecuted,
            totalProposalsCancelled,
            totalGovernors,
            requiredApprovals
        );
    }

    // ============ Receive Function ============

    receive() external payable {}
}
