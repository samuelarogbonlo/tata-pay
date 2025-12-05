# Deployment Walkthrough

Step-by-step guide to deploy Tata-Pay contracts to Paseo Asset Hub.

## Prerequisites

1. **Get Testnet Tokens**
   ```
   Faucet: https://faucet.polkadot.io/?parachain=1111
   Select: "Passet Hub: Smart Contracts"
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env and add:
   PRIVATE_KEY=0x...  # Your deployer private key
   PASEO_RPC_URL=https://testnet-passet-hub-eth-rpc.polkadot.io
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Apply micro-eth-signer Patch** (for deployment only)

   PolkaVM requires 1MB initcode limit vs Ethereum's 128KB. See [docs/DEPLOYMENT_NOTES.md](docs/DEPLOYMENT_NOTES.md) for patch details.

   **Note:** Contracts are already deployed. This is only needed to reproduce deployment from scratch.

## Deployment Steps

### 1. Compile Contracts
```bash
npx hardhat compile
```

### 2. Deploy Contracts (in order)

**Note:** USDC is a precompile (Asset ID 1337) at `0x0000053900000000000000000000000000000000`, no deployment needed.

```bash
# Deploy core contracts in order
npx hardhat run scripts/deploy/02-deploy-collateral-pool.js --network paseo
npx hardhat run scripts/deploy/03-deploy-payment-settlement.js --network paseo
npx hardhat run scripts/deploy/04-deploy-fraud-prevention.js --network paseo
npx hardhat run scripts/deploy/05-deploy-settlement-oracle.js --network paseo
npx hardhat run scripts/deploy/06-deploy-governance.js --network paseo
```

**Expected Output:**
```
CollateralPool Proxy deployed to: 0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9
PaymentSettlement deployed to: 0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174
FraudPrevention deployed to: 0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f
SettlementOracle deployed to: 0xEB7278C528817fB51c1837Cb0666c02922d542F1
TataPayGovernance deployed to: 0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260
```

### 3. Configure Inter-Contract Roles (Required)
```bash
# Grant SETTLEMENT_ROLE, ORACLE_ROLE, FRAUD_ROLE, SLASHER_ROLE
npx hardhat run scripts/setup/configure-roles.js --network paseo
```

**What it does:**
- Grants `SETTLEMENT_ROLE` to PaymentSettlement on CollateralPool
- Grants `ORACLE_ROLE` to SettlementOracle on PaymentSettlement
- Grants `FRAUD_ROLE` and `SLASHER_ROLE` to FraudPrevention

**Note:** Without this step, contracts cannot interact (batches cannot lock collateral, oracles cannot approve batches, etc.)

### 4. Verify on BlockScout
```
Explorer: https://blockscout-passet-hub.parity-testnet.parity.io
Paste contract addresses to verify deployment
```

## Deployed Addresses (Paseo Testnet)

| Contract | Address |
|----------|---------|
| CollateralPool | `0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9` |
| PaymentSettlement | `0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174` |
| FraudPrevention | `0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f` |
| SettlementOracle | `0xEB7278C528817fB51c1837Cb0666c02922d542F1` |
| TataPayGovernance | `0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260` |
| USDC Precompile | `0x0000053900000000000000000000000000000000` |

## Next Steps

See [TESTNET_INTERACTION_GUIDE.md](TESTNET_INTERACTION_GUIDE.md) for how to interact with deployed contracts.
