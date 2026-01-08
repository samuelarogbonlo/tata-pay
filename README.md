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

- **Platform**: Polkadot Asset Hub (EVM-compatible via pallet_revive)
- **Language**: Solidity 0.8.28
- **Framework**: Hardhat with ethers.js
- **Security**: OpenZeppelin Contracts
- **Testnet**: Paseo Asset Hub (Chain ID: 420420422)
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

**Note:** Requires PAS tokens (for gas) from [Polkadot Faucet](https://faucet.polkadot.io/?parachain=1111) and test USDC (deployed via SimpleUSDC.sol). **IMPORTANT:** Asset Hub requires 1000 gwei gas price.

**For detailed deployment and testing instructions**, see [EVALUATION_GUIDE.md](EVALUATION_GUIDE.md) - comprehensive guide covering fresh deployment, interaction with deployed contracts, and E2E testing.

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

**Note:** Mock contracts (`MockUSDC`, `SimpleUSDC`, `MaliciousReentrancy`) are used for testnet deployment and attack simulations. Production deployment will use real USDC (Asset ID 1337 on Polkadot Asset Hub mainnet, precompile address: 0xFFFFFFFF00000539).

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

### Deployed Contracts (Paseo Asset Hub Testnet)

**Status:** ✅ **LIVE ON PASEO ASSET HUB**

**Network Details:**
- **Network:** Paseo Asset Hub Testnet
- **Chain ID:** 420420422
- **RPC:** https://testnet-passet-hub-eth-rpc.polkadot.io
- **Explorer:** https://blockscout-passet-hub.parity-testnet.parity.io
- **Faucet:** https://faucet.polkadot.io/?parachain=1111
- **Deployment Date:** January 7, 2026
- **Gas Price:** 1000 gwei (REQUIRED!)

**Contract Addresses:**

| Contract | Address | Explorer |
|----------|---------|----------|
| **SimpleUSDC** (Mock USDC) | `0xd1bBE61C683B339dE9733b928616C1594e770A3c` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xd1bBE61C683B339dE9733b928616C1594e770A3c) |
| **CollateralPool** | `0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc) |
| **PaymentSettlement** | `0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF) |
| **FraudPrevention** | `0x3F21Eb25bf4dBeC4cAfBD51fb0b5fD9685e66610` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x3F21Eb25bf4dBeC4cAfBD51fb0b5fD9685e66610) |
| **SettlementOracle** | `0x94F205EAB260d227Cb8591082125144bA76E6d6A` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x94F205EAB260d227Cb8591082125144bA76E6d6A) |
| **TataPayGovernance** | `0xb9A64476CFCD47127d80C6056E7F09D9E9A8BD11` | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xb9A64476CFCD47127d80C6056E7F09D9E9A8BD11) |

**Deployment Notes:**
- Deployed via pallet_revive (Asset Hub's EVM compatibility layer)
- All inter-contract roles configured and verified
- Working E2E flow: deposit → batch → oracle approve → merchant claim → settle
- SimpleUSDC used for testnet; production will use native USDC (Asset ID 1337)
- **Critical:** Must use 1000 gwei gas price for all transactions

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
