// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockTarget
 * @notice Mock contract for testing governance proposals
 */
contract MockTarget {
    uint256 public value;

    event ValueSet(uint256 newValue);

    function setValue(uint256 newValue) external {
        value = newValue;
        emit ValueSet(newValue);
    }

    function failingFunction() external pure {
        revert("Intentional failure");
    }
}
