# Testnet Interaction Guide

Automated E2E demo script for interacting with deployed Tata-Pay contracts on Paseo testnet.

## Quick Start: Run E2E Demo

**Prerequisites:**

1. **Contracts deployed** - Already deployed to Paseo (addresses below). To redeploy, see [DEPLOYMENT_WALKTHROUGH.md](DEPLOYMENT_WALKTHROUGH.md)
2. **Roles configured** - Already configured on deployed contracts. To verify: `npx hardhat run scripts/setup/configure-roles.js --network paseo`
3. **Oracle accounts funded** - The script uses Hardhat's default signers (accounts 0-5). Ensure oracle accounts (signers 1-2) have at least 2 PAS each:
   - For gas fees (~0.5 PAS per transaction)
   - For oracle stake (1 PAS minimum per oracle)
   - Get PAS from [Paseo Faucet](https://faucet.polkadot.io/?parachain=1111)
4. **Fintech has USDC** - Signer 0 (fintech) needs USDC tokens (Asset ID 1337) for deposits. Options:
   - Use an account that already has testnet USDC
   - Mint USDC if you have admin/sudo access to Asset 1337
   - Modify script to use smaller amounts if limited USDC available

```bash
# Run automated end-to-end demo
npx hardhat run scripts/e2e/testnet-demo.js --network paseo
```

**Expected Output:**
```
✓ Step 0: Register oracles (if not already registered)
✓ Step 1: Fintech deposits 5000 USDC collateral
✓ Step 2: Fintech creates batch for 3 merchants (1500 USDC)
✓ Step 3: Oracle 1 approves batch
✓ Step 4: Oracle 2 approves batch (threshold reached)
✓ Step 5: Merchant 1 claims 500 USDC
✓ Demo completed successfully!
```

## Acceptance Criteria

**Successful Demo Completion Requires:**

✅ **Events Emitted:**
- `CollateralDeposited(fintech, 5000 USDC)`
- `BatchCreated(batchId, fintech, totalAmount)`
- `BatchApproved(batchId, oracle1)` (from SettlementOracle)
- `BatchApproved(batchId, oracle2)` (from SettlementOracle)
- `BatchApproved(batchId)` (from PaymentSettlement when threshold reached)
- `PaymentClaimed(batchId, merchant, amount)`

✅ **State Changes:**
- CollateralPool: Fintech has 5000 USDC deposited, 1500 USDC locked
- PaymentSettlement: Batch status = `Processing` (enum value 1) after threshold
- SettlementOracle: `batchApprovalCount[batchId]` = 2
- Merchant balances: Merchant 1 receives 500 USDC

✅ **No Reverts:** All transactions succeed

## Deployed Contract Addresses

| Contract | Address |
|----------|---------|
| CollateralPool | `0xB4dAbce9bd76355B80D7FcB86C084d710838c8d9` |
| PaymentSettlement | `0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174` |
| FraudPrevention | `0xC377f75e93cbE9872fAc18B34Dd9310f65B0492f` |
| SettlementOracle | `0xEB7278C528817fB51c1837Cb0666c02922d542F1` |
| TataPayGovernance | `0xEbCd6af8835513B78AF0567f0Ae61d4766ea3260` |
| USDC | `0x0000053900000000000000000000000000000000` |

## BlockScout Explorer

View transactions and contract state:
```
https://blockscout-passet-hub.parity-testnet.parity.io
```

## Troubleshooting

**Issue: "Insufficient USDC balance" or "Transfer amount exceeds balance"**
- **Cause:** Test accounts don't have USDC tokens
- **Solution:** You need an account with testnet USDC (Asset ID 1337) or admin access to mint tokens

**Issue: "Not registered oracle" or "Not active oracle"**
- **Cause:** Oracles need to be registered with stake before approving
- **Solution:** The demo script auto-registers oracles with 1 PAS stake. Ensure oracle accounts have enough PAS

**Issue: "Transaction reverted"**
- Check: Ensure sufficient PAS balance for gas fees (get from faucet)
- Check: Ensure sufficient PAS for oracle stakes (1 PAS minimum per oracle)
- Check: USDC allowance approved before deposits
- Check: Contract is not paused

**Issue: "Insufficient funds for gas + value"**
- **Cause:** Account doesn't have enough PAS for transaction gas + oracle stake
- **Solution:** Get more PAS from https://faucet.polkadot.io/?parachain=1111

## Alternative: Verify Without Running Demo

If you don't have USDC tokens or want to skip funding oracle accounts:

1. **Run local tests** - `npm test` (171 passing tests, no testnet needed)
2. **View deployed contracts** - Browse on [BlockScout](https://blockscout-passet-hub.parity-testnet.parity.io/address/0x414F5e5747a1b3f67cC27E3b5e9432beaeBE4174)
3. **Check role configuration** - `npx hardhat run scripts/setup/configure-roles.js --network paseo` (will show ✅ if already configured)
4. **Read contract state** - Use Hardhat console to query without transactions:
   ```bash
   npx hardhat console --network paseo
   > const oracle = await ethers.getContractAt("SettlementOracle", "0xEB7278C528817fB51c1837Cb0666c02922d542F1")
   > await oracle.approvalThreshold()
   ```

The demo script validates the complete flow, but is not required for milestone evaluation since all contracts are deployed, tested (171 passing), and verified on-chain.
