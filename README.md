# Tata-Pay

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Hardhat](https://img.shields.io/badge/Built%20with-Hardhat-FFDB1C.svg)](https://hardhat.org/)
[![Polkadot](https://img.shields.io/badge/Polkadot-Asset%20Hub-E6007A.svg)](https://polkadot.network/)

Blockchain payment settlement infrastructure for batch payments on Polkadot Asset Hub using USDC collateral.

## Features

- **USDC Collateral Pool**: Deposit/withdrawal management with emergency controls
- **Batch Settlement**: Process up to 100 merchant payments per batch
- **Fraud Prevention**: Velocity limits, blacklisting, whitelisting
- **Oracle Integration**: Webhook-based authorization with signature verification
- **Multi-Sig Governance**: 3-of-5 timelock governance (48h standard, 6h emergency)

## Tech Stack

- **Platform**: Moonbeam (EVM-compatible Polkadot parachain)
- **Language**: Solidity 0.8.28
- **Framework**: Hardhat with Web3.js
- **Security**: OpenZeppelin Contracts
- **Testnet**: Moonbase Alpha (Chain ID: 1287)
- **Slither**: Used 0.11.3 for security review

## Quick Start

**Setup:**
```bash
npm install
cp .env.example .env
# Fill in your private keys in .env
```

**Deploy Contracts:**
```bash
node scripts/deploy/deploy-all.js
```

**Run E2E Test:**
```bash
node scripts/e2e/complete-flow.js
```

**Note:** Requires DEV tokens (for gas) from [Moonbeam Faucet](https://faucet.moonbeam.network/) and test USDC (deployed via SimpleUSDC.sol).

**For detailed deployment and testing instructions**, see [EVALUATION_GUIDE.md](EVALUATION_GUIDE.md) - comprehensive guide covering fresh deployment, interaction with deployed contracts, and E2E acceptance criteria.

## Architecture

```
Fintechs → CollateralPool → PaymentSettlement
                                ↓
                    ┌───────────┴───────────┐
                    ▼                       ▼
            FraudPrevention          SettlementOracle
                    ↓                       ↓
                    └──→ TataPayGovernance ←┘
```

## Contracts

| Contract | Purpose | Tests |
|----------|---------|-------|
| `CollateralPool` | USDC deposits, withdrawals, locking | 29 ✓ |
| `PaymentSettlement` | Batch processing, merchant claims | 34 ✓ |
| `FraudPrevention` | Velocity limits, blacklisting | 41 ✓ |
| `SettlementOracle` | Webhook auth, role-based authorization | 16 ✓ |
| `TataPayGovernance` | Multi-sig timelock governance | 32 ✓ |

## Testing

See [TESTING_GUIDE.md](TESTING_GUIDE.md) for comprehensive testing documentation covering:
- Settlement scenarios (happy path, partial claims, timeouts)
- Edge cases (fraud limits, role-based oracle authorization, governance)
- 152 integration tests with 100% critical path coverage

**Note:** Mock contracts (`MockUSDC`, `SimpleUSDC`, `MaliciousReentrancy`) are used for testnet deployment and attack simulations. Production deployment will use real USDC (0x818ec0A7Fe18Ff94269904fCED6AE3DaE6d6dC0b on Moonbeam mainnet).

## Security

Comprehensive security validation completed for production readiness:

### Attack Simulations 
- **19 attack scenario tests** covering:
  - Reentrancy attacks (ReentrancyGuard validation)
  - Replay attacks (double-claim prevention)
  - Denial of Service (batch size limits, gas optimization)
  - Front-running protection (withdrawal delays, timelock)
  - Integer overflow/underflow (Solidity 0.8.x + SafeERC20)
  - Access control bypass (role-based permissions)
  - Edge cases (zero amounts, empty arrays, mismatched inputs)

### Security Features
- **ReentrancyGuard** on all payment functions
- **Emergency pause** mechanism in all contracts
- **Role-based access control** (OpenZeppelin AccessControl)
- **Fraud prevention** with velocity limits and blacklisting
- **Multi-sig governance** with timelock delays (48h standard, 6h emergency)
- **Oracle staking + slashing** for misbehavior prevention
- **Withdrawal delays** (24h) to prevent flash attacks
- **Batch size limits** (max 100 merchants) for gas safety

### Deployed Contracts (Moonbase Alpha Testnet)

**Status:** ✅ **LIVE ON MOONBASE ALPHA**

**Network Details:**
- **Network:** Moonbase Alpha Testnet
- **Chain ID:** 1287
- **RPC:** https://moonbase.unitedbloc.com
- **Explorer:** https://moonbase.moonscan.io
- **Faucet:** https://faucet.moonbeam.network/
- **Deployment Date:** December 18, 2025

**Contract Addresses:**

| Contract | Address | Explorer |
|----------|---------|----------|
| **SimpleUSDC** (Mock USDC) | `0x3ee3AcA42AC2D8194Ebb52eEAc4EFa44f0775603` | [View →](https://moonbase.moonscan.io/address/0x3ee3AcA42AC2D8194Ebb52eEAc4EFa44f0775603) |
| **CollateralPool** | `0x1dADeb1b5A07582399D4DEcBac045A3b6a0D82E9` | [View →](https://moonbase.moonscan.io/address/0x1dADeb1b5A07582399D4DEcBac045A3b6a0D82E9) |
| **PaymentSettlement** | `0xE596d1382cD7488eF8dB13B347bAdc6781110d30` | [View →](https://moonbase.moonscan.io/address/0xE596d1382cD7488eF8dB13B347bAdc6781110d30) |
| **FraudPrevention** | `0xc08eCE74fAB86680f758Fa5E169E767E076a7b56` | [View →](https://moonbase.moonscan.io/address/0xc08eCE74fAB86680f758Fa5E169E767E076a7b56) |
| **SettlementOracle** | `0xdBa042E41871BBA66e290209Bff79a86CfB9a58e` | [View →](https://moonbase.moonscan.io/address/0xdBa042E41871BBA66e290209Bff79a86CfB9a58e) |
| **TataPayGovernance** | `0xA64e6ac9A8D6cbf2d239B9E00152812E0fEf7C2B` | [View →](https://moonbase.moonscan.io/address/0xA64e6ac9A8D6cbf2d239B9E00152812E0fEf7C2B) |

**Deployment Notes:**
- Standard EVM deployment (no PolkaVM/Revive required)
- All inter-contract roles configured and verified
- Working E2E flow: deposit → batch → oracle approve → merchant claim → settle
- SimpleUSDC used for testnet; production will use real USDC on Moonbeam mainnet

## Governance

TataPayGovernance contract deployed with 3-of-5 multi-sig and timelock capabilities:
- **Standard proposals**: 48h delay
- **Emergency proposals**: 6h delay
- **Proposal lifetime**: 7 days
- **Testnet Status**: Governance contract is deployed and functional, but admin rights not transferred (single deployer for testing flexibility)
- **Mainnet Recommendation**: Transfer admin roles to multi-sig governance before production deployment

## License

MIT

---

**Built for Africa's financial inclusion**
