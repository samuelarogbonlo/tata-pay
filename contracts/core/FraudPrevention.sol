// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FraudPrevention
 * @notice Manages fraud prevention for Tata-Pay settlements
 *
 * Features:
 * - Blacklist/whitelist address management
 * - Velocity limits (hourly and daily)
 * - Transaction monitoring and validation
 * - Emergency freeze functionality
 * - Integration with PaymentSettlement
 *
 * Security:
 * - Role-based access control
 * - Pause mechanism for emergencies
 * - Reentrancy protection
 */
contract FraudPrevention is AccessControl, Pausable, ReentrancyGuard {
    // ============ Roles ============

    bytes32 public constant FRAUD_MANAGER_ROLE = keccak256("FRAUD_MANAGER_ROLE");
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // ============ Structs ============

    struct VelocityLimits {
        uint256 hourlyTransactionLimit;    // Max transactions per hour
        uint256 dailyTransactionLimit;     // Max transactions per day
        uint256 hourlyAmountLimit;         // Max USDC per hour (6 decimals)
        uint256 dailyAmountLimit;          // Max USDC per day (6 decimals)
    }

    struct TransactionWindow {
        uint256 hourlyCount;      // Transactions in last hour
        uint256 dailyCount;       // Transactions in last day
        uint256 hourlyAmount;     // Amount in last hour
        uint256 dailyAmount;      // Amount in last day
        uint256 lastHourReset;    // Timestamp of last hour window reset
        uint256 lastDayReset;     // Timestamp of last day window reset
    }

    struct BlacklistEntry {
        bool isBlacklisted;
        string reason;
        uint256 timestamp;
        address blockedBy;
    }

    // ============ State Variables ============

    // Default velocity limits
    VelocityLimits public defaultLimits;

    // Address-specific velocity limits (overrides default)
    mapping(address => VelocityLimits) public customLimits;
    mapping(address => bool) public hasCustomLimits;

    // Transaction tracking
    mapping(address => TransactionWindow) public transactionWindows;

    // Blacklist/whitelist
    mapping(address => BlacklistEntry) public blacklist;
    mapping(address => bool) public whitelist;

    // Emergency freeze
    mapping(address => bool) public frozen;

    // Metrics
    uint256 public totalBlacklisted;
    uint256 public totalWhitelisted;
    uint256 public totalViolations;
    uint256 public totalTransactionsValidated;

    // ============ Constants ============

    uint256 private constant HOUR = 1 hours;
    uint256 private constant DAY = 1 days;

    // ============ Events ============

    event AddressBlacklisted(
        address indexed account,
        string reason,
        address indexed blockedBy,
        uint256 timestamp
    );

    event AddressUnblacklisted(
        address indexed account,
        address indexed unblockedBy,
        uint256 timestamp
    );

    event AddressWhitelisted(
        address indexed account,
        address indexed addedBy,
        uint256 timestamp
    );

    event AddressRemovedFromWhitelist(
        address indexed account,
        address indexed removedBy,
        uint256 timestamp
    );

    event VelocityLimitExceeded(
        address indexed account,
        string limitType,
        uint256 current,
        uint256 limit,
        uint256 timestamp
    );

    event TransactionValidated(
        address indexed account,
        uint256 amount,
        bool passed,
        uint256 timestamp
    );

    event DefaultLimitsUpdated(
        uint256 hourlyTxLimit,
        uint256 dailyTxLimit,
        uint256 hourlyAmountLimit,
        uint256 dailyAmountLimit,
        uint256 timestamp
    );

    event CustomLimitsSet(
        address indexed account,
        uint256 hourlyTxLimit,
        uint256 dailyTxLimit,
        uint256 hourlyAmountLimit,
        uint256 dailyAmountLimit,
        uint256 timestamp
    );

    event AddressFrozen(
        address indexed account,
        address indexed frozenBy,
        uint256 timestamp
    );

    event AddressUnfrozen(
        address indexed account,
        address indexed unfrozenBy,
        uint256 timestamp
    );

    // ============ Constructor ============

    /**
     * @notice Initialize FraudPrevention contract
     * @param _admin Admin address
     */
    constructor(address _admin) {
        require(_admin != address(0), "FraudPrevention: Invalid admin");

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(FRAUD_MANAGER_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);

        // Set default velocity limits
        defaultLimits = VelocityLimits({
            hourlyTransactionLimit: 10,                        // 10 tx/hour
            dailyTransactionLimit: 100,                        // 100 tx/day
            hourlyAmountLimit: 100000 * 10**6,                 // 100k USDC/hour
            dailyAmountLimit: 1000000 * 10**6                  // 1M USDC/day
        });
    }

    // ============ External Functions ============

    /**
     * @notice Validate transaction against fraud rules
     * @param account Address to validate
     * @param amount Transaction amount
     * @return valid True if transaction passes all checks
     */
    function validateTransaction(
        address account,
        uint256 amount
    ) external nonReentrant whenNotPaused returns (bool valid) {
        require(account != address(0), "FraudPrevention: Invalid account");

        totalTransactionsValidated++;

        // Check if frozen
        if (frozen[account]) {
            emit TransactionValidated(account, amount, false, block.timestamp);
            return false;
        }

        // Check if blacklisted
        if (blacklist[account].isBlacklisted) {
            emit TransactionValidated(account, amount, false, block.timestamp);
            return false;
        }

        // Whitelisted addresses bypass velocity limits
        if (whitelist[account]) {
            emit TransactionValidated(account, amount, true, block.timestamp);
            return true;
        }

        // Check velocity limits
        bool velocityPassed = _checkVelocityLimits(account, amount);

        if (velocityPassed) {
            // Record transaction
            _recordTransaction(account, amount);
            emit TransactionValidated(account, amount, true, block.timestamp);
            return true;
        } else {
            totalViolations++;
            emit TransactionValidated(account, amount, false, block.timestamp);
            return false;
        }
    }

    /**
     * @notice Add address to blacklist
     * @param account Address to blacklist
     * @param reason Reason for blacklisting
     */
    function addToBlacklist(
        address account,
        string calldata reason
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(account != address(0), "FraudPrevention: Invalid account");
        require(!blacklist[account].isBlacklisted, "FraudPrevention: Already blacklisted");

        blacklist[account] = BlacklistEntry({
            isBlacklisted: true,
            reason: reason,
            timestamp: block.timestamp,
            blockedBy: msg.sender
        });

        totalBlacklisted++;

        emit AddressBlacklisted(account, reason, msg.sender, block.timestamp);
    }

    /**
     * @notice Remove address from blacklist
     * @param account Address to unblacklist
     */
    function removeFromBlacklist(
        address account
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(blacklist[account].isBlacklisted, "FraudPrevention: Not blacklisted");

        delete blacklist[account];
        totalBlacklisted--;

        emit AddressUnblacklisted(account, msg.sender, block.timestamp);
    }

    /**
     * @notice Add address to whitelist (bypasses velocity limits)
     * @param account Address to whitelist
     */
    function addToWhitelist(
        address account
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(account != address(0), "FraudPrevention: Invalid account");
        require(!whitelist[account], "FraudPrevention: Already whitelisted");

        whitelist[account] = true;
        totalWhitelisted++;

        emit AddressWhitelisted(account, msg.sender, block.timestamp);
    }

    /**
     * @notice Remove address from whitelist
     * @param account Address to remove
     */
    function removeFromWhitelist(
        address account
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(whitelist[account], "FraudPrevention: Not whitelisted");

        whitelist[account] = false;
        totalWhitelisted--;

        emit AddressRemovedFromWhitelist(account, msg.sender, block.timestamp);
    }

    /**
     * @notice Set default velocity limits
     * @param hourlyTxLimit Hourly transaction limit
     * @param dailyTxLimit Daily transaction limit
     * @param hourlyAmountLimit Hourly amount limit
     * @param dailyAmountLimit Daily amount limit
     */
    function setDefaultLimits(
        uint256 hourlyTxLimit,
        uint256 dailyTxLimit,
        uint256 hourlyAmountLimit,
        uint256 dailyAmountLimit
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(hourlyTxLimit > 0, "FraudPrevention: Invalid hourly tx limit");
        require(dailyTxLimit >= hourlyTxLimit, "FraudPrevention: Daily must be >= hourly");
        require(hourlyAmountLimit > 0, "FraudPrevention: Invalid hourly amount limit");
        require(dailyAmountLimit >= hourlyAmountLimit, "FraudPrevention: Daily must be >= hourly");

        defaultLimits = VelocityLimits({
            hourlyTransactionLimit: hourlyTxLimit,
            dailyTransactionLimit: dailyTxLimit,
            hourlyAmountLimit: hourlyAmountLimit,
            dailyAmountLimit: dailyAmountLimit
        });

        emit DefaultLimitsUpdated(
            hourlyTxLimit,
            dailyTxLimit,
            hourlyAmountLimit,
            dailyAmountLimit,
            block.timestamp
        );
    }

    /**
     * @notice Set custom velocity limits for specific address
     * @param account Address to set limits for
     * @param hourlyTxLimit Hourly transaction limit
     * @param dailyTxLimit Daily transaction limit
     * @param hourlyAmountLimit Hourly amount limit
     * @param dailyAmountLimit Daily amount limit
     */
    function setCustomLimits(
        address account,
        uint256 hourlyTxLimit,
        uint256 dailyTxLimit,
        uint256 hourlyAmountLimit,
        uint256 dailyAmountLimit
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(account != address(0), "FraudPrevention: Invalid account");
        require(hourlyTxLimit > 0, "FraudPrevention: Invalid hourly tx limit");
        require(dailyTxLimit >= hourlyTxLimit, "FraudPrevention: Daily must be >= hourly");
        require(hourlyAmountLimit > 0, "FraudPrevention: Invalid hourly amount limit");
        require(dailyAmountLimit >= hourlyAmountLimit, "FraudPrevention: Daily must be >= hourly");

        customLimits[account] = VelocityLimits({
            hourlyTransactionLimit: hourlyTxLimit,
            dailyTransactionLimit: dailyTxLimit,
            hourlyAmountLimit: hourlyAmountLimit,
            dailyAmountLimit: dailyAmountLimit
        });

        hasCustomLimits[account] = true;

        emit CustomLimitsSet(
            account,
            hourlyTxLimit,
            dailyTxLimit,
            hourlyAmountLimit,
            dailyAmountLimit,
            block.timestamp
        );
    }

    /**
     * @notice Remove custom limits for address
     * @param account Address to remove custom limits
     */
    function removeCustomLimits(
        address account
    ) external onlyRole(FRAUD_MANAGER_ROLE) {
        require(hasCustomLimits[account], "FraudPrevention: No custom limits");

        delete customLimits[account];
        hasCustomLimits[account] = false;
    }

    /**
     * @notice Emergency freeze address
     * @param account Address to freeze
     */
    function freezeAddress(
        address account
    ) external onlyRole(EMERGENCY_ROLE) {
        require(account != address(0), "FraudPrevention: Invalid account");
        require(!frozen[account], "FraudPrevention: Already frozen");

        frozen[account] = true;

        emit AddressFrozen(account, msg.sender, block.timestamp);
    }

    /**
     * @notice Unfreeze address
     * @param account Address to unfreeze
     */
    function unfreezeAddress(
        address account
    ) external onlyRole(EMERGENCY_ROLE) {
        require(frozen[account], "FraudPrevention: Not frozen");

        frozen[account] = false;

        emit AddressUnfrozen(account, msg.sender, block.timestamp);
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
     * @notice Check if address can transact
     * @param account Address to check
     * @param amount Transaction amount
     * @return allowed True if address can transact
     * @return reason Reason if cannot transact
     */
    function canTransact(
        address account,
        uint256 amount
    ) external view returns (bool allowed, string memory reason) {
        if (frozen[account]) {
            return (false, "Address frozen");
        }

        if (blacklist[account].isBlacklisted) {
            return (false, blacklist[account].reason);
        }

        if (whitelist[account]) {
            return (true, "Whitelisted");
        }

        // Check velocity limits
        VelocityLimits memory limits = _getApplicableLimits(account);
        TransactionWindow memory window = transactionWindows[account];

        // Reset windows if needed
        if (block.timestamp >= window.lastHourReset + HOUR) {
            window.hourlyCount = 0;
            window.hourlyAmount = 0;
        }

        if (block.timestamp >= window.lastDayReset + DAY) {
            window.dailyCount = 0;
            window.dailyAmount = 0;
        }

        // Check limits
        if (window.hourlyCount >= limits.hourlyTransactionLimit) {
            return (false, "Hourly transaction limit exceeded");
        }

        if (window.dailyCount >= limits.dailyTransactionLimit) {
            return (false, "Daily transaction limit exceeded");
        }

        if (window.hourlyAmount + amount > limits.hourlyAmountLimit) {
            return (false, "Hourly amount limit exceeded");
        }

        if (window.dailyAmount + amount > limits.dailyAmountLimit) {
            return (false, "Daily amount limit exceeded");
        }

        return (true, "Valid");
    }

    /**
     * @notice Get blacklist info for address
     * @param account Address to check
     * @return isBlacklisted True if blacklisted
     * @return reason Blacklist reason
     * @return timestamp When blacklisted
     * @return blockedBy Who blacklisted
     */
    function getBlacklistInfo(
        address account
    ) external view returns (
        bool isBlacklisted,
        string memory reason,
        uint256 timestamp,
        address blockedBy
    ) {
        BlacklistEntry memory entry = blacklist[account];
        return (entry.isBlacklisted, entry.reason, entry.timestamp, entry.blockedBy);
    }

    /**
     * @notice Get applicable limits for address
     * @param account Address to check
     * @return limits Velocity limits
     */
    function getApplicableLimits(
        address account
    ) external view returns (VelocityLimits memory limits) {
        return _getApplicableLimits(account);
    }

    /**
     * @notice Get transaction window for address
     * @param account Address to check
     * @return window Transaction window
     */
    function getTransactionWindow(
        address account
    ) external view returns (TransactionWindow memory window) {
        return transactionWindows[account];
    }

    /**
     * @notice Get metrics
     * @return _totalBlacklisted Total blacklisted addresses
     * @return _totalWhitelisted Total whitelisted addresses
     * @return _totalViolations Total velocity violations
     * @return _totalValidated Total transactions validated
     */
    function getMetrics() external view returns (
        uint256 _totalBlacklisted,
        uint256 _totalWhitelisted,
        uint256 _totalViolations,
        uint256 _totalValidated
    ) {
        return (
            totalBlacklisted,
            totalWhitelisted,
            totalViolations,
            totalTransactionsValidated
        );
    }

    // ============ Internal Functions ============

    /**
     * @notice Check velocity limits for account
     * @param account Address to check
     * @param amount Transaction amount
     * @return passed True if within limits
     */
    function _checkVelocityLimits(
        address account,
        uint256 amount
    ) internal returns (bool passed) {
        VelocityLimits memory limits = _getApplicableLimits(account);
        TransactionWindow storage window = transactionWindows[account];

        // Initialize window if needed
        if (window.lastHourReset == 0) {
            window.lastHourReset = block.timestamp;
            window.lastDayReset = block.timestamp;
        }

        // Reset hourly window if needed
        if (block.timestamp >= window.lastHourReset + HOUR) {
            window.hourlyCount = 0;
            window.hourlyAmount = 0;
            window.lastHourReset = block.timestamp;
        }

        // Reset daily window if needed
        if (block.timestamp >= window.lastDayReset + DAY) {
            window.dailyCount = 0;
            window.dailyAmount = 0;
            window.lastDayReset = block.timestamp;
        }

        // Check hourly transaction limit
        if (window.hourlyCount >= limits.hourlyTransactionLimit) {
            emit VelocityLimitExceeded(
                account,
                "Hourly transaction count",
                window.hourlyCount,
                limits.hourlyTransactionLimit,
                block.timestamp
            );
            return false;
        }

        // Check daily transaction limit
        if (window.dailyCount >= limits.dailyTransactionLimit) {
            emit VelocityLimitExceeded(
                account,
                "Daily transaction count",
                window.dailyCount,
                limits.dailyTransactionLimit,
                block.timestamp
            );
            return false;
        }

        // Check hourly amount limit
        if (window.hourlyAmount + amount > limits.hourlyAmountLimit) {
            emit VelocityLimitExceeded(
                account,
                "Hourly amount",
                window.hourlyAmount + amount,
                limits.hourlyAmountLimit,
                block.timestamp
            );
            return false;
        }

        // Check daily amount limit
        if (window.dailyAmount + amount > limits.dailyAmountLimit) {
            emit VelocityLimitExceeded(
                account,
                "Daily amount",
                window.dailyAmount + amount,
                limits.dailyAmountLimit,
                block.timestamp
            );
            return false;
        }

        return true;
    }

    /**
     * @notice Record transaction in window
     * @param account Address
     * @param amount Transaction amount
     */
    function _recordTransaction(
        address account,
        uint256 amount
    ) internal {
        TransactionWindow storage window = transactionWindows[account];

        window.hourlyCount++;
        window.dailyCount++;
        window.hourlyAmount += amount;
        window.dailyAmount += amount;
    }

    /**
     * @notice Get applicable limits for account
     * @param account Address
     * @return limits Velocity limits (custom or default)
     */
    function _getApplicableLimits(
        address account
    ) internal view returns (VelocityLimits memory limits) {
        if (hasCustomLimits[account]) {
            return customLimits[account];
        }
        return defaultLimits;
    }
}
