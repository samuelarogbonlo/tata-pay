// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../core/PaymentSettlement.sol";

/**
 * @title MaliciousReentrancy
 * @notice Mock contract for testing reentrancy attack protection
 * @dev Attempts to recursively call claimPayment() during payment claim
 */
contract MaliciousReentrancy {
    PaymentSettlement public settlement;
    bytes32 public targetBatchId;
    uint256 public attackCount;
    bool public attacking;

    constructor(address _settlement) {
        settlement = PaymentSettlement(_settlement);
    }

    /**
     * @notice Set the batch ID to attack
     */
    function setBatchId(bytes32 _batchId) external {
        targetBatchId = _batchId;
    }

    /**
     * @notice Initiate the reentrancy attack
     */
    function attack() external {
        attacking = true;
        attackCount = 0;
        settlement.claimPayment(targetBatchId);
    }

    /**
     * @notice Receive function - attempts reentrancy when receiving payment
     */
    receive() external payable {
        if (attacking && attackCount < 3) {
            attackCount++;
            // Try to re-enter claimPayment
            try settlement.claimPayment(targetBatchId) {
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
            try settlement.claimPayment(targetBatchId) {
                // Should fail
            } catch {
                // Expected
            }
        }
    }
}
