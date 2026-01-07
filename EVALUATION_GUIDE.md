# TataPay - W3F M1 Evaluation Guide

**Version**: 2.0
**Date**: 2026-01-07
**Network**: Paseo Asset Hub (Polkadot Testnet)
**Purpose**: Complete testing guide for W3F Milestone 1 evaluation

This guide provides two testing paths:
1. **Option A**: Deploy fresh contracts and test (complete deployment walkthrough)
2. **Option B**: Use already-deployed contracts for quick validation

---

## Prerequisites

- Node.js v18+ and npm
- Git
- PAS tokens from [Polkadot Faucet](https://faucet.polkadot.io/?parachain=1111)
- **IMPORTANT**: Asset Hub requires 1000 gwei gas price!

---

## Setup

```bash
# Clone and install
git clone <repository-url>
cd Tata-Pay
npm install

# Configure environment
cp .env.example .env
# Edit .env and add your private keys
```

---

## Option A: Fresh Deployment to Paseo Asset Hub

### 1. Configure Test Accounts

Edit `.env` and add your private keys:
- `PRIVATE_KEY` - Deployer account
- `ORACLE1_PRIVATE_KEY` - Oracle account
- `MERCHANT1_PRIVATE_KEY` - Merchant account

You can use the existing test keys from `.env.example` or generate new ones.

### 2. Fund Accounts

Visit [Polkadot Faucet](https://faucet.polkadot.io/?parachain=1111) and request PAS tokens for:
- Deployer address (~5000 PAS for deployment with 1000 gwei gas)
- Oracle1 address (~500 PAS for transactions)
- Merchant1 address (~100 PAS for claims)

**Note**: Asset Hub requires high gas prices. With 1000 gwei, deployment is more expensive than standard EVM chains.

### 3. Deploy All Contracts

```bash
node scripts/deploy/deploy-all.js
```

This deploys all 6 contracts and outputs their addresses. The addresses are automatically used from `config/networks.js`.

### 4. Setup Deployment (Grant Roles + Mint USDC + Deposit Collateral)

```bash
node scripts/utils/setup-fresh-deployment.js
```

This script:
- Grants `ORACLE_ROLE` to Oracle1 on PaymentSettlement
- Mints 1,000,000 USDC to deployer
- Deposits 100,000 USDC as collateral

### 5. Run E2E Test

```bash
node scripts/e2e/complete-flow.js
```

Expected result: Complete flow from batch creation → oracle approval → merchant claim → settlement.

---

## Option B: Test with Already-Deployed Contracts

### 1. Use Existing Deployment

Copy `.env.example` to `.env` (contains our deployed addresses):

```bash
cp .env.example .env
```

Add your test private keys to `.env`.

**Pre-deployed Contracts** (Paseo Asset Hub):
- SimpleUSDC: `0xd1bBE61C683B339dE9733b928616C1594e770A3c`
- CollateralPool: `0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc`
- PaymentSettlement: `0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF`
- FraudPrevention: `0x3F21Eb25bf4dBeC4cAfBD51fb0b5fD9685e66610`
- SettlementOracle: `0x94F205EAB260d227Cb8591082125144bA76E6d6A`
- TataPayGovernance: `0xb9A64476CFCD47127d80C6056E7F09D9E9A8BD11`

Block Explorer: https://blockscout-passet-hub.parity-testnet.parity.io

### 2. Fund Your Test Accounts

Request PAS tokens from [Polkadot Faucet](https://faucet.polkadot.io/?parachain=1111) for your test accounts.

### 3. Setup and Run E2E Test

The setup script handles everything (minting USDC, depositing collateral, granting roles):

```bash
node scripts/utils/setup-fresh-deployment.js
node scripts/e2e/complete-flow.js
```

**Note**: The setup script uses the deployed contract addresses from `.env` and sets up everything automatically.

---

## E2E Acceptance Criteria

The `complete-flow.js` script demonstrates the complete TataPay payment settlement lifecycle:

```
Fintech deposits collateral → Creates batch → Oracle approves → Merchant claims → Batch settles
```

### What Each Step Validates

**1. Collateral Management**
- Fintech deposits 100,000 USDC into CollateralPool
- `CollateralDeposited` event emitted
- Balance tracking updated correctly
- Proves: Secure collateral backing for payments

**2. Batch Creation**
- Fintech creates payment batch for 1 merchant (2,000 USDC)
- `BatchCreated` event emitted with unique `batchId`
- Collateral locked atomically
- Proves: Batch ID generation, collateral locking, multi-merchant support

**3. Oracle Approval**
- Oracle validates and approves the batch
- `BatchApproved` event emitted
- Batch status changes to Processing
- Proves: Role-based access control, oracle authorization layer

**4. Merchant Claim**
- Merchant claims payment from approved batch
- `PaymentClaimed` event emitted
- USDC transferred to merchant
- Proves: Pull payment pattern, double-claim prevention

**5. Batch Settlement**
- System automatically settles batch when all merchants claim
- Batch status changes to Settled
- Locked collateral released
- Proves: Complete lifecycle, deterministic state transitions

### Security Features Demonstrated

1. **Reentrancy Protection** - All payment functions use ReentrancyGuard
2. **Access Control** - Oracle approval requires ORACLE_ROLE
3. **Collateral Locking** - Funds locked atomically during batch creation
4. **Double-Claim Prevention** - Merchants can't claim same payment twice
5. **Event Traceability** - All state changes emit events

### Expected Console Output

```
🎯 Complete E2E Flow - Paseo Asset Hub

Accounts:
  Fintech:   0x270a96208850d6Ce32c4fDFe9CB161Dba36f02f9
  Oracle1:   0x3b5C2bDd1D8251C38F80C4EdE9fbD1680a66Db1c
  Merchant1: 0xe5e740A8672db5636Ec8255C6047b0D6f23F99f8

1️⃣  Checking collateral...
   Available: 100000.0 USDC
   Locked: 0.0 USDC

2️⃣  Creating payment batch...
   ✅ Batch created: 0xdd235b8e...
   Tx: 0xe21c5290...

3️⃣  Oracle1 approving batch...
   Oracle1 has ORACLE_ROLE: true
   ✅ Batch approved!
   Tx: 0x2db995e3...

4️⃣  Merchant claiming payment...
   Merchant balance before: 0.0 USDC
   ✅ Payment claimed!
   Tx: 0xcaba99bd...
   Merchant balance after: 2000.0 USDC
   Received: 2000.0 USDC ✅

5️⃣  Final status...
   Batch status: Settled
   Total amount: 2000.0 USDC

═══════════════════════════════════════
   E2E TEST COMPLETE ✅
═══════════════════════════════════════
```

---

## Verification on Block Explorer

All transactions can be verified on [Paseo Asset Hub Blockscout](https://blockscout-passet-hub.parity-testnet.parity.io):

---

## Local Testing (Optional)

For comprehensive security validation, run the full test suite:

```bash
npm test
```

This runs **152 integration tests** covering:
- Collateral management (29 tests)
- Payment settlement (34 tests)
- Fraud prevention (41 tests)
- Oracle registration/slashing (16 tests)
- Governance timelock (32 tests)

---

## Troubleshooting

**Issue: "Error 1010: Invalid Transaction"**
- **Solution**: Asset Hub requires **1000 gwei gas price**. This is already configured in `hardhat.config.js` and `config/networks.js`. If using custom scripts, ensure you set: `gasPrice: ethers.parseUnits('1000', 'gwei')`

**Issue: "Insufficient balance"**
- Solution: Run the setup script: `node scripts/utils/setup-fresh-deployment.js`

**Issue: "Oracle does not have ORACLE_ROLE"**
- Solution: The setup script grants this role automatically. If needed manually: check contract addresses in `.env`

**Issue: "Batch not found"**
- Solution: Ensure you're using `batchId` extracted from `BatchCreated` event

**Issue: RPC timeout or instability**
- Solution: The official Parity RPC is stable. If issues persist, check [Polkadot Forum](https://forum.polkadot.network/) for alternative endpoints


**Built for Africa's financial inclusion**
