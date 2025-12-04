# Testing Guide

Comprehensive testing for Tata-Pay smart contracts on Polkadot Asset Hub.

## Quick Start

```bash
npm test                    # Run all 160 tests
npm run test:coverage       # Generate coverage report
```

## Test Coverage

| Contract | Tests | Key Features |
|----------|-------|--------------|
| CollateralPool | 29 | Deposits, withdrawals, locking, slashing |
| PaymentSettlement | 34 | Batch lifecycle, claims, timeouts |
| FraudPrevention | 41 | Velocity limits, blacklist/whitelist |
| SettlementOracle | 24 | Oracle registration, approvals |
| TataPayGovernance | 32 | Multi-sig, timelock, proposals |

**Total: 160 integration tests** • **100% critical path coverage**

## Key Scenarios Tested

### 1. Happy Path
Fintech deposits → creates batch → oracle approves → merchants claim → completed

### 2. Partial Claims
Some merchants claim, others timeout → unclaimed collateral returned

### 3. Fraud Prevention
Velocity limits enforced (hourly/daily transaction counts and amounts)

### 4. Batch Failure
Oracle/fraud system fails batch → collateral unlocked (minus claimed amounts)

### 5. Emergency Controls
Pause mechanism, emergency withdrawals, multi-sig governance

### 6. Oracle Integration
Role-based oracle approvals, multi-oracle threshold consensus

### 7. Timelock Governance
3-of-5 multi-sig, 48h standard delay, 6h emergency delay

## Test Each Deliverable

```bash
# Test individual contracts
npx hardhat test test/integration/CollateralPool.integration.test.js        # 29 tests
npx hardhat test test/integration/PaymentSettlement.integration.test.js     # 34 tests
npx hardhat test test/integration/FraudPrevention.integration.test.js       # 41 tests
npx hardhat test test/integration/SettlementOracle.integration.test.js      # 24 tests
npx hardhat test test/integration/TataPayGovernance.integration.test.js     # 32 tests

# Test specific features
npx hardhat test --grep "deposit"           # USDC collateral deposits
npx hardhat test --grep "withdrawal"        # Timelock withdrawals
npx hardhat test --grep "batch"             # Batch settlement
npx hardhat test --grep "claim"             # Merchant claims
npx hardhat test --grep "velocity"          # Fraud velocity limits
npx hardhat test --grep "blacklist"         # Blacklist/whitelist
npx hardhat test --grep "oracle"            # Oracle approvals
npx hardhat test --grep "multi-sig"         # Multi-sig governance
npx hardhat test --grep "timelock"          # Timelock delays
npx hardhat test --grep "pause"             # Emergency pause
```

## Edge Cases Covered

- Empty/oversized batches (0 merchants, >100 merchants)
- Insufficient collateral
- Double claim attempts
- Replay attack prevention
- Expired proposals
- Custom fraud limits per address
- Blacklist/whitelist interactions

## Test Duration

**~3 seconds** for all 160 tests (parallel execution with fixtures)

---

For deployment testing, see deployed contracts on Paseo Asset Hub testnet in [README.md](README.md).
