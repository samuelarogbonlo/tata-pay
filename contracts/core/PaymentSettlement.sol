// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface ICollateralPool {
    function lockCollateral(address fintech, uint256 amount, bytes32 settlementId) external;
    function unlockCollateral(address fintech, uint256 amount, bytes32 settlementId) external;
    function transferFromLocked(address fintech, address recipient, uint256 amount, bytes32 settlementId) external;
}

/**
 * @title PaymentSettlement
 * @notice Manages batch settlement of payments from fintechs to merchants
 * @dev Implements pull payment pattern with state machine for settlement lifecycle
 *
 * Features:
 * - Batch creation with automatic collateral locking
 * - State machine: Pending → Processing → Completed/Failed
 * - Pull payment pattern for merchant claims
 * - Maximum 100 merchants per batch
 * - Duplicate batch ID prevention
 * - Batch cancellation with collateral unlock
 * - Settlement metrics tracking
 * - Timeout mechanism for failed settlements
 * - Integration with CollateralPool for collateral management
 *
 * Storage Layout (PVM-compatible):
 * - Uses explicit types for all state variables
 * - Mappings follow Solidity storage patterns
 * - Enums for state machine
 */
contract PaymentSettlement is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           ROLES
    // =============================================================

    /// @notice Role for oracle to approve settlements
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice Role for fraud prevention to cancel settlements
    bytes32 public constant FRAUD_ROLE = keccak256("FRAUD_ROLE");

    // =============================================================
    //                         CONSTANTS
    // =============================================================

    /// @notice Maximum merchants per batch
    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @notice Settlement timeout (48 hours)
    uint256 public constant SETTLEMENT_TIMEOUT = 48 hours;

    // =============================================================
    //                           ENUMS
    // =============================================================

    /**
     * @notice Settlement batch states
     * @param Pending Batch created, awaiting oracle approval
     * @param Processing Oracle approved, merchants can claim
     * @param Completed All merchants claimed, collateral unlocked
     * @param Failed Settlement failed or cancelled, collateral unlocked
     * @param Timeout Settlement timed out, treated as failed
     */
    enum BatchStatus {
        Pending,
        Processing,
        Completed,
        Failed,
        Timeout
    }

    // =============================================================
    //                          STRUCTS
    // =============================================================

    /**
     * @notice Merchant payment in a batch
     * @param merchant Merchant address
     * @param amount USDC amount (6 decimals)
     * @param claimed Whether merchant has claimed payment
     */
    struct Payment {
        address merchant;
        uint256 amount;
        bool claimed;
    }

    /**
     * @notice Settlement batch
     * @param batchId Unique batch identifier
     * @param fintech Fintech creating the batch
     * @param payments Array of merchant payments
     * @param totalAmount Total USDC in batch
     * @param claimedTotal Total USDC already paid out to merchants
     * @param status Current batch status
     * @param createdAt Block timestamp when created
     * @param processedAt Block timestamp when approved
     * @param completedAt Block timestamp when completed/failed
     * @param claimedCount Number of merchants who claimed
     */
    struct Batch {
        bytes32 batchId;
        address fintech;
        Payment[] payments;
        uint256 totalAmount;
        uint256 claimedTotal;
        BatchStatus status;
        uint256 createdAt;
        uint256 processedAt;
        uint256 completedAt;
        uint256 claimedCount;
    }

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice USDC token interface
    IERC20 public immutable USDC;

    /// @notice CollateralPool interface
    ICollateralPool public immutable collateralPool;

    /// @notice Mapping from batch ID to batch
    mapping(bytes32 => Batch) public batches;

    /// @notice Fintech nonces for batch ID generation
    mapping(address => uint256) public fintechNonces;

    /// @notice Total batches created
    uint256 public totalBatches;

    /// @notice Total batches completed
    uint256 public totalCompleted;

    /// @notice Total batches failed
    uint256 public totalFailed;

    /// @notice Total USDC settled
    uint256 public totalSettled;

    // =============================================================
    //                          EVENTS
    // =============================================================

    /**
     * @notice Emitted when a batch is created
     * @param batchId Unique batch identifier
     * @param fintech Fintech address
     * @param merchantCount Number of merchants
     * @param totalAmount Total USDC amount
     * @param timestamp Creation timestamp
     */
    event BatchCreated(
        bytes32 indexed batchId,
        address indexed fintech,
        uint256 merchantCount,
        uint256 totalAmount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when batch moves to Processing
     * @param batchId Batch identifier
     * @param oracle Oracle approving the batch
     * @param timestamp Processing timestamp
     */
    event BatchApproved(
        bytes32 indexed batchId,
        address indexed oracle,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a merchant claims payment
     * @param batchId Batch identifier
     * @param merchant Merchant address
     * @param amount USDC amount claimed
     * @param timestamp Claim timestamp
     */
    event PaymentClaimed(
        bytes32 indexed batchId,
        address indexed merchant,
        uint256 amount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when batch is completed
     * @param batchId Batch identifier
     * @param fintech Fintech address
     * @param totalAmount Total amount settled
     * @param timestamp Completion timestamp
     */
    event BatchCompleted(
        bytes32 indexed batchId,
        address indexed fintech,
        uint256 totalAmount,
        uint256 timestamp
    );

    /**
     * @notice Emitted when batch fails
     * @param batchId Batch identifier
     * @param fintech Fintech address
     * @param reason Failure reason
     * @param timestamp Failure timestamp
     */
    event BatchFailed(
        bytes32 indexed batchId,
        address indexed fintech,
        string reason,
        uint256 timestamp
    );

    /**
     * @notice Emitted when batch is cancelled
     * @param batchId Batch identifier
     * @param fintech Fintech address
     * @param canceller Address cancelling the batch
     * @param timestamp Cancellation timestamp
     */
    event BatchCancelled(
        bytes32 indexed batchId,
        address indexed fintech,
        address indexed canceller,
        uint256 timestamp
    );

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initialize PaymentSettlement contract
     * @param _usdcAddress USDC token address
     * @param _collateralPoolAddress CollateralPool contract address
     * @param _admin Admin address
     */
    constructor(
        address _usdcAddress,
        address _collateralPoolAddress,
        address _admin
    ) {
        require(_usdcAddress != address(0), "PaymentSettlement: Invalid USDC address");
        require(_collateralPoolAddress != address(0), "PaymentSettlement: Invalid CollateralPool address");
        require(_admin != address(0), "PaymentSettlement: Invalid admin address");

        USDC = IERC20(_usdcAddress);
        collateralPool = ICollateralPool(_collateralPoolAddress);

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    // =============================================================
    //                     BATCH CREATION
    // =============================================================

    /**
     * @notice Create a new settlement batch
     * @param merchants Array of merchant addresses
     * @param amounts Array of USDC amounts (6 decimals)
     * @return batchId Generated batch identifier
     * @dev Automatically locks collateral in CollateralPool
     */
    function createBatch(
        address[] calldata merchants,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused returns (bytes32 batchId) {
        // Validate inputs
        require(merchants.length > 0, "PaymentSettlement: Empty batch");
        require(merchants.length <= MAX_BATCH_SIZE, "PaymentSettlement: Batch too large");
        require(merchants.length == amounts.length, "PaymentSettlement: Length mismatch");

        // Calculate total amount
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < amounts.length; i++) {
            require(merchants[i] != address(0), "PaymentSettlement: Invalid merchant");
            require(amounts[i] > 0, "PaymentSettlement: Zero amount");
            totalAmount += amounts[i]; // Safe from overflow in Solidity 0.8+
        }

        // Generate unique batch ID
        batchId = _generateBatchId(msg.sender);
        require(batches[batchId].createdAt == 0, "PaymentSettlement: Duplicate batch");

        // Lock collateral
        collateralPool.lockCollateral(msg.sender, totalAmount, batchId);

        // Create batch
        Batch storage batch = batches[batchId];
        batch.batchId = batchId;
        batch.fintech = msg.sender;
        batch.totalAmount = totalAmount;
        batch.claimedTotal = 0;
        batch.status = BatchStatus.Pending;
        batch.createdAt = block.timestamp;
        batch.claimedCount = 0;

        // Add payments
        for (uint256 i = 0; i < merchants.length; i++) {
            batch.payments.push(Payment({
                merchant: merchants[i],
                amount: amounts[i],
                claimed: false
            }));
        }

        // Update metrics
        totalBatches++;

        emit BatchCreated(
            batchId,
            msg.sender,
            merchants.length,
            totalAmount,
            block.timestamp
        );

        return batchId;
    }

    // =============================================================
    //                     BATCH APPROVAL
    // =============================================================

    /**
     * @notice Approve batch for settlement (oracle only)
     * @param batchId Batch identifier
     * @dev Transitions batch from Pending to Processing
     */
    function approveBatch(bytes32 batchId) external onlyRole(ORACLE_ROLE) nonReentrant whenNotPaused {
        Batch storage batch = batches[batchId];

        require(batch.createdAt > 0, "PaymentSettlement: Batch not found");
        require(batch.status == BatchStatus.Pending, "PaymentSettlement: Invalid status");
        require(
            block.timestamp <= batch.createdAt + SETTLEMENT_TIMEOUT,
            "PaymentSettlement: Batch timeout"
        );

        // Transition to Processing
        batch.status = BatchStatus.Processing;
        batch.processedAt = block.timestamp;

        emit BatchApproved(batchId, msg.sender, block.timestamp);
    }

    // =============================================================
    //                     MERCHANT CLAIMS
    // =============================================================

    /**
     * @notice Claim payment from a batch (pull pattern)
     * @param batchId Batch identifier
     * @dev Merchant can only claim once per batch
     */
    function claimPayment(bytes32 batchId) external nonReentrant whenNotPaused {
        Batch storage batch = batches[batchId];

        require(batch.createdAt > 0, "PaymentSettlement: Batch not found");
        require(batch.status == BatchStatus.Processing, "PaymentSettlement: Not processing");

        // Find merchant's payment
        bool found = false;
        uint256 paymentIndex;
        uint256 claimAmount;

        for (uint256 i = 0; i < batch.payments.length; i++) {
            if (batch.payments[i].merchant == msg.sender) {
                require(!batch.payments[i].claimed, "PaymentSettlement: Already claimed");
                found = true;
                paymentIndex = i;
                claimAmount = batch.payments[i].amount;
                break;
            }
        }

        require(found, "PaymentSettlement: Not in batch");

        // Mark as claimed
        batch.payments[paymentIndex].claimed = true;
        batch.claimedCount++;
        batch.claimedTotal += claimAmount;

        // Transfer USDC from locked collateral to merchant
        collateralPool.transferFromLocked(batch.fintech, msg.sender, claimAmount, batchId);

        emit PaymentClaimed(batchId, msg.sender, claimAmount, block.timestamp);

        // Check if batch is complete
        if (batch.claimedCount == batch.payments.length) {
            _completeBatch(batchId);
        }
    }

    // =============================================================
    //                    BATCH COMPLETION
    // =============================================================

    /**
     * @notice Complete a batch after all merchants claimed
     * @param batchId Batch identifier
     * @dev Internal function, called after last claim
     */
    function _completeBatch(bytes32 batchId) internal {
        Batch storage batch = batches[batchId];

        // Transition to Completed
        batch.status = BatchStatus.Completed;
        batch.completedAt = block.timestamp;

        // Unlock remaining collateral (should be 0 if all claimed)
        uint256 remainingCollateral = batch.totalAmount - batch.claimedTotal;
        if (remainingCollateral > 0) {
            collateralPool.unlockCollateral(batch.fintech, remainingCollateral, batchId);
        }

        // Update metrics
        totalCompleted++;
        totalSettled += batch.claimedTotal;

        emit BatchCompleted(batchId, batch.fintech, batch.claimedTotal, block.timestamp);
    }

    // =============================================================
    //                    BATCH CANCELLATION
    // =============================================================

    /**
     * @notice Cancel a pending batch
     * @param batchId Batch identifier
     * @dev Can only cancel Pending batches, unlocks collateral
     */
    function cancelBatch(bytes32 batchId) external nonReentrant {
        Batch storage batch = batches[batchId];

        require(batch.createdAt > 0, "PaymentSettlement: Batch not found");
        require(batch.fintech == msg.sender, "PaymentSettlement: Not batch owner");
        require(batch.status == BatchStatus.Pending, "PaymentSettlement: Cannot cancel");

        // Transition to Failed
        batch.status = BatchStatus.Failed;
        batch.completedAt = block.timestamp;

        // Unlock collateral
        collateralPool.unlockCollateral(batch.fintech, batch.totalAmount, batchId);

        // Update metrics
        totalFailed++;

        emit BatchCancelled(batchId, batch.fintech, msg.sender, block.timestamp);
    }

    /**
     * @notice Fail a batch (oracle or fraud role)
     * @param batchId Batch identifier
     * @param reason Failure reason
     * @dev Unlocks remaining collateral, can be called on Pending or Processing batches
     */
    function failBatch(bytes32 batchId, string calldata reason) external nonReentrant whenNotPaused {
        require(
            hasRole(ORACLE_ROLE, msg.sender) || hasRole(FRAUD_ROLE, msg.sender),
            "PaymentSettlement: Unauthorized"
        );

        Batch storage batch = batches[batchId];

        require(batch.createdAt > 0, "PaymentSettlement: Batch not found");
        require(
            batch.status == BatchStatus.Pending || batch.status == BatchStatus.Processing,
            "PaymentSettlement: Cannot fail"
        );

        // Transition to Failed
        batch.status = BatchStatus.Failed;
        batch.completedAt = block.timestamp;

        // Unlock remaining collateral (subtract already claimed amounts)
        uint256 remainingCollateral = batch.totalAmount - batch.claimedTotal;
        if (remainingCollateral > 0) {
            collateralPool.unlockCollateral(batch.fintech, remainingCollateral, batchId);
        }

        // Update metrics
        totalFailed++;

        emit BatchFailed(batchId, batch.fintech, reason, block.timestamp);
    }

    /**
     * @notice Timeout a stale batch (Pending or Processing)
     * @param batchId Batch identifier
     * @dev Anyone can call after SETTLEMENT_TIMEOUT passes
     * @dev For Pending: timeout from createdAt
     * @dev For Processing: timeout from processedAt (if merchants never claim)
     */
    function timeoutBatch(bytes32 batchId) external nonReentrant whenNotPaused {
        Batch storage batch = batches[batchId];

        require(batch.createdAt > 0, "PaymentSettlement: Batch not found");
        require(
            batch.status == BatchStatus.Pending || batch.status == BatchStatus.Processing,
            "PaymentSettlement: Cannot timeout"
        );

        // Check timeout based on status
        if (batch.status == BatchStatus.Pending) {
            require(
                block.timestamp > batch.createdAt + SETTLEMENT_TIMEOUT,
                "PaymentSettlement: Not timed out"
            );
        } else {
            // Processing batch
            require(
                block.timestamp > batch.processedAt + SETTLEMENT_TIMEOUT,
                "PaymentSettlement: Not timed out"
            );
        }

        // Transition to Timeout
        batch.status = BatchStatus.Timeout;
        batch.completedAt = block.timestamp;

        // Unlock remaining collateral (only unclaimed amounts)
        uint256 remainingCollateral = batch.totalAmount - batch.claimedTotal;
        if (remainingCollateral > 0) {
            collateralPool.unlockCollateral(batch.fintech, remainingCollateral, batchId);
        }

        // Update metrics
        totalFailed++;

        emit BatchFailed(batchId, batch.fintech, "Timeout", block.timestamp);
    }

    // =============================================================
    //                    EMERGENCY FUNCTIONS
    // =============================================================

    /**
     * @notice Pause the contract
     * @dev Only callable by admin
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract
     * @dev Only callable by admin
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get batch details
     * @param batchId Batch identifier
     * @return fintech Fintech address
     * @return totalAmount Total USDC amount
     * @return status Batch status
     * @return merchantCount Number of merchants
     * @return claimedCount Number of claimed payments
     * @return createdAt Creation timestamp
     */
    function getBatch(bytes32 batchId)
        external
        view
        returns (
            address fintech,
            uint256 totalAmount,
            BatchStatus status,
            uint256 merchantCount,
            uint256 claimedCount,
            uint256 createdAt
        )
    {
        Batch storage batch = batches[batchId];
        return (
            batch.fintech,
            batch.totalAmount,
            batch.status,
            batch.payments.length,
            batch.claimedCount,
            batch.createdAt
        );
    }

    /**
     * @notice Get payment details for a merchant in a batch
     * @param batchId Batch identifier
     * @param merchantIndex Index in payments array
     * @return merchant Merchant address
     * @return amount USDC amount
     * @return claimed Whether payment was claimed
     */
    function getPayment(bytes32 batchId, uint256 merchantIndex)
        external
        view
        returns (
            address merchant,
            uint256 amount,
            bool claimed
        )
    {
        require(merchantIndex < batches[batchId].payments.length, "PaymentSettlement: Invalid index");
        Payment storage payment = batches[batchId].payments[merchantIndex];
        return (payment.merchant, payment.amount, payment.claimed);
    }

    /**
     * @notice Check if merchant can claim from batch
     * @param batchId Batch identifier
     * @param merchant Merchant address
     * @return eligible Whether merchant can claim
     * @return amount Amount available to claim (0 if cannot claim)
     */
    function canClaim(bytes32 batchId, address merchant)
        external
        view
        returns (bool eligible, uint256 amount)
    {
        Batch storage batch = batches[batchId];

        if (batch.status != BatchStatus.Processing) {
            return (false, 0);
        }

        for (uint256 i = 0; i < batch.payments.length; i++) {
            if (batch.payments[i].merchant == merchant && !batch.payments[i].claimed) {
                return (true, batch.payments[i].amount);
            }
        }

        return (false, 0);
    }

    /**
     * @notice Get settlement metrics
     * @return _totalBatches Total batches created
     * @return _totalCompleted Total completed batches
     * @return _totalFailed Total failed batches
     * @return _totalSettled Total USDC settled
     */
    function getMetrics()
        external
        view
        returns (
            uint256 _totalBatches,
            uint256 _totalCompleted,
            uint256 _totalFailed,
            uint256 _totalSettled
        )
    {
        return (totalBatches, totalCompleted, totalFailed, totalSettled);
    }

    // =============================================================
    //                    INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Generate unique batch ID
     * @param fintech Fintech address
     * @return batchId Unique identifier
     * @dev Uses fintech address, nonce, and block data
     */
    function _generateBatchId(address fintech) internal returns (bytes32 batchId) {
        uint256 nonce = fintechNonces[fintech]++;
        return keccak256(abi.encodePacked(fintech, nonce, block.timestamp, block.prevrandao));
    }
}
