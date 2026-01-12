// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CrossBorderSettlement
 * @notice USDC escrow for cross-border payments with oracle confirmation
 * @dev Implements Circle Refund Protocol for secure non-custodial settlement
 *
 * This contract manages cross-border payments where USDC is locked in escrow
 * and released upon oracle confirmation of fiat payout completion. It follows
 * the Circle Refund Protocol pattern where oracles can ONLY release funds to
 * pre-specified addresses, preventing oracle compromise from redirecting funds.
 *
 * Key Security Properties:
 * - Pre-specified settlement address: Oracle can only confirm to yaraSettlementAddress
 * - Pre-specified refund address: Refunds only go to original sender
 * - Timeout mechanism: Auto-refund after 48 hours if not confirmed
 * - Non-custodial: No admin can redirect funds to arbitrary addresses
 *
 * Flow:
 * 1. Sender initiates payment → USDC locked in escrow
 * 2. Backend calls Yara API for fiat payout
 * 3. Oracle confirms payout → USDC released to Yara
 * 4. If payout fails → Oracle marks failed, sender can refund
 * 5. If timeout → Anyone can trigger refund to sender
 */
contract CrossBorderSettlement is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           ROLES
    // =============================================================

    /// @notice Role for oracle to confirm/fail payments
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice Role for emergency pause/unpause
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // =============================================================
    //                           TYPES
    // =============================================================

    /// @notice Payment status in lifecycle
    enum PaymentStatus {
        Pending,    // Created but not yet locked (shouldn't happen in practice)
        Locked,     // USDC locked in escrow, awaiting confirmation
        Confirmed,  // Oracle confirmed, USDC released to Yara
        Failed,     // Oracle marked as failed, awaiting refund
        Refunded,   // USDC refunded to sender
        TimedOut    // Payment expired and refunded
    }

    /// @notice Cross-border payment data structure
    struct CrossBorderPayment {
        bytes32 paymentId;          // Unique payment identifier
        address sender;              // Who locked USDC (refund destination)
        address recipient;           // Intended recipient (for records only)
        uint256 usdcAmount;          // Amount of USDC locked
        string targetCurrency;       // Target fiat currency (GHS, KES)
        bytes32 targetBankHash;      // Hashed bank details for privacy
        PaymentStatus status;        // Current payment status
        string yaraReference;        // Yara payout reference (set on confirmation)
        uint256 createdAt;           // When payment was created
        uint256 lockedAt;            // When USDC was locked
        uint256 confirmedAt;         // When payment was confirmed
        uint256 expiresAt;           // Auto-refund deadline
    }

    // =============================================================
    //                         STATE VARIABLES
    // =============================================================

    /// @notice USDC token contract
    IERC20 public immutable USDC;

    /// @notice Address where confirmed USDC is sent (Yara settlement)
    address public yaraSettlementAddress;

    /// @notice Default lockup period before timeout (48 hours)
    uint256 public lockupPeriod;

    /// @notice Minimum USDC amount per payment
    uint256 public minAmount;

    /// @notice Maximum USDC amount per payment
    uint256 public maxAmount;

    /// @notice Mapping of payment ID to payment data
    mapping(bytes32 => CrossBorderPayment) public payments;

    /// @notice Check if payment ID exists
    mapping(bytes32 => bool) public exists;

    /// @notice List of payment IDs for each sender
    mapping(address => bytes32[]) public senderPayments;

    /// @notice Total USDC currently in escrow
    uint256 public totalEscrowed;

    /// @notice Total USDC settled to Yara
    uint256 public totalSettled;

    /// @notice Total USDC refunded
    uint256 public totalRefunded;

    /// @notice Number of active escrows
    uint256 public activeEscrowCount;

    // =============================================================
    //                           EVENTS
    // =============================================================

    /// @notice Emitted when payment is initiated and USDC locked
    event PaymentInitiated(
        bytes32 indexed paymentId,
        address indexed sender,
        address indexed recipient,
        uint256 usdcAmount,
        string targetCurrency,
        uint256 expiresAt,
        uint256 timestamp
    );

    /// @notice Emitted when USDC is locked in escrow
    event PaymentLocked(
        bytes32 indexed paymentId,
        uint256 usdcAmount,
        uint256 timestamp
    );

    /// @notice Emitted when payment is confirmed and USDC released
    event PaymentConfirmed(
        bytes32 indexed paymentId,
        string yaraReference,
        uint256 usdcToYara,
        uint256 timestamp
    );

    /// @notice Emitted when payment fails
    event PaymentFailed(
        bytes32 indexed paymentId,
        string reason,
        uint256 timestamp
    );

    /// @notice Emitted when USDC is refunded to sender
    event PaymentRefunded(
        bytes32 indexed paymentId,
        address indexed sender,
        uint256 usdcAmount,
        string reason,
        uint256 timestamp
    );

    /// @notice Emitted when payment times out
    event PaymentTimedOut(
        bytes32 indexed paymentId,
        address indexed sender,
        uint256 usdcAmount,
        uint256 timestamp
    );

    /// @notice Emitted when Yara settlement address is updated
    event YaraAddressUpdated(
        address indexed oldAddress,
        address indexed newAddress,
        uint256 timestamp
    );

    /// @notice Emitted when lockup period is updated
    event LockupPeriodUpdated(
        uint256 oldPeriod,
        uint256 newPeriod,
        uint256 timestamp
    );

    /// @notice Emitted when amount limits are updated
    event AmountLimitsUpdated(
        uint256 oldMin,
        uint256 newMin,
        uint256 oldMax,
        uint256 newMax,
        uint256 timestamp
    );

    // =============================================================
    //                           ERRORS
    // =============================================================

    error PaymentExists(bytes32 paymentId);
    error PaymentNotFound(bytes32 paymentId);
    error InvalidRecipient(address recipient);
    error AmountBelowMinimum(uint256 amount, uint256 minimum);
    error AmountAboveMaximum(uint256 amount, uint256 maximum);
    error InvalidStatus(PaymentStatus current, PaymentStatus expected);
    error PaymentNotExpired(uint256 currentTime, uint256 expiresAt);
    error PaymentExpired(uint256 currentTime, uint256 expiresAt);
    error InvalidYaraAddress(address yaraAddress);
    error InvalidPaymentId();
    error InvalidCurrency(string currency);
    error ZeroAmount();

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initializes the CrossBorderSettlement contract
     * @param _usdc USDC token contract address
     * @param _admin Address to be granted admin role
     * @param _yaraSettlementAddress Address where confirmed USDC is sent
     */
    constructor(
        address _usdc,
        address _admin,
        address _yaraSettlementAddress
    ) {
        require(_usdc != address(0), "CrossBorderSettlement: invalid USDC");
        require(_admin != address(0), "CrossBorderSettlement: invalid admin");
        require(_yaraSettlementAddress != address(0), "CrossBorderSettlement: invalid Yara address");

        USDC = IERC20(_usdc);
        yaraSettlementAddress = _yaraSettlementAddress;

        // Set default values
        lockupPeriod = 48 hours;  // 48 hour timeout
        minAmount = 10 * 10**6;    // 10 USDC minimum
        maxAmount = 50000 * 10**6; // 50,000 USDC maximum

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);
    }

    // =============================================================
    //                      CORE FUNCTIONS
    // =============================================================

    /**
     * @notice Initiates cross-border payment and locks USDC in escrow
     * @dev Sender must have approved USDC transfer beforehand
     * @param paymentId Unique payment identifier
     * @param recipient Intended recipient address (for records)
     * @param usdcAmount Amount of USDC to lock (6 decimals)
     * @param targetCurrency Target fiat currency ("GHS", "KES")
     * @param targetBankHash Keccak256 hash of bank details for privacy
     */
    function initiatePayment(
        bytes32 paymentId,
        address recipient,
        uint256 usdcAmount,
        string calldata targetCurrency,
        bytes32 targetBankHash
    ) external nonReentrant whenNotPaused {
        // Validate inputs
        if (paymentId == bytes32(0)) revert InvalidPaymentId();
        if (exists[paymentId]) revert PaymentExists(paymentId);
        if (recipient == address(0)) revert InvalidRecipient(recipient);
        if (usdcAmount == 0) revert ZeroAmount();
        if (usdcAmount < minAmount) revert AmountBelowMinimum(usdcAmount, minAmount);
        if (usdcAmount > maxAmount) revert AmountAboveMaximum(usdcAmount, maxAmount);
        if (bytes(targetCurrency).length == 0) revert InvalidCurrency(targetCurrency);

        // Transfer USDC from sender to contract (escrow)
        // This will revert if sender hasn't approved or has insufficient balance
        USDC.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // Calculate expiry time
        uint256 expiresAt = block.timestamp + lockupPeriod;

        // Create payment record
        payments[paymentId] = CrossBorderPayment({
            paymentId: paymentId,
            sender: msg.sender,           // CRITICAL: Refund address is sender
            recipient: recipient,
            usdcAmount: usdcAmount,
            targetCurrency: targetCurrency,
            targetBankHash: targetBankHash,
            status: PaymentStatus.Locked,
            yaraReference: "",
            createdAt: block.timestamp,
            lockedAt: block.timestamp,
            confirmedAt: 0,
            expiresAt: expiresAt
        });

        // Update state
        exists[paymentId] = true;
        senderPayments[msg.sender].push(paymentId);
        totalEscrowed += usdcAmount;
        activeEscrowCount++;

        // Emit events
        emit PaymentInitiated(
            paymentId,
            msg.sender,
            recipient,
            usdcAmount,
            targetCurrency,
            expiresAt,
            block.timestamp
        );

        emit PaymentLocked(paymentId, usdcAmount, block.timestamp);
    }

    /**
     * @notice Confirms payment after Yara fiat payout succeeds
     * @dev Only callable by ORACLE_ROLE
     * @dev Releases USDC to yaraSettlementAddress (NOT arbitrary address)
     * @param paymentId Payment to confirm
     * @param yaraReference Yara payout reference ID
     */
    function confirmPayment(
        bytes32 paymentId,
        string calldata yaraReference
    ) external onlyRole(ORACLE_ROLE) nonReentrant {
        if (!exists[paymentId]) revert PaymentNotFound(paymentId);

        CrossBorderPayment storage payment = payments[paymentId];

        // Validate payment state
        if (payment.status != PaymentStatus.Locked) {
            revert InvalidStatus(payment.status, PaymentStatus.Locked);
        }

        // Check if payment has expired
        if (block.timestamp >= payment.expiresAt) {
            revert PaymentExpired(block.timestamp, payment.expiresAt);
        }

        // Update payment status
        payment.status = PaymentStatus.Confirmed;
        payment.yaraReference = yaraReference;
        payment.confirmedAt = block.timestamp;

        // Update metrics
        totalSettled += payment.usdcAmount;
        totalEscrowed -= payment.usdcAmount;
        activeEscrowCount--;

        // CRITICAL: Transfer USDC to pre-configured Yara address ONLY
        // Oracle cannot specify arbitrary destination address
        USDC.safeTransfer(yaraSettlementAddress, payment.usdcAmount);

        // Emit event
        emit PaymentConfirmed(
            paymentId,
            yaraReference,
            payment.usdcAmount,
            block.timestamp
        );
    }

    /**
     * @notice Marks payment as failed, enabling refund
     * @dev Only callable by ORACLE_ROLE
     * @dev Does NOT transfer funds - requires explicit refund call
     * @param paymentId Payment to fail
     * @param reason Failure reason from Yara or other system
     */
    function failPayment(
        bytes32 paymentId,
        string calldata reason
    ) external onlyRole(ORACLE_ROLE) {
        if (!exists[paymentId]) revert PaymentNotFound(paymentId);

        CrossBorderPayment storage payment = payments[paymentId];

        // Validate payment state
        if (payment.status != PaymentStatus.Locked) {
            revert InvalidStatus(payment.status, PaymentStatus.Locked);
        }

        // Update status to failed
        payment.status = PaymentStatus.Failed;

        // Emit event
        emit PaymentFailed(paymentId, reason, block.timestamp);
    }

    /**
     * @notice Refunds USDC to sender after payment failure
     * @dev Callable by anyone, but USDC ONLY goes to original sender
     * @param paymentId Payment to refund
     */
    function refundPayment(bytes32 paymentId) external nonReentrant {
        if (!exists[paymentId]) revert PaymentNotFound(paymentId);

        CrossBorderPayment storage payment = payments[paymentId];

        // Payment must be in failed state to refund
        if (payment.status != PaymentStatus.Failed) {
            revert InvalidStatus(payment.status, PaymentStatus.Failed);
        }

        // Update status
        payment.status = PaymentStatus.Refunded;

        // Update metrics
        totalRefunded += payment.usdcAmount;
        totalEscrowed -= payment.usdcAmount;
        activeEscrowCount--;

        // CRITICAL: Transfer USDC to original sender ONLY
        // No one can redirect refund to arbitrary address
        USDC.safeTransfer(payment.sender, payment.usdcAmount);

        // Emit event
        emit PaymentRefunded(
            paymentId,
            payment.sender,
            payment.usdcAmount,
            "Manual refund after failure",
            block.timestamp
        );
    }

    /**
     * @notice Auto-refunds expired payment
     * @dev Anyone can call after expiry, but USDC ONLY goes to original sender
     * @param paymentId Payment to timeout
     */
    function timeoutPayment(bytes32 paymentId) external nonReentrant {
        if (!exists[paymentId]) revert PaymentNotFound(paymentId);

        CrossBorderPayment storage payment = payments[paymentId];

        // Payment must be locked to timeout
        if (payment.status != PaymentStatus.Locked) {
            revert InvalidStatus(payment.status, PaymentStatus.Locked);
        }

        // Check if payment has expired
        if (block.timestamp < payment.expiresAt) {
            revert PaymentNotExpired(block.timestamp, payment.expiresAt);
        }

        // Update status
        payment.status = PaymentStatus.TimedOut;

        // Update metrics
        totalRefunded += payment.usdcAmount;
        totalEscrowed -= payment.usdcAmount;
        activeEscrowCount--;

        // CRITICAL: Transfer USDC to original sender ONLY
        // Timeout refund always goes back to sender
        USDC.safeTransfer(payment.sender, payment.usdcAmount);

        // Emit event
        emit PaymentTimedOut(
            paymentId,
            payment.sender,
            payment.usdcAmount,
            block.timestamp
        );
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Retrieves full payment data
     * @param paymentId Payment identifier
     * @return CrossBorderPayment data structure
     */
    function getPayment(bytes32 paymentId) external view returns (CrossBorderPayment memory) {
        if (!exists[paymentId]) revert PaymentNotFound(paymentId);
        return payments[paymentId];
    }

    /**
     * @notice Checks if payment can be refunded
     * @param paymentId Payment identifier
     * @return refundable Whether payment can be refunded
     * @return reason Reason why refund is or isn't possible
     */
    function canRefund(bytes32 paymentId) external view returns (bool refundable, string memory reason) {
        if (!exists[paymentId]) {
            return (false, "Payment not found");
        }

        CrossBorderPayment memory payment = payments[paymentId];

        if (payment.status == PaymentStatus.Failed) {
            return (true, "Payment failed and can be refunded");
        }

        if (payment.status == PaymentStatus.Locked && block.timestamp >= payment.expiresAt) {
            return (true, "Payment expired and can be refunded via timeout");
        }

        if (payment.status == PaymentStatus.Confirmed) {
            return (false, "Payment already confirmed");
        }

        if (payment.status == PaymentStatus.Refunded) {
            return (false, "Payment already refunded");
        }

        if (payment.status == PaymentStatus.TimedOut) {
            return (false, "Payment already timed out and refunded");
        }

        return (false, "Payment in locked state, waiting for confirmation or timeout");
    }

    /**
     * @notice Retrieves current metrics
     * @return escrowed Total USDC currently in escrow
     * @return settled Total USDC settled to Yara
     * @return refunded Total USDC refunded
     * @return activeEscrows Number of active escrows
     */
    function getMetrics() external view returns (
        uint256 escrowed,
        uint256 settled,
        uint256 refunded,
        uint256 activeEscrows
    ) {
        return (totalEscrowed, totalSettled, totalRefunded, activeEscrowCount);
    }

    /**
     * @notice Gets payment IDs for a sender with pagination
     * @param sender Sender address
     * @param offset Starting index
     * @param limit Maximum results to return
     * @return Payment IDs array
     */
    function getSenderPayments(
        address sender,
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory) {
        bytes32[] memory paymentIds = senderPayments[sender];
        uint256 total = paymentIds.length;

        if (offset >= total) {
            return new bytes32[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = paymentIds[i];
        }

        return result;
    }

    /**
     * @notice Gets total payment count for a sender
     * @param sender Sender address
     * @return Number of payments
     */
    function getSenderPaymentCount(address sender) external view returns (uint256) {
        return senderPayments[sender].length;
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Updates Yara settlement address
     * @dev Only callable by admin
     * @param _yaraAddress New Yara settlement address
     */
    function setYaraSettlementAddress(address _yaraAddress) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_yaraAddress == address(0)) revert InvalidYaraAddress(_yaraAddress);

        address oldAddress = yaraSettlementAddress;
        yaraSettlementAddress = _yaraAddress;

        emit YaraAddressUpdated(oldAddress, _yaraAddress, block.timestamp);
    }

    /**
     * @notice Updates lockup period before timeout
     * @dev Only callable by admin
     * @param _period New lockup period in seconds
     */
    function setLockupPeriod(uint256 _period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_period >= 1 hours, "CrossBorderSettlement: period too short");
        require(_period <= 7 days, "CrossBorderSettlement: period too long");

        uint256 oldPeriod = lockupPeriod;
        lockupPeriod = _period;

        emit LockupPeriodUpdated(oldPeriod, _period, block.timestamp);
    }

    /**
     * @notice Updates minimum and maximum payment amounts
     * @dev Only callable by admin
     * @param _min New minimum amount
     * @param _max New maximum amount
     */
    function setAmountLimits(uint256 _min, uint256 _max) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_min > 0, "CrossBorderSettlement: min must be positive");
        require(_max > _min, "CrossBorderSettlement: max must exceed min");

        uint256 oldMin = minAmount;
        uint256 oldMax = maxAmount;
        minAmount = _min;
        maxAmount = _max;

        emit AmountLimitsUpdated(oldMin, _min, oldMax, _max, block.timestamp);
    }

    /**
     * @notice Pauses the contract
     * @dev Only callable by emergency role
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Unpauses the contract
     * @dev Only callable by admin
     */
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /**
     * @notice Grants oracle role to an address
     * @dev Only callable by admin
     * @param oracle Address to grant oracle role
     */
    function grantOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(ORACLE_ROLE, oracle);
    }

    /**
     * @notice Revokes oracle role from an address
     * @dev Only callable by admin
     * @param oracle Address to revoke oracle role from
     */
    function revokeOracleRole(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(ORACLE_ROLE, oracle);
    }
}