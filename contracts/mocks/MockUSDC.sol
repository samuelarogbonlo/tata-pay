// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC contract for testing purposes
 * @dev Mimics Asset Hub USDC precompile (Asset ID 1337, 6 decimals)
 *
 * WARNING: This is for TESTING ONLY. Do NOT use in production.
 * Production code should use the actual Asset Hub USDC precompile at:
 * 0x0000053900000000000000000000000000000000
 */
contract MockUSDC is ERC20, Ownable {
    uint8 private immutable _decimals;

    /**
     * @notice Deploy mock USDC with configurable decimals
     * @param name Token name
     * @param symbol Token symbol
     * @param decimals_ Token decimals (6 for USDC)
     */
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20(name, symbol) Ownable(msg.sender) {
        _decimals = decimals_;
    }

    /**
     * @notice Override decimals to match USDC (6 decimals)
     */
    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint tokens for testing
     * @param to Recipient address
     * @param amount Amount to mint
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens for testing
     * @param from Address to burn from
     * @param amount Amount to burn
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
