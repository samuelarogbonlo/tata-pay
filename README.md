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

## Quick Start

```bash
# Install
npm install

# Configure
cp .env.example .env
# Add your PRIVATE_KEY to .env

# Compile
npm run compile

# Test (160 tests)
npm test

# Deploy to Paseo testnet
npm run deploy:paseo
```

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
| `SettlementOracle` | Webhook auth, signature verification | 24 ✓ |
| `TataPayGovernance` | Multi-sig timelock governance | 32 ✓ |

## Key Commands

```bash
# Testing
npm test                      # All tests
npm run test:integration      # Integration tests only
npm run test:coverage         # Coverage report

# Compilation
npm run compile               # Compile to PVM bytecode
npm run compile:clean         # Clean + compile

# Deployment (Paseo)
npm run deploy:collateral     # Deploy CollateralPool
npm run deploy:fraud          # Deploy FraudPrevention
npm run deploy:settlement     # Deploy PaymentSettlement
npm run deploy:oracle         # Deploy SettlementOracle
npm run deploy:governance     # Deploy TataPayGovernance
npm run deploy:paseo          # Deploy all contracts
```

## Testnet Setup

1. Get PAS tokens: https://faucet.polkadot.io/?parachain=1111
2. Set `PRIVATE_KEY` in `.env`
3. Run `npm run deploy:paseo`

## Governance

3-of-5 multi-sig with timelock:
- **Standard proposals**: 48h delay
- **Emergency proposals**: 6h delay
- **Proposal lifetime**: 7 days
- Contract is self-governed (proposals required for all changes)

## License

MIT

---

**Built for Africa's financial inclusion**
