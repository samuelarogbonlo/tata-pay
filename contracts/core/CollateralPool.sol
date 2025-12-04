// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title CollateralPool
 * @notice Manages USDC collateral deposits from fintechs for payment settlements
 * @dev Integrates with Asset Hub USDC precompile (Asset ID 1337, 6 decimals)
 *
 * Features:
 * - Minimum deposit threshold (1000 USDC)
 * - Separate tracking of available vs locked collateral
 * - Withdrawal requests with configurable time delays
 * - Emergency withdrawal for authorized admins
 * - Collateral locking/unlocking hooks for settlement engine
 * - Slashing mechanism for fraud or failed settlements
 * - Full audit trail via events
 * - Reentrancy protection on all state-changing functions
 * - Role-based access control (ADMIN, SETTLEMENT, SLASHER)
 * - Pausable for emergency circuit breaker
 *
 * Storage Layout (PVM-compatible):
 * - All state variables use explicit types
 * - Mappings and structs follow Solidity storage patterns
 * - No dynamic arrays in main state (only in structs)
 */
contract CollateralPool is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           ROLES
    // =============================================================

    /// @notice Role for settlement contract to lock/unlock collateral
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    /// @notice Role for fraud prevention to slash collateral
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    /// @notice Role for emergency operations
    bytes32 public constant EMERGENCY_ROLE = keccak256("EMERGENCY_ROLE");

    // =============================================================
    //                         CONSTANTS
    // =============================================================

    /// @notice USDC has 6 decimals on Asset Hub
    uint8 public constant USDC_DECIMALS = 6;

    /// @notice Minimum collateral deposit: 1000 USDC (1000 * 10^6)
    uint256 public constant MINIMUM_DEPOSIT = 1_000 * 10**6;

    /// @notice Default withdrawal delay: 24 hours
    uint256 public constant DEFAULT_WITHDRAWAL_DELAY = 24 hours;

    // =============================================================
    //                          STRUCTS
    // =============================================================

    /**
     * @notice Tracks fintech collateral balances
     * @param totalDeposited Total USDC deposited (lifetime)
     * @param availableBalance USDC available for settlements
     * @param lockedBalance USDC currently locked in active settlements
     * @param totalWithdrawn Total USDC withdrawn (lifetime)
     * @param totalSlashed Total USDC slashed for fraud (lifetime)
     */
    struct CollateralBalance {
        uint256 totalDeposited;
        uint256 availableBalance;
        uint256 lockedBalance;
        uint256 totalWithdrawn;
        uint256 totalSlashed;
    }

    /**
     * @notice Withdrawal request with time delay
     * @param amount USDC amount requested
     * @param requestTime Timestamp when withdrawal was requested
     * @param executed Whether withdrawal has been executed
     */
    struct WithdrawalRequest {
        uint256 amount;
        uint256 requestTime;
        bool executed;
    }

    // =============================================================
    //                          STORAGE
    // =============================================================

    /// @notice USDC token interface (immutable after construction)
    IERC20 public immutable USDC;

    /// @notice Withdrawal delay in seconds (configurable by admin)
    uint256 public withdrawalDelay;

    /// @notice Fintech collateral balances
    mapping(address => CollateralBalance) public balances;

    /// @notice Active withdrawal requests
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Treasury address for slashed funds
    address public treasury;

    /// @notice Total value locked in the pool
    uint256 public totalValueLocked;

    // =============================================================
    //                          EVENTS
    // =============================================================

    /**
     * @notice Emitted when a fintech deposits collateral
     * @param fintech Address of the fintech
     * @param amount USDC amount deposited
     * @param newAvailableBalance Updated available balance
     * @param timestamp Block timestamp
     */
    event Deposited(
        address indexed fintech,
        uint256 amount,
        uint256 newAvailableBalance,
        uint256 timestamp
    );

    /**
     * @notice Emitted when a withdrawal is requested
     * @param fintech Address of the fintech
     * @param amount USDC amount requested
     * @param unlockTime Timestamp when withdrawal can be executed
     */
    event WithdrawalRequested(
        address indexed fintech,
        uint256 amount,
        uint256 unlockTime
    );

    /**
     * @notice Emitted when a withdrawal is executed
     * @param fintech Address of the fintech
     * @param amount USDC amount withdrawn
     * @param newAvailableBalance Updated available balance
     */
    event Withdrawn(
        address indexed fintech,
        uint256 amount,
        uint256 newAvailableBalance
    );

    /**
     * @notice Emitted when a withdrawal request is cancelled
     * @param fintech Address of the fintech
     * @param amount USDC amount that was requested
     */
    event WithdrawalCancelled(address indexed fintech, uint256 amount);

    /**
     * @notice Emitted when collateral is locked for a settlement
     * @param fintech Address of the fintech
     * @param amount USDC amount locked
     * @param settlementId Settlement batch identifier
     * @param newLockedBalance Updated locked balance
     */
    event CollateralLocked(
        address indexed fintech,
        uint256 amount,
        bytes32 indexed settlementId,
        uint256 newLockedBalance
    );

    /**
     * @notice Emitted when collateral is unlocked after settlement
     * @param fintech Address of the fintech
     * @param amount USDC amount unlocked
     * @param settlementId Settlement batch identifier
     * @param newAvailableBalance Updated available balance
     */
    event CollateralUnlocked(
        address indexed fintech,
        uint256 amount,
        bytes32 indexed settlementId,
        uint256 newAvailableBalance
    );

    /**
     * @notice Emitted when collateral is transferred to merchant
     * @param fintech Address of the fintech
     * @param recipient Address receiving the USDC (merchant)
     * @param amount USDC amount transferred
     * @param settlementId Settlement batch identifier
     * @param newLockedBalance Updated locked balance
     */
    event CollateralTransferred(
        address indexed fintech,
        address indexed recipient,
        uint256 amount,
        bytes32 indexed settlementId,
        uint256 newLockedBalance
    );

    /**
     * @notice Emitted when collateral is slashed
     * @param fintech Address of the fintech
     * @param amount USDC amount slashed
     * @param reason Reason code for slashing
     * @param newLockedBalance Updated locked balance
     */
    event CollateralSlashed(
        address indexed fintech,
        uint256 amount,
        string reason,
        uint256 newLockedBalance
    );

    /**
     * @notice Emitted when emergency withdrawal is executed
     * @param admin Address of the admin
     * @param fintech Address of the fintech
     * @param amount USDC amount withdrawn
     */
    event EmergencyWithdrawal(
        address indexed admin,
        address indexed fintech,
        uint256 amount
    );

    /**
     * @notice Emitted when withdrawal delay is updated
     * @param oldDelay Previous delay in seconds
     * @param newDelay New delay in seconds
     */
    event WithdrawalDelayUpdated(uint256 oldDelay, uint256 newDelay);

    /**
     * @notice Emitted when treasury address is updated
     * @param oldTreasury Previous treasury address
     * @param newTreasury New treasury address
     */
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initialize the CollateralPool contract
     * @param _usdcAddress Address of USDC token (Asset Hub precompile or mock for testing)
     * @param _admin Address with admin role
     * @param _treasury Address to receive slashed funds
     */
    constructor(address _usdcAddress, address _admin, address _treasury) {
        require(_usdcAddress != address(0), "CollateralPool: Invalid USDC address");
        require(_admin != address(0), "CollateralPool: Invalid admin address");
        require(_treasury != address(0), "CollateralPool: Invalid treasury address");

        USDC = IERC20(_usdcAddress);
        treasury = _treasury;
        withdrawalDelay = DEFAULT_WITHDRAWAL_DELAY;

        // Grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(EMERGENCY_ROLE, _admin);

        emit TreasuryUpdated(address(0), _treasury);
    }

    // =============================================================
    //                     DEPOSIT FUNCTIONS
    // =============================================================

    /**
     * @notice Deposit USDC collateral into the pool
     * @param amount USDC amount to deposit (6 decimals)
     * @dev Requires prior USDC approval
     * @dev Must meet minimum deposit threshold
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount >= MINIMUM_DEPOSIT, "CollateralPool: Below minimum deposit");

        CollateralBalance storage balance = balances[msg.sender];

        // Transfer USDC from fintech to pool
        USDC.safeTransferFrom(msg.sender, address(this), amount);

        // Update balances
        balance.totalDeposited += amount;
        balance.availableBalance += amount;
        totalValueLocked += amount;

        emit Deposited(
            msg.sender,
            amount,
            balance.availableBalance,
            block.timestamp
        );
    }

    // =============================================================
    //                    WITHDRAWAL FUNCTIONS
    // =============================================================

    /**
     * @notice Request withdrawal of available collateral
     * @param amount USDC amount to withdraw
     * @dev Initiates time-delayed withdrawal process
     * @dev Cannot withdraw locked collateral
     */
    function requestWithdrawal(uint256 amount) external nonReentrant whenNotPaused {
        CollateralBalance storage balance = balances[msg.sender];

        require(amount > 0, "CollateralPool: Zero amount");
        require(
            amount <= balance.availableBalance,
            "CollateralPool: Insufficient available balance"
        );
        require(
            withdrawalRequests[msg.sender].requestTime == 0,
            "CollateralPool: Pending withdrawal exists"
        );

        // Create withdrawal request
        uint256 unlockTime = block.timestamp + withdrawalDelay;
        withdrawalRequests[msg.sender] = WithdrawalRequest({
            amount: amount,
            requestTime: block.timestamp,
            executed: false
        });

        emit WithdrawalRequested(msg.sender, amount, unlockTime);
    }

    /**
     * @notice Execute a withdrawal after time delay has passed
     * @dev Completes the withdrawal request and transfers USDC
     */
    function executeWithdrawal() external nonReentrant whenNotPaused {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];

        require(request.requestTime > 0, "CollateralPool: No withdrawal request");
        require(!request.executed, "CollateralPool: Already executed");
        require(
            block.timestamp >= request.requestTime + withdrawalDelay,
            "CollateralPool: Withdrawal delay not met"
        );

        CollateralBalance storage balance = balances[msg.sender];
        uint256 amount = request.amount;

        // Verify available balance (in case it was locked after request)
        require(
            amount <= balance.availableBalance,
            "CollateralPool: Insufficient available balance"
        );

        // Update state before transfer (CEI pattern)
        request.executed = true;
        balance.availableBalance -= amount;
        balance.totalWithdrawn += amount;
        totalValueLocked -= amount;

        // Clear withdrawal request
        delete withdrawalRequests[msg.sender];

        // Transfer USDC
        USDC.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount, balance.availableBalance);
    }

    /**
     * @notice Cancel a pending withdrawal request
     * @dev Allows fintech to cancel before execution
     */
    function cancelWithdrawal() external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[msg.sender];

        require(request.requestTime > 0, "CollateralPool: No withdrawal request");
        require(!request.executed, "CollateralPool: Already executed");

        uint256 amount = request.amount;
        delete withdrawalRequests[msg.sender];

        emit WithdrawalCancelled(msg.sender, amount);
    }

    // =============================================================
    //                  SETTLEMENT HOOK FUNCTIONS
    // =============================================================

    /**
     * @notice Lock collateral for a settlement batch
     * @param fintech Address of the fintech
     * @param amount USDC amount to lock
     * @param settlementId Unique settlement batch identifier
     * @dev Only callable by settlement contract
     */
    function lockCollateral(
        address fintech,
        uint256 amount,
        bytes32 settlementId
    ) external onlyRole(SETTLEMENT_ROLE) nonReentrant {
        CollateralBalance storage balance = balances[fintech];

        require(
            amount <= balance.availableBalance,
            "CollateralPool: Insufficient available balance"
        );

        // Move from available to locked
        balance.availableBalance -= amount;
        balance.lockedBalance += amount;

        emit CollateralLocked(
            fintech,
            amount,
            settlementId,
            balance.lockedBalance
        );
    }

    /**
     * @notice Unlock collateral after successful settlement
     * @param fintech Address of the fintech
     * @param amount USDC amount to unlock
     * @param settlementId Settlement batch identifier
     * @dev Only callable by settlement contract
     * @dev Returns collateral to available balance
     */
    function unlockCollateral(
        address fintech,
        uint256 amount,
        bytes32 settlementId
    ) external onlyRole(SETTLEMENT_ROLE) nonReentrant {
        CollateralBalance storage balance = balances[fintech];

        require(
            amount <= balance.lockedBalance,
            "CollateralPool: Insufficient locked balance"
        );

        // Move from locked to available
        balance.lockedBalance -= amount;
        balance.availableBalance += amount;

        emit CollateralUnlocked(
            fintech,
            amount,
            settlementId,
            balance.availableBalance
        );
    }

    /**
     * @notice Transfer USDC from locked collateral to recipient
     * @param fintech Address of the fintech whose collateral is locked
     * @param recipient Address to receive the USDC (merchant)
     * @param amount USDC amount to transfer
     * @param settlementId Settlement batch identifier
     * @dev Only callable by settlement contract
     * @dev Permanently removes collateral (pays out merchant)
     * @dev Reduces locked balance and TVL
     */
    function transferFromLocked(
        address fintech,
        address recipient,
        uint256 amount,
        bytes32 settlementId
    ) external onlyRole(SETTLEMENT_ROLE) nonReentrant {
        require(recipient != address(0), "CollateralPool: Invalid recipient");

        CollateralBalance storage balance = balances[fintech];

        require(
            amount <= balance.lockedBalance,
            "CollateralPool: Insufficient locked balance"
        );

        // Update state before transfer (CEI pattern)
        balance.lockedBalance -= amount;
        totalValueLocked -= amount;

        // Transfer USDC to recipient
        USDC.safeTransfer(recipient, amount);

        emit CollateralTransferred(
            fintech,
            recipient,
            amount,
            settlementId,
            balance.lockedBalance
        );
    }

    // =============================================================
    //                     SLASHING FUNCTIONS
    // =============================================================

    /**
     * @notice Slash locked collateral for fraud or settlement failure
     * @param fintech Address of the fintech
     * @param amount USDC amount to slash
     * @param reason Reason code for slashing
     * @dev Only callable by authorized slasher
     * @dev Transfers slashed funds to treasury
     */
    function slashCollateral(
        address fintech,
        uint256 amount,
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        CollateralBalance storage balance = balances[fintech];

        require(
            amount <= balance.lockedBalance,
            "CollateralPool: Insufficient locked balance"
        );

        // Update balances
        balance.lockedBalance -= amount;
        balance.totalSlashed += amount;
        totalValueLocked -= amount;

        // Transfer slashed funds to treasury
        USDC.safeTransfer(treasury, amount);

        emit CollateralSlashed(fintech, amount, reason, balance.lockedBalance);
    }

    // =============================================================
    //                   EMERGENCY FUNCTIONS
    // =============================================================

    /**
     * @notice Emergency withdrawal bypassing time delay
     * @param fintech Address of the fintech
     * @param amount USDC amount to withdraw
     * @dev Only callable by emergency role
     * @dev Use only in critical situations
     */
    function emergencyWithdraw(
        address fintech,
        uint256 amount
    ) external onlyRole(EMERGENCY_ROLE) nonReentrant {
        CollateralBalance storage balance = balances[fintech];

        require(
            amount <= balance.availableBalance,
            "CollateralPool: Insufficient available balance"
        );

        // Update state
        balance.availableBalance -= amount;
        balance.totalWithdrawn += amount;
        totalValueLocked -= amount;

        // Transfer USDC
        USDC.safeTransfer(fintech, amount);

        emit EmergencyWithdrawal(msg.sender, fintech, amount);
        emit Withdrawn(fintech, amount, balance.availableBalance);
    }

    /**
     * @notice Pause the contract (emergency circuit breaker)
     * @dev Only callable by emergency role
     */
    function pause() external onlyRole(EMERGENCY_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause the contract
     * @dev Only callable by emergency role
     */
    function unpause() external onlyRole(EMERGENCY_ROLE) {
        _unpause();
    }

    // =============================================================
    //                     ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Update withdrawal delay
     * @param newDelay New delay in seconds
     * @dev Only callable by admin
     */
    function setWithdrawalDelay(uint256 newDelay) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDelay >= 1 hours, "CollateralPool: Delay too short");
        require(newDelay <= 7 days, "CollateralPool: Delay too long");

        uint256 oldDelay = withdrawalDelay;
        withdrawalDelay = newDelay;

        emit WithdrawalDelayUpdated(oldDelay, newDelay);
    }

    /**
     * @notice Update treasury address
     * @param newTreasury New treasury address
     * @dev Only callable by admin
     */
    function setTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTreasury != address(0), "CollateralPool: Invalid treasury address");

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasuryUpdated(oldTreasury, newTreasury);
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get fintech collateral balance details
     * @param fintech Address of the fintech
     * @return totalDeposited Total USDC deposited (lifetime)
     * @return availableBalance USDC available for settlements
     * @return lockedBalance USDC locked in settlements
     * @return totalWithdrawn Total USDC withdrawn (lifetime)
     * @return totalSlashed Total USDC slashed (lifetime)
     */
    function getBalance(address fintech)
        external
        view
        returns (
            uint256 totalDeposited,
            uint256 availableBalance,
            uint256 lockedBalance,
            uint256 totalWithdrawn,
            uint256 totalSlashed
        )
    {
        CollateralBalance memory balance = balances[fintech];
        return (
            balance.totalDeposited,
            balance.availableBalance,
            balance.lockedBalance,
            balance.totalWithdrawn,
            balance.totalSlashed
        );
    }

    /**
     * @notice Get withdrawal request details
     * @param fintech Address of the fintech
     * @return amount USDC amount requested
     * @return requestTime Timestamp of request
     * @return unlockTime Timestamp when executable
     * @return executed Whether already executed
     */
    function getWithdrawalRequest(address fintech)
        external
        view
        returns (
            uint256 amount,
            uint256 requestTime,
            uint256 unlockTime,
            bool executed
        )
    {
        WithdrawalRequest memory request = withdrawalRequests[fintech];
        return (
            request.amount,
            request.requestTime,
            request.requestTime > 0 ? request.requestTime + withdrawalDelay : 0,
            request.executed
        );
    }

    /**
     * @notice Check if a withdrawal is ready to execute
     * @param fintech Address of the fintech
     * @return ready Whether withdrawal can be executed
     */
    function isWithdrawalReady(address fintech) external view returns (bool ready) {
        WithdrawalRequest memory request = withdrawalRequests[fintech];
        return
            request.requestTime > 0 &&
            !request.executed &&
            block.timestamp >= request.requestTime + withdrawalDelay;
    }

    /**
     * @notice Get total collateral available across all fintechs
     * @return total Total USDC in the pool
     */
    function getTotalValueLocked() external view returns (uint256 total) {
        return totalValueLocked;
    }
}
