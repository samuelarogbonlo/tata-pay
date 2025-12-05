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

- **Platform**: Polkadot Asset Hub (PolkaVM)
- **Language**: Solidity 0.8.28 → PVM bytecode via Revive (resolc)
- **Framework**: Hardhat + @parity/hardhat-polkadot
- **Security**: OpenZeppelin Contracts
- **Testnet**: Paseo (Chain ID: 420420422)
= **Slither**: Used 0.11.3 for security review

## Quick Start

**Deploy Contracts:**
See [DEPLOYMENT_WALKTHROUGH.md](DEPLOYMENT_WALKTHROUGH.md) for step-by-step deployment instructions.

**Testnet Demo:**
```bash
npx hardhat run scripts/e2e/testnet-demo.js --network paseo
```
**Note:** Demo requires PAS tokens (for gas/stakes) and USDC tokens (for deposits). See [TESTNET_INTERACTION_GUIDE.md](TESTNET_INTERACTION_GUIDE.md) for prerequisites and troubleshooting.

**Verify Deployment:**
All contracts are already deployed and verified on Paseo. View on [BlockScout](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174).

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

**Note:** Mock contracts (`MockUSDC`, `MaliciousReentrancy`) are used exclusively for local testing and attack simulations; all deployed contracts use real Asset Hub USDC precompile (Asset ID 1337).

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

### Deployed Contracts (Paseo Testnet)

**Status:** ✅ **LIVE ON PASEO ASSET HUB**

**Network Details:**
- **Network:** Paseo Asset Hub Testnet
- **Chain ID:** 420420422
- **RPC:** https://testnet-passet-hub-eth-rpc.polkadot.io
- **Explorer:** https://blockscout-passet-hub.parity-testnet.parity.io
- **Deployer:** 0x270a96208850d6Ce32c4fDFe9CB161Dba36f02f9
- **Deployment Date:** December 4, 2025

**Contract Addresses:**

| Contract | Address | Explorer |
|----------|---------|----------|
| **CollateralPool** (UUPS Proxy) | [`0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9) |
| CollateralPool Implementation | [`0x88E313E743ef842dB30CFd65F86Fe564C18119D0`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x88E313E743ef842dB30CFd65F86Fe564C18119D0) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x88E313E743ef842dB30CFd65F86Fe564C18119D0) |
| **FraudPrevention** | [`0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f) |
| **PaymentSettlement** | [`0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174) |
| **SettlementOracle** | [`0xEB7278C528817fB51c1837Cb0666c02922d542F1`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xEB7278C528817fB51c1837Cb0666c02922d542F1) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xEB7278C528817fB51c1837Cb0666c02922d542F1) |
| **TataPayGovernance** | [`0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260`](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260) | [View →](https://blockscout-passet-hub.parity-testnet.parity.io/address/0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260) |

**Deployment Notes:**
- CollateralPool deployed via UUPS upgradeable proxy pattern
- All contracts compiled with `resolc` (Revive Solidity → PolkaVM compiler)
- SettlementOracle uses role-based oracle calls (ECDSA removed for PolkaVM compatibility)
- All inter-contract roles configured and verified
- Contracts successfully verified on BlockScout explorer

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
