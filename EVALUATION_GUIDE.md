# TataPay - W3F M1 Evaluation Guide

**Version**: 1.0
**Date**: 2025-12-18
**Network**: Moonbase Alpha (Moonbeam Testnet)
**Purpose**: Complete testing guide for W3F Milestone 1 evaluation

This guide provides two testing paths:
1. **Option A**: Deploy fresh contracts and test (complete deployment walkthrough)
2. **Option B**: Use already-deployed contracts for quick validation

---

## Prerequisites

- Node.js v18+ and npm
- Git
- DEV tokens from [Moonbeam Faucet](https://faucet.moonbeam.network/)

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

## Option A: Fresh Deployment to Moonbase Alpha

### 1. Configure Test Accounts

Edit `.env` and add your private keys:
- `PRIVATE_KEY` - Deployer account
- `ORACLE1_PRIVATE_KEY` - Oracle account
- `MERCHANT1_PRIVATE_KEY` - Merchant account

You can use the existing test keys from `.env.example` or generate new ones.

### 2. Fund Accounts

Visit [Moonbeam Faucet](https://faucet.moonbeam.network/) and request DEV tokens for:
- Deployer address (~10 DEV for deployment)
- Oracle1 address (~1 DEV for transactions)
- Merchant1 address (~0.5 DEV for claims)

### 3. Deploy All Contracts

```bash
node scripts/deploy/deploy-all.js
```

This deploys all 6 contracts and outputs their addresses. Copy the addresses to your `.env` file.

### 4. Grant Oracle Role

```bash
node scripts/utils/grant-oracle-role.js
```

This grants `ORACLE_ROLE` to Oracle1 on PaymentSettlement.

### 5. Mint Test USDC

SimpleUSDC has a public `mint()` function. Call it via Hardhat console to mint 1,000,000 USDC to your deployer address.

```bash
npx hardhat console --network moonbase
# Then call mint() function on SimpleUSDC contract
```

### 6. Deposit Collateral

Use Hardhat console to:
1. Approve CollateralPool to spend USDC
2. Call `deposit()` to deposit 100,000 USDC

### 7. Run E2E Test

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

**Pre-deployed Contracts** (Moonbase Alpha):
- SimpleUSDC: `0x3ee3AcA42AC2D8194Ebb52eEAc4EFa44f0775603`
- CollateralPool: `0x1dADeb1b5A07582399D4DEcBac045A3b6a0D82E9`
- PaymentSettlement: `0xE596d1382cD7488eF8dB13B347bAdc6781110d30`
- FraudPrevention: `0xc08eCE74fAB86680f758Fa5E169E767E076a7b56`
- SettlementOracle: `0xdBa042E41871BBA66e290209Bff79a86CfB9a58e`
- TataPayGovernance: `0xA64e6ac9A8D6cbf2d239B9E00152812E0fEf7C2B`

### 2. Fund Your Test Accounts

Request DEV tokens from [Moonbeam Faucet](https://faucet.moonbeam.network/) for your test accounts.

### 3. Mint Test USDC

Call `mint()` on SimpleUSDC contract via Hardhat console to mint 1,000,000 USDC.

### 4. Deposit Collateral

Use Hardhat console to approve and deposit 100,000 USDC into CollateralPool.

### 5. Run E2E Test

```bash
node scripts/e2e/complete-flow.js
```

**Note**: For testing with our deployment, oracle role is already granted to our oracle address. You'll need to either use our oracle key or deploy your own contracts (Option A).

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
🎯 Complete E2E Flow - Moonbase Alpha

1️⃣  Checking collateral...
   Available: 100000 USDC

2️⃣  Creating payment batch...
   ✅ Batch created: 0x7a8b9c...
   Verified - Amount: 2000 USDC
   Verified - Status: 0 (Pending)

3️⃣  Oracle1 approving batch...
   Oracle1 has ORACLE_ROLE: true
   ✅ Batch approved!
   New status: 1 (Processing)

4️⃣  Merchant claiming payment...
   ✅ Payment claimed!
   Received: 2000 USDC ✅

5️⃣  Final status...
   Batch status: 2 (Settled)
   Claimed: 1/1

═══════════════════════════════════════
   TEST COMPLETE ✅
═══════════════════════════════════════
```

---

## Verification on Block Explorer

All transactions can be verified on [Moonbase Moonscan](https://moonbase.moonscan.io):

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

**Issue: "Insufficient balance"**
- Solution: Mint test USDC via Hardhat console

**Issue: "Oracle does not have ORACLE_ROLE"**
- Solution: Run `node scripts/utils/grant-oracle-role.js`

**Issue: "Batch not found"**
- Solution: Ensure you're using `batchId` extracted from `BatchCreated` event

**Issue: RPC timeout**
- Solution: Use UnitedBloc RPC in `.env`: `MOONBASE_RPC_URL=https://moonbase.unitedbloc.com`


**Built for Africa's financial inclusion**
