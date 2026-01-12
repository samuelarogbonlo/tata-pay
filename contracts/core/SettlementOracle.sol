// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CrossBorderSettlement.sol";

/**
 * @title SettlementOracle
 * @notice Oracle contract for confirming cross-border payment settlements
 * @dev Updated to work with CrossBorderSettlement instead of PaymentSettlement
 *
 * Features:
 * - Oracle registration and management
 * - Payment confirmation/failure via registered oracle accounts
 * - Oracle staking and slashing
 * - Multi-oracle support with threshold consensus
 *
 * Security:
 * - Role-based access control
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
        uint256 confirmations;
        uint256 failures;
        uint256 slashes;
        uint256 registeredAt;
        uint256 lastActivityAt;
    }

    struct PaymentVote {
        bytes32 paymentId;
        address oracle;
        bool isConfirmation;
        string data; // yaraReference for confirmations, reason for failures
        uint256 timestamp;
    }

    // ============ State Variables ============

    CrossBorderSettlement public immutable crossBorderSettlement;

    // Oracle management
    mapping(address => OracleInfo) public oracles;
    address[] public oracleList;
    uint256 public activeOracleCount;

    // Staking
    uint256 public minimumStake;
    uint256 public slashAmount;

    // Vote tracking
    mapping(bytes32 => PaymentVote[]) public paymentVoteHistory;
    mapping(bytes32 => bool) public processedPayments;

    // Multi-oracle consensus
    mapping(bytes32 => mapping(address => bool)) public hasVoted;
    mapping(bytes32 => uint256) public confirmationCount;
    mapping(bytes32 => uint256) public failureCount;
    uint256 public approvalThreshold; // Number of oracle confirmations needed

    // Metrics
    uint256 public totalConfirmationsProcessed;
    uint256 public totalFailuresProcessed;
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

    event PaymentConfirmationVoted(
        bytes32 indexed paymentId,
        address indexed oracle,
        string yaraReference,
        uint256 timestamp
    );

    event PaymentFailureVoted(
        bytes32 indexed paymentId,
        address indexed oracle,
        string reason,
        uint256 timestamp
    );

    event PaymentConfirmed(
        bytes32 indexed paymentId,
        string yaraReference,
        uint256 timestamp
    );

    event PaymentFailed(
        bytes32 indexed paymentId,
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
     * @param _crossBorderSettlement CrossBorderSettlement contract address
     * @param _admin Admin address
     * @param _minimumStake Minimum stake required for oracles
     */
    constructor(
        address _crossBorderSettlement,
        address _admin,
        uint256 _minimumStake
    ) {
        require(_crossBorderSettlement != address(0), "SettlementOracle: Invalid settlement address");
        require(_admin != address(0), "SettlementOracle: Invalid admin");

        crossBorderSettlement = CrossBorderSettlement(_crossBorderSettlement);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(ORACLE_MANAGER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);

        minimumStake = _minimumStake;
        slashAmount = _minimumStake / 10;
        approvalThreshold = 1; // Start with single oracle
    }

    // ============ Oracle Registration ============

    /**
     * @notice Register new oracle
     * @param oracle Oracle address
     */
    function registerOracle(
        address oracle
    ) external payable onlyRole(ORACLE_MANAGER_ROLE) {
        require(oracle != address(0), "SettlementOracle: Invalid address");
        require(!oracles[oracle].isRegistered, "SettlementOracle: Already registered");
        require(msg.value >= minimumStake, "SettlementOracle: Insufficient stake");

        oracles[oracle] = OracleInfo({
            isRegistered: true,
            isActive: true,
            stake: msg.value,
            confirmations: 0,
            failures: 0,
            slashes: 0,
            registeredAt: block.timestamp,
            lastActivityAt: block.timestamp
        });

        oracleList.push(oracle);
        activeOracleCount++;

        // Grant oracle role in CrossBorderSettlement
        crossBorderSettlement.grantOracleRole(oracle);

        emit OracleRegistered(oracle, msg.value, block.timestamp);
    }

    /**
     * @notice Deregister oracle and return stake
     * @param oracle Oracle address
     */
    function deregisterOracle(
        address oracle
    ) external onlyRole(ORACLE_MANAGER_ROLE) {
        OracleInfo storage info = oracles[oracle];
        require(info.isRegistered, "SettlementOracle: Not registered");

        uint256 returnAmount = info.stake;

        if (info.isActive) {
            activeOracleCount--;
        }

        info.isRegistered = false;
        info.isActive = false;
        info.stake = 0;

        // Revoke oracle role in CrossBorderSettlement
        crossBorderSettlement.revokeOracleRole(oracle);

        // Return stake
        if (returnAmount > 0) {
            (bool success, ) = oracle.call{value: returnAmount}("");
            require(success, "SettlementOracle: Stake return failed");
        }

        emit OracleDeregistered(oracle, block.timestamp);
    }

    // ============ Payment Voting ============

    /**
     * @notice Vote to confirm a cross-border payment
     * @param paymentId Payment ID to confirm
     * @param yaraReference Yara payout reference
     */
    function confirmPayment(
        bytes32 paymentId,
        string calldata yaraReference
    ) external nonReentrant whenNotPaused {
        OracleInfo storage info = oracles[msg.sender];
        require(info.isRegistered && info.isActive, "SettlementOracle: Not active oracle");
        require(!processedPayments[paymentId], "SettlementOracle: Payment already processed");
        require(!hasVoted[paymentId][msg.sender], "SettlementOracle: Already voted");

        // Record vote
        hasVoted[paymentId][msg.sender] = true;
        confirmationCount[paymentId]++;

        // Update oracle stats
        info.confirmations++;
        info.lastActivityAt = block.timestamp;

        // Store vote history
        paymentVoteHistory[paymentId].push(PaymentVote({
            paymentId: paymentId,
            oracle: msg.sender,
            isConfirmation: true,
            data: yaraReference,
            timestamp: block.timestamp
        }));

        emit PaymentConfirmationVoted(paymentId, msg.sender, yaraReference, block.timestamp);

        // Check if threshold reached
        if (confirmationCount[paymentId] >= approvalThreshold) {
            _executePaymentConfirmation(paymentId, yaraReference);
        }
    }

    /**
     * @notice Vote to fail a cross-border payment
     * @param paymentId Payment ID to fail
     * @param reason Failure reason
     */
    function failPayment(
        bytes32 paymentId,
        string calldata reason
    ) external nonReentrant whenNotPaused {
        OracleInfo storage info = oracles[msg.sender];
        require(info.isRegistered && info.isActive, "SettlementOracle: Not active oracle");
        require(!processedPayments[paymentId], "SettlementOracle: Payment already processed");
        require(!hasVoted[paymentId][msg.sender], "SettlementOracle: Already voted");

        // Record vote
        hasVoted[paymentId][msg.sender] = true;
        failureCount[paymentId]++;

        // Update oracle stats
        info.failures++;
        info.lastActivityAt = block.timestamp;

        // Store vote history
        paymentVoteHistory[paymentId].push(PaymentVote({
            paymentId: paymentId,
            oracle: msg.sender,
            isConfirmation: false,
            data: reason,
            timestamp: block.timestamp
        }));

        emit PaymentFailureVoted(paymentId, msg.sender, reason, block.timestamp);

        // Check if threshold reached (using same threshold as confirmations)
        if (failureCount[paymentId] >= approvalThreshold) {
            _executePaymentFailure(paymentId, reason);
        }
    }

    // ============ Oracle Management ============

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
            crossBorderSettlement.revokeOracleRole(oracle);
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

        // Re-grant oracle role
        crossBorderSettlement.grantOracleRole(oracle);

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

        // Revoke oracle role
        crossBorderSettlement.revokeOracleRole(oracle);

        emit OracleDeactivated(oracle, block.timestamp);
    }

    // ============ Admin Functions ============

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
     * @notice Get payment vote status
     * @param paymentId Payment ID
     * @return confirmations Confirmation count
     * @return failures Failure count
     * @return processed Whether payment processed
     */
    function getPaymentVoteStatus(
        bytes32 paymentId
    ) external view returns (
        uint256 confirmations,
        uint256 failures,
        bool processed
    ) {
        return (
            confirmationCount[paymentId],
            failureCount[paymentId],
            processedPayments[paymentId]
        );
    }

    /**
     * @notice Get vote history for a payment
     * @param paymentId Payment ID
     * @return votes Array of payment votes
     */
    function getPaymentVoteHistory(
        bytes32 paymentId
    ) external view returns (PaymentVote[] memory votes) {
        return paymentVoteHistory[paymentId];
    }

    /**
     * @notice Get metrics
     * @return _totalConfirmations Total confirmations
     * @return _totalFailures Total failures
     * @return _totalSlashed Total oracles slashed
     * @return _activeOracles Active oracle count
     */
    function getMetrics() external view returns (
        uint256 _totalConfirmations,
        uint256 _totalFailures,
        uint256 _totalSlashed,
        uint256 _activeOracles
    ) {
        return (
            totalConfirmationsProcessed,
            totalFailuresProcessed,
            totalOraclesSlashed,
            activeOracleCount
        );
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute payment confirmation on CrossBorderSettlement
     * @param paymentId Payment ID
     * @param yaraReference Yara reference
     */
    function _executePaymentConfirmation(bytes32 paymentId, string memory yaraReference) internal {
        require(!processedPayments[paymentId], "SettlementOracle: Already processed");

        processedPayments[paymentId] = true;
        totalConfirmationsProcessed++;

        // Call CrossBorderSettlement to confirm payment
        // The oracle calling this must have ORACLE_ROLE in CrossBorderSettlement
        crossBorderSettlement.confirmPayment(paymentId, yaraReference);

        emit PaymentConfirmed(paymentId, yaraReference, block.timestamp);
    }

    /**
     * @notice Execute payment failure on CrossBorderSettlement
     * @param paymentId Payment ID
     * @param reason Failure reason
     */
    function _executePaymentFailure(bytes32 paymentId, string memory reason) internal {
        require(!processedPayments[paymentId], "SettlementOracle: Already processed");

        processedPayments[paymentId] = true;
        totalFailuresProcessed++;

        // Call CrossBorderSettlement to fail payment
        crossBorderSettlement.failPayment(paymentId, reason);

        emit PaymentFailed(paymentId, reason, block.timestamp);
    }
}