// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title TransactionRegistry
 * @notice Immutable audit trail for domestic tap-to-pay transactions
 * @dev Records transaction proofs on-chain without any value movement
 *
 * This contract serves as the on-chain audit log for domestic transactions
 * that are settled off-chain via traditional payment rails (Paystack, NIBSS).
 * It provides cryptographic proof of transaction occurrence while keeping
 * actual value settlement off-chain for efficiency and cost-effectiveness.
 *
 * Key Features:
 * - Event-based logging for gas efficiency
 * - Merkle proof support for dispute resolution
 * - Indexed events for efficient off-chain querying
 * - Role-based access control for recording and dispute management
 * - Transaction status tracking through lifecycle
 * - Proof generation for verification (hash, block number, timestamp)
 *
 * Security Considerations:
 * - Only authorized recorders can submit transactions
 * - Transaction IDs are unique and cannot be reused
 * - Status transitions follow strict state machine rules
 * - All state changes emit events for transparency
 */
contract TransactionRegistry is AccessControl, Pausable {
    // =============================================================
    //                           ROLES
    // =============================================================

    /// @notice Role for backend services that record transactions
    bytes32 public constant RECORDER_ROLE = keccak256("RECORDER_ROLE");

    /// @notice Role for dispute resolution services
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");

    // =============================================================
    //                           TYPES
    // =============================================================

    /// @notice Transaction status in lifecycle
    enum TxStatus {
        Pending,    // Transaction recorded but not yet confirmed
        Confirmed,  // Transaction confirmed by payment processor
        Disputed,   // Transaction under dispute
        Resolved    // Dispute resolved
    }

    /// @notice Core transaction data structure
    struct Transaction {
        bytes32 txId;           // Unique transaction identifier
        address merchant;       // Merchant wallet address
        address fintech;        // Fintech provider (Opay, Kuda, etc.)
        uint256 amount;         // Amount in local currency minor units (kobo/pesewas)
        string currency;        // Currency code (NGN, GHS, KES)
        string externalRef;     // External reference (Paystack/Flutterwave ID)
        TxStatus status;        // Current transaction status
        uint256 blockNumber;    // Block number when transaction was recorded
        uint256 createdAt;      // Block timestamp when recorded
        uint256 updatedAt;      // Block timestamp of last update
    }

    // =============================================================
    //                         STATE VARIABLES
    // =============================================================

    /// @notice Mapping of transaction ID to transaction data
    mapping(bytes32 => Transaction) public transactions;

    /// @notice Check if transaction ID exists
    mapping(bytes32 => bool) public exists;

    /// @notice List of transaction IDs for each merchant
    mapping(address => bytes32[]) public merchantTransactions;

    /// @notice List of transaction IDs for each fintech
    mapping(address => bytes32[]) public fintechTransactions;

    /// @notice Total number of transactions recorded
    uint256 public totalTransactions;

    /// @notice Total number of disputed transactions
    uint256 public totalDisputed;

    /// @notice Total number of resolved disputes
    uint256 public totalResolved;

    // =============================================================
    //                           EVENTS
    // =============================================================

    /// @notice Emitted when a new transaction is recorded
    /// @param txId Unique transaction identifier
    /// @param merchant Merchant wallet address
    /// @param fintech Fintech provider address
    /// @param amount Transaction amount in minor units
    /// @param currency Currency code
    /// @param externalRef External payment processor reference
    /// @param timestamp Block timestamp when recorded
    event TransactionRecorded(
        bytes32 indexed txId,
        address indexed merchant,
        address indexed fintech,
        uint256 amount,
        string currency,
        string externalRef,
        uint256 timestamp
    );

    /// @notice Emitted when transaction status is updated
    /// @param txId Transaction identifier
    /// @param oldStatus Previous status
    /// @param newStatus New status
    /// @param reason Reason for status change
    /// @param timestamp Block timestamp of update
    event StatusUpdated(
        bytes32 indexed txId,
        TxStatus indexed oldStatus,
        TxStatus indexed newStatus,
        string reason,
        uint256 timestamp
    );

    // =============================================================
    //                           ERRORS
    // =============================================================

    error TransactionExists(bytes32 txId);
    error TransactionNotFound(bytes32 txId);
    error InvalidMerchant(address merchant);
    error InvalidFintech(address fintech);
    error InvalidAmount(uint256 amount);
    error InvalidCurrency(string currency);
    error InvalidStatusTransition(TxStatus currentStatus, TxStatus newStatus);
    error InvalidTxId();

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initializes the TransactionRegistry contract
     * @param _admin Address to be granted admin role
     */
    constructor(address _admin) {
        require(_admin != address(0), "TransactionRegistry: invalid admin");
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(RECORDER_ROLE, _admin); // Admin can record initially
        _grantRole(DISPUTE_ROLE, _admin);  // Admin can handle disputes initially
    }

    // =============================================================
    //                      CORE FUNCTIONS
    // =============================================================

    /**
     * @notice Records a new transaction on-chain
     * @dev Only callable by addresses with RECORDER_ROLE
     * @param txId Unique transaction identifier
     * @param merchant Merchant wallet address
     * @param amount Transaction amount in minor units
     * @param currency Currency code (e.g., "NGN", "GHS")
     * @param externalRef External payment processor reference
     */
    function recordTransaction(
        bytes32 txId,
        address merchant,
        uint256 amount,
        string calldata currency,
        string calldata externalRef
    ) external onlyRole(RECORDER_ROLE) whenNotPaused {
        // Validate inputs
        if (txId == bytes32(0)) revert InvalidTxId();
        if (exists[txId]) revert TransactionExists(txId);
        if (merchant == address(0)) revert InvalidMerchant(merchant);
        if (msg.sender == address(0)) revert InvalidFintech(msg.sender);
        if (amount == 0) revert InvalidAmount(amount);
        if (bytes(currency).length == 0) revert InvalidCurrency(currency);

        // Create transaction record
        Transaction memory newTx = Transaction({
            txId: txId,
            merchant: merchant,
            fintech: msg.sender,
            amount: amount,
            currency: currency,
            externalRef: externalRef,
            status: TxStatus.Pending,
            blockNumber: block.number,
            createdAt: block.timestamp,
            updatedAt: block.timestamp
        });

        // Store transaction
        transactions[txId] = newTx;
        exists[txId] = true;

        // Update mappings
        merchantTransactions[merchant].push(txId);
        fintechTransactions[msg.sender].push(txId);

        // Update metrics
        totalTransactions++;

        // Emit event
        emit TransactionRecorded(
            txId,
            merchant,
            msg.sender,
            amount,
            currency,
            externalRef,
            block.timestamp
        );
    }

    /**
     * @notice Updates the status of an existing transaction
     * @dev Only callable by addresses with appropriate roles
     * @param txId Transaction identifier to update
     * @param newStatus New status to set
     * @param reason Reason for status change
     */
    function updateStatus(
        bytes32 txId,
        TxStatus newStatus,
        string calldata reason
    ) external whenNotPaused {
        if (!exists[txId]) revert TransactionNotFound(txId);

        Transaction storage txn = transactions[txId];
        TxStatus oldStatus = txn.status;

        // Validate status transition
        _validateStatusTransition(oldStatus, newStatus);

        // Check role permissions based on transition
        if (newStatus == TxStatus.Confirmed) {
            require(hasRole(RECORDER_ROLE, msg.sender), "TransactionRegistry: not recorder");
        } else if (newStatus == TxStatus.Disputed || newStatus == TxStatus.Resolved) {
            require(hasRole(DISPUTE_ROLE, msg.sender), "TransactionRegistry: not dispute handler");
        }

        // Update status
        txn.status = newStatus;
        txn.updatedAt = block.timestamp;

        // Update metrics
        if (newStatus == TxStatus.Disputed) {
            totalDisputed++;
        } else if (newStatus == TxStatus.Resolved) {
            totalResolved++;
        }

        // Emit event
        emit StatusUpdated(
            txId,
            oldStatus,
            newStatus,
            reason,
            block.timestamp
        );
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Retrieves full transaction data
     * @param txId Transaction identifier
     * @return Transaction data structure
     */
    function getTransaction(bytes32 txId) external view returns (Transaction memory) {
        if (!exists[txId]) revert TransactionNotFound(txId);
        return transactions[txId];
    }

    /**
     * @notice Generates cryptographic proof of transaction
     * @dev Returns proof data for dispute resolution
     * @param txId Transaction identifier
     * @return proofHash Keccak256 hash of transaction data
     * @return blockNumber Block number when transaction was recorded
     * @return timestamp Block timestamp when transaction was recorded
     */
    function getTransactionProof(bytes32 txId) external view returns (
        bytes32 proofHash,
        uint256 blockNumber,
        uint256 timestamp
    ) {
        if (!exists[txId]) revert TransactionNotFound(txId);

        Transaction memory txn = transactions[txId];

        // Generate proof hash from transaction data
        proofHash = keccak256(abi.encodePacked(
            txn.txId,
            txn.merchant,
            txn.fintech,
            txn.amount,
            txn.currency,
            txn.externalRef,
            txn.blockNumber,
            txn.createdAt
        ));

        // Return the stored block number from when the transaction was recorded
        blockNumber = txn.blockNumber;
        timestamp = txn.createdAt;
    }

    /**
     * @notice Retrieves paginated list of merchant transactions
     * @param merchant Merchant address
     * @param offset Starting index for pagination
     * @param limit Maximum number of results to return
     * @return Transaction IDs array
     */
    function getMerchantTransactions(
        address merchant,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        bytes32[] memory txIds = merchantTransactions[merchant];
        uint256 total = txIds.length;

        if (offset >= total) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = txIds[i];
        }

        return result;
    }

    /**
     * @notice Retrieves paginated list of fintech transactions
     * @param fintech Fintech address
     * @param offset Starting index for pagination
     * @param limit Maximum number of results to return
     * @return Transaction IDs array
     */
    function getFintechTransactions(
        address fintech,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        bytes32[] memory txIds = fintechTransactions[fintech];
        uint256 total = txIds.length;

        if (offset >= total) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = txIds[i];
        }

        return result;
    }

    /**
     * @notice Gets transaction count for a merchant
     * @param merchant Merchant address
     * @return Number of transactions
     */
    function getMerchantTransactionCount(address merchant) external view returns (uint256) {
        return merchantTransactions[merchant].length;
    }

    /**
     * @notice Gets transaction count for a fintech
     * @param fintech Fintech address
     * @return Number of transactions
     */
    function getFintechTransactionCount(address fintech) external view returns (uint256) {
        return fintechTransactions[fintech].length;
    }

    /**
     * @notice Retrieves current metrics
     * @return total Total transactions recorded
     * @return disputed Total disputed transactions
     * @return resolved Total resolved disputes
     */
    function getMetrics() external view returns (
        uint256 total,
        uint256 disputed,
        uint256 resolved
    ) {
        return (totalTransactions, totalDisputed, totalResolved);
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Pauses the contract
     * @dev Only callable by admin
     */
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     * @dev Only callable by admin
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================
    //                    INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Validates status transition is allowed
     * @param currentStatus Current transaction status
     * @param newStatus Proposed new status
     */
    function _validateStatusTransition(TxStatus currentStatus, TxStatus newStatus) internal pure {
        // Define valid transitions
        if (currentStatus == TxStatus.Pending) {
            // From Pending, can go to Confirmed or Disputed
            if (newStatus != TxStatus.Confirmed && newStatus != TxStatus.Disputed) {
                revert InvalidStatusTransition(currentStatus, newStatus);
            }
        } else if (currentStatus == TxStatus.Confirmed) {
            // From Confirmed, can only go to Disputed
            if (newStatus != TxStatus.Disputed) {
                revert InvalidStatusTransition(currentStatus, newStatus);
            }
        } else if (currentStatus == TxStatus.Disputed) {
            // From Disputed, can only go to Resolved
            if (newStatus != TxStatus.Resolved) {
                revert InvalidStatusTransition(currentStatus, newStatus);
            }
        } else if (currentStatus == TxStatus.Resolved) {
            // Resolved is final state
            revert InvalidStatusTransition(currentStatus, newStatus);
        }
    }
}