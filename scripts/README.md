# TataPay Deployment and Testing Scripts

## Overview

This directory contains deployment and testing scripts for the TataPay Milestone 1 architecture, which includes:

- **TransactionRegistry**: Immutable audit trail for domestic transactions (proof only, no value)
- **CrossBorderSettlement**: USDC escrow for cross-border payments with oracle confirmation
- **SettlementOracle**: Oracle service for confirming/failing cross-border payments
- **FraudPrevention**: Fraud detection and prevention system
- **TataPayGovernance**: Multi-sig governance for protocol changes

## Directory Structure

```
scripts/
├── deploy/
│   └── deploy-all.js         # Main deployment script for all contracts
├── e2e/
│   ├── complete-flow.js      # Full E2E test (domestic + cross-border)
│   └── test-refund-flow.js   # Refund scenarios test
└── utils/
    ├── setup-roles.js         # Post-deployment role configuration
    └── update-addresses.js    # Update addresses in scripts after deployment
```

## Deployment Process

### 1. Deploy All Contracts

```bash
npm run deploy:paseo
# or
node scripts/deploy/deploy-all.js
```

This deploys contracts in the following order:
1. SimpleUSDC (mock token)
2. TransactionRegistry
3. CrossBorderSettlement (with Yara settlement address)
4. FraudPrevention
5. SettlementOracle (pointing to CrossBorderSettlement)
6. TataPayGovernance

The script automatically:
- Sets up initial roles
- Updates addresses in e2e test scripts
- Creates a deployment record in `deployments/paseo-latest.json`
- Updates `.env` with contract addresses

### 2. Setup Additional Roles (Optional)

```bash
node scripts/utils/setup-roles.js
```

Configure additional roles by setting environment variables:
- `RECORDER_ADDRESS`: Address for recording domestic transactions
- `ORACLE_ADDRESS`: Address for oracle operations
- `DISPUTE_HANDLER_ADDRESS`: Address for handling disputes
- `EMERGENCY_ADMIN_ADDRESS`: Address for emergency operations

### 3. Run E2E Tests

#### Complete Flow Test
Tests both domestic and cross-border flows:
```bash
node scripts/e2e/complete-flow.js
```

This tests:
- Recording domestic transaction in TransactionRegistry
- Querying transaction proof
- Initiating cross-border payment (USDC escrow)
- Oracle confirmation
- Settlement to Yara address

#### Refund Flow Test
Tests refund scenarios:
```bash
node scripts/e2e/test-refund-flow.js
```

This tests:
- Oracle-initiated refund (payment failed)
- Timeout refund (after 48 hours)
- Fund recovery to original sender

## Architecture Changes (Milestone 1 Revision)

### Removed Contracts
- **CollateralPool**: No longer needed (replaced by direct USDC escrow)
- **PaymentSettlement**: Split into TransactionRegistry and CrossBorderSettlement

### New Contracts
- **TransactionRegistry**: Records domestic transaction proofs on-chain
- **CrossBorderSettlement**: Manages USDC escrow for cross-border payments

### Key Security Features

#### Circle Refund Protocol
CrossBorderSettlement implements the Circle Refund Protocol pattern:
- Oracle can ONLY confirm payment to pre-specified Yara address
- Refunds ONLY go back to original sender
- Compromised oracle cannot redirect funds to arbitrary addresses

#### Dual-Mode Architecture
- **Domestic**: Off-chain settlement, on-chain proof (TransactionRegistry)
- **Cross-border**: On-chain USDC escrow with oracle confirmation (CrossBorderSettlement)

## Environment Variables

Required in `.env`:
```bash
# Deployment
PRIVATE_KEY=your_private_key
RPC_URL=https://testnet-passet-hub-eth-rpc.polkadot.io

# Test Accounts (optional)
ORACLE1_PRIVATE_KEY=oracle_private_key
MERCHANT1_PRIVATE_KEY=merchant_private_key

# Contract Addresses (auto-filled by deploy-all.js)
MOCK_USDC_ADDRESS=0x...
TRANSACTION_REGISTRY_ADDRESS=0x...
CROSS_BORDER_SETTLEMENT_ADDRESS=0x...
FRAUD_PREVENTION_ADDRESS=0x...
SETTLEMENT_ORACLE_ADDRESS=0x...
TATAPAY_GOVERNANCE_ADDRESS=0x...
YARA_SETTLEMENT_ADDRESS=0x...
```

## Gas Configuration

All scripts use the required gas price for Paseo Asset Hub:
- Gas Price: 1000 gwei (required by Asset Hub)
- Gas limits are set appropriately for each operation

## Troubleshooting

### Deployment Issues
- Ensure you have sufficient PAS tokens for gas
- Check that your private key is correctly set in `.env`
- Verify RPC endpoint is accessible

### Role Setup Issues
- Ensure the admin account has DEFAULT_ADMIN_ROLE
- Check that contract addresses are correct in `.env`

### E2E Test Issues
- Update addresses after deployment using `update-addresses.js`
- Ensure test accounts have USDC tokens
- For oracle tests, ensure oracle is registered with stake

## Manual Address Update

If automatic address update fails:
```bash
node scripts/utils/update-addresses.js '{"usdc": "0x...", "transactionRegistry": "0x...", ...}'
```

## Block Explorer

View deployed contracts on Paseo Asset Hub:
```
https://blockscout-passet-hub.parity-testnet.parity.io/address/{CONTRACT_ADDRESS}
```