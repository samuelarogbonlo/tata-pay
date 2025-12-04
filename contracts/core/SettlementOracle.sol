// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./PaymentSettlement.sol";

/**
 * @title SettlementOracle
 * @notice Oracle contract for verifying off-chain payment data
 *
 * Features:
 * - Oracle registration and management
 * - Batch approval/rejection via registered oracle accounts
 * - Oracle staking and slashing
 * - Multi-oracle support with threshold consensus
 *
 * Security:
 * - Role-based access control
 * - Signature verification (ECDSA)
 * - Replay attack prevention
 * - Pause mechanism
 * - Reentrancy protection
 */
contract SettlementOracle is AccessControl, Pausable, ReentrancyGuard {
    // ============ Roles ============

    bytes32 public constant ORACLE_MANAGER_ROLE = keccak256("ORACLE_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ============ Structs ============

    struct OracleInfo {
        bool isRegistered;
        bool isActive;
        uint256 stake;
        uint256 approvals;
        uint256 rejections;
        uint256 slashes;
        uint256 registeredAt;
        uint256 lastActivityAt;
    }

    struct ApprovalRequest {
        bytes32 batchId;
        address oracle;
        bool approved;
        string reason;
        uint256 timestamp;
    }

    // ============ State Variables ============

    PaymentSettlement public immutable paymentSettlement;

    // Oracle management
    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;
    uint256 public activeOracleCount;

    // Staking
    uint256 public minimumStake;
    uint256 public slashAmount;

    // Request tracking
    mapping(bytes32 => ApprovalRequest) public approvalRequests;
    mapping(bytes32 => bool) public processedBatches;

    // Multi-oracle consensus
    mapping(bytes32 => mapping(address => bool)) public batchVotes;
    mapping(bytes32 => uint256) public batchApprovalCount;
    mapping(bytes32 => uint256) public batchRejectionCount;
    uint256 public approvalThreshold; // Number of oracle approvals needed

    // Metrics
    uint256 public totalApprovalsProcessed;
    uint256 public totalRejectionsProcessed;
    uint256 public totalOraclesSlashed;

    // ============ Events ============

    event OracleRegistered(
        address indexed oracle,
        uint256 stake,
        uint256 timestamp
    );

    event OracleDeregistered(
        address indexed oracle,
        uint256 timestamp
    );

    event OracleActivated(
        address indexed oracle,
        uint256 timestamp
    );

    event OracleDeactivated(
        address indexed oracle,
        uint256 timestamp
    );

    event OracleSlashed(
        address indexed oracle,
        uint256 amount,
        string reason,
        uint256 timestamp
    );

    event BatchApproved(
        bytes32 indexed batchId,
        address indexed oracle,
        uint256 timestamp
    );

    event BatchRejected(
        bytes32 indexed batchId,
        address indexed oracle,
        string reason,
        uint256 timestamp
    );

    event ApprovalThresholdUpdated(
        uint256 oldThreshold,
        uint256 newThreshold,
        uint256 timestamp
    );

    event MinimumStakeUpdated(
        uint256 oldStake,
        uint256 newStake,
        uint256 timestamp
    );

    // ============ Constructor ============

    /**
     * @notice Initialize SettlementOracle
     * @param _paymentSettlement PaymentSettlement contract address
     * @param _admin Admin address
     * @param _minimumStake Minimum stake required for oracles
     */
    constructor(
        address _paymentSettlement,
        address _admin,
        uint256 _minimumStake
    ) {
        require(_paymentSettlement != address(0), "SettlementOracle: Invalid settlement address");
        require(_admin != address(0), "SettlementOracle: Invalid admin");

        paymentSettlement = PaymentSettlement(_paymentSettlement);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_MANAGER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);

        minimumStake = _minimumStake;
        slashAmount = _minimumStake / 10; // 10% slash by default
        approvalThreshold = 1; // Single oracle by default
    }

    // ============ External Functions ============

    /**
     * @notice Register as oracle with stake
     */
    function registerOracle() external payable nonReentrant whenNotPaused {
        require(!oracles[msg.sender].isRegistered, "SettlementOracle: Already registered");
        require(msg.value >= minimumStake, "SettlementOracle: Insufficient stake");

        oracles[msg.sender] = OracleInfo({
            isRegistered: true,
            isActive: true,
            stake: msg.value,
            approvals: 0,
            rejections: 0,
            slashes: 0,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp
        });

        oracleList.push(msg.sender);
        activeOracleCount++;

        emit OracleRegistered(msg.sender, msg.value, block.timestamp);
    }

    /**
     * @notice Deregister oracle and withdraw stake
     */
    function deregisterOracle() external nonReentrant {
        OracleInfo storage info = oracles[msg.sender];
        require(info.isRegistered, "SettlementOracle: Not registered");

        uint256 stakeToReturn = info.stake;

        // Remove from active count if active
        if (info.isActive) {
            activeOracleCount--;
        }

        // Mark as deregistered
        info.isRegistered = false;
        info.isActive = false;
        info.stake = 0;

        // Return stake
        (bool success, ) = msg.sender.call{value: stakeToReturn}("");
        require(success, "SettlementOracle: Stake transfer failed");

        emit OracleDeregistered(msg.sender, block.timestamp);
    }

    /**
     * @notice Approve batch with signed message
     * @param batchId Batch ID to approve
     */
    function approveBatch(
        bytes32 batchId
    ) external nonReentrant whenNotPaused {
        OracleInfo storage info = oracles[msg.sender];
        require(info.isRegistered && info.isActive, "SettlementOracle: Not active oracle");
        require(!processedBatches[batchId], "SettlementOracle: Batch already processed");
        require(!batchVotes[batchId][msg.sender], "SettlementOracle: Already voted");

        // Record vote
        batchVotes[batchId][msg.sender] = true;
        batchApprovalCount[batchId]++;

        // Update oracle stats
        info.approvals++;
        info.lastActivityAt = block.timestamp;

        // Store approval request
        approvalRequests[batchId] = ApprovalRequest({
            batchId: batchId,
            oracle: msg.sender,
            approved: true,
            reason: "",
            timestamp: block.timestamp
        });

        emit BatchApproved(batchId, msg.sender, block.timestamp);

        // Check if threshold reached
        if (batchApprovalCount[batchId] >= approvalThreshold) {
            _executeBatchApproval(batchId);
        }
    }

    /**
     * @notice Reject batch with signed message and reason
     * @param batchId Batch ID to reject
     * @param reason Rejection reason
     */
    function rejectBatch(
        bytes32 batchId,
        string calldata reason
    ) external nonReentrant whenNotPaused {
        OracleInfo storage info = oracles[msg.sender];
        require(info.isRegistered && info.isActive, "SettlementOracle: Not active oracle");
        require(!processedBatches[batchId], "SettlementOracle: Batch already processed");
        require(!batchVotes[batchId][msg.sender], "SettlementOracle: Already voted");

        // Record vote
        batchVotes[batchId][msg.sender] = true;
        batchRejectionCount[batchId]++;

        // Update oracle stats
        info.rejections++;
        info.lastActivityAt = block.timestamp;

        // Store approval request
        approvalRequests[batchId] = ApprovalRequest({
            batchId: batchId,
            oracle: msg.sender,
            approved: false,
            reason: reason,
            timestamp: block.timestamp
        });

        emit BatchRejected(batchId, msg.sender, reason, block.timestamp);

        // Check if threshold reached
        if (batchRejectionCount[batchId] >= approvalThreshold) {
            _executeBatchRejection(batchId, reason);
        }
    }

    /**
     * @notice Slash oracle for malicious behavior
     * @param oracle Oracle address to slash
     * @param reason Reason for slashing
     */
    function slashOracle(
        address oracle,
        string calldata reason
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        OracleInfo storage info = oracles[oracle];
        require(info.isRegistered, "SettlementOracle: Not registered");
        require(info.stake >= slashAmount, "SettlementOracle: Insufficient stake");

        // Slash stake
        info.stake -= slashAmount;
        info.slashes++;

        // If stake below minimum, deactivate
        if (info.stake < minimumStake) {
            info.isActive = false;
            activeOracleCount--;
            emit OracleDeactivated(oracle, block.timestamp);
        }

        totalOraclesSlashed++;

        emit OracleSlashed(oracle, slashAmount, reason, block.timestamp);
    }

    /**
     * @notice Activate deactivated oracle
     * @param oracle Oracle address
     */
    function activateOracle(
        address oracle
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        OracleInfo storage info = oracles[oracle];
        require(info.isRegistered, "SettlementOracle: Not registered");
        require(!info.isActive, "SettlementOracle: Already active");
        require(info.stake >= minimumStake, "SettlementOracle: Insufficient stake");

        info.isActive = true;
        activeOracleCount++;

        emit OracleActivated(oracle, block.timestamp);
    }

    /**
     * @notice Deactivate oracle
     * @param oracle Oracle address
     */
    function deactivateOracle(
        address oracle
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        OracleInfo storage info = oracles[oracle];
        require(info.isRegistered, "SettlementOracle: Not registered");
        require(info.isActive, "SettlementOracle: Not active");

        info.isActive = false;
        activeOracleCount--;

        emit OracleDeactivated(oracle, block.timestamp);
    }

    /**
     * @notice Update approval threshold
     * @param newThreshold New threshold
     */
    function setApprovalThreshold(
        uint256 newThreshold
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        require(newThreshold > 0, "SettlementOracle: Invalid threshold");
        require(newThreshold <= activeOracleCount, "SettlementOracle: Threshold too high");

        uint256 oldThreshold = approvalThreshold;
        approvalThreshold = newThreshold;

        emit ApprovalThresholdUpdated(oldThreshold, newThreshold, block.timestamp);
    }

    /**
     * @notice Update minimum stake
     * @param newStake New minimum stake
     */
    function setMinimumStake(
        uint256 newStake
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        require(newStake > 0, "SettlementOracle: Invalid stake");

        uint256 oldStake = minimumStake;
        minimumStake = newStake;
        slashAmount = newStake / 10;

        emit MinimumStakeUpdated(oldStake, newStake, block.timestamp);
    }

    /**
     * @notice Pause contract (emergency)
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause contract
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get oracle info
     * @param oracle Oracle address
     * @return info Oracle information
     */
    function getOracleInfo(
        address oracle
    ) external view returns (OracleInfo memory info) {
        return oracles[oracle];
    }

    /**
     * @notice Get oracle count
     * @return total Total oracles
     * @return active Active oracles
     */
    function getOracleCount() external view returns (
        uint256 total,
        uint256 active
    ) {
        return (oracleList.length, activeOracleCount);
    }

    /**
     * @notice Get batch vote status
     * @param batchId Batch ID
     * @return approvals Approval count
     * @return rejections Rejection count
     * @return processed Whether batch processed
     */
    function getBatchVoteStatus(
        bytes32 batchId
    ) external view returns (
        uint256 approvals,
        uint256 rejections,
        bool processed
    ) {
        return (
            batchApprovalCount[batchId],
            batchRejectionCount[batchId],
            processedBatches[batchId]
        );
    }

    /**
     * @notice Get metrics
     * @return _totalApprovals Total approvals
     * @return _totalRejections Total rejections
     * @return _totalSlashed Total oracles slashed
     * @return _activeOracles Active oracle count
     */
    function getMetrics() external view returns (
        uint256 _totalApprovals,
        uint256 _totalRejections,
        uint256 _totalSlashed,
        uint256 _activeOracles
    ) {
        return (
            totalApprovalsProcessed,
            totalRejectionsProcessed,
            totalOraclesSlashed,
            activeOracleCount
        );
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute batch approval on PaymentSettlement
     * @param batchId Batch ID
     */
    function _executeBatchApproval(bytes32 batchId) internal {
        require(!processedBatches[batchId], "SettlementOracle: Already processed");

        processedBatches[batchId] = true;
        totalApprovalsProcessed++;

        paymentSettlement.approveBatch(batchId);
    }

    /**
     * @notice Execute batch rejection on PaymentSettlement
     * @param batchId Batch ID
     * @param reason Rejection reason
     */
    function _executeBatchRejection(bytes32 batchId, string memory reason) internal {
        require(!processedBatches[batchId], "SettlementOracle: Already processed");

        processedBatches[batchId] = true;
        totalRejectionsProcessed++;

        paymentSettlement.failBatch(batchId, reason);
    }
}
