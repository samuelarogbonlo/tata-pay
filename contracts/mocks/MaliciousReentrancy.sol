// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../core/CrossBorderSettlement.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MaliciousReentrancy
 * @notice Mock contract for testing reentrancy attack protection
 * @dev Attempts to recursively call refundPayment() during USDC transfer
 */
contract MaliciousReentrancy {
    CrossBorderSettlement public settlement;
    bytes32 public targetPaymentId;
    uint256 public attackCount;
    bool public attacking;

    constructor(address _settlement) {
        settlement = CrossBorderSettlement(_settlement);
    }

    /**
     * @notice Set the payment ID to attack
     */
    function setPaymentId(bytes32 _paymentId) external {
        targetPaymentId = _paymentId;
    }

    /**
     * @notice Initiate the reentrancy attack on refund
     */
    function attackRefund() external {
        attacking = true;
        attackCount = 0;
        settlement.refundPayment(targetPaymentId);
    }

    /**
     * @notice Initiate the reentrancy attack on timeout
     */
    function attackTimeout() external {
        attacking = true;
        attackCount = 0;
        settlement.timeoutPayment(targetPaymentId);
    }

    /**
     * @notice Receive function - attempts reentrancy when receiving USDC
     * @dev Note: This won't actually trigger on ERC20 transfers (no callback)
     *      but demonstrates the pattern. Real attack would need ERC777 or similar.
     */
    receive() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            // Try to re-enter refundPayment
            try settlement.refundPayment(targetPaymentId) {
                // Should fail due to ReentrancyGuard
            } catch {
                // Expected to fail
            }
        }
    }

    /**
     * @notice Fallback function
     */
    fallback() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            try settlement.refundPayment(targetPaymentId) {
                // Should fail
            } catch {
                // Expected
            }
        }
    }
}
