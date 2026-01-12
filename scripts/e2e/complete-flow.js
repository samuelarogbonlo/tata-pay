const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const provider = new ethers.JsonRpcProvider("https://testnet-passet-hub-eth-rpc.polkadot.io");
  const fintech = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const oracle1 = new ethers.Wallet(process.env.ORACLE1_PRIVATE_KEY, provider);
  const merchant1 = new ethers.Wallet(process.env.MERCHANT1_PRIVATE_KEY, provider);

  console.log("\n🎯 Complete E2E Flow - Paseo Asset Hub\n");

  console.log("Accounts:");
  console.log("  Fintech:  ", fintech.address);
  console.log("  Oracle1:  ", oracle1.address);
  console.log("  Merchant1:", merchant1.address);

  // Gas configuration for Asset Hub
  const gasPrice = ethers.parseUnits('1000', 'gwei');
  const gasConfig = { gasPrice };

  // Contract addresses (these will be updated after deployment)
  const addresses = {
    usdc: "0xeE25c23a06265fb5f82538EC93F6C6Aaf105A959", // Update after deployment
    transactionRegistry: "0xE9af506bFED5Bb5Eb269734e45440D23C5880ED4", // Update after deployment
    crossBorderSettlement: "0xb1620a9f5FC8DffA3b7807267c4A9214bEA4C542", // Update after deployment
    settlementOracle: "0x793D048B0Ce537739204768CCA37c339D988A5C8", // Update after deployment
  };

  console.log("\n📋 Contracts:");
  console.log("  USDC:                   ", addresses.usdc);
  console.log("  TransactionRegistry:    ", addresses.transactionRegistry);
  console.log("  CrossBorderSettlement:  ", addresses.crossBorderSettlement);
  console.log("  SettlementOracle:       ", addresses.settlementOracle);

  // Load contracts
  const SimpleUSDC = require("../../artifacts/contracts/mocks/SimpleUSDC.sol/SimpleUSDC.json");
  const TransactionRegistry = require("../../artifacts/contracts/core/TransactionRegistry.sol/TransactionRegistry.json");
  const CrossBorderSettlement = require("../../artifacts/contracts/core/CrossBorderSettlement.sol/CrossBorderSettlement.json");
  const SettlementOracle = require("../../artifacts/contracts/core/SettlementOracle.sol/SettlementOracle.json");

  const usdc = new ethers.Contract(addresses.usdc, SimpleUSDC.abi, fintech);
  const registry = new ethers.Contract(addresses.transactionRegistry, TransactionRegistry.abi, fintech);
  const settlement = new ethers.Contract(addresses.crossBorderSettlement, CrossBorderSettlement.abi, fintech);
  const oracle = new ethers.Contract(addresses.settlementOracle, SettlementOracle.abi, oracle1);

  // ============== PART 1: DOMESTIC TRANSACTION FLOW ==============
  console.log("\n═══════════════════════════════════════");
  console.log("   DOMESTIC TRANSACTION FLOW");
  console.log("═══════════════════════════════════════");

  // 1. Record domestic transaction
  console.log("\n1️⃣  Recording domestic transaction in TransactionRegistry...");

  const txId = ethers.keccak256(ethers.toUtf8Bytes(`tx-${Date.now()}`));
  const domesticAmount = ethers.parseUnits("50000", 0); // 50,000 NGN in kobo (minor units)
  const currency = "NGN";
  const externalRef = "PAYSTACK-12345";

  const tx1 = await registry.recordTransaction(
    txId,
    merchant1.address,
    domesticAmount,
    currency,
    externalRef,
    { ...gasConfig, gasLimit: 300000 }
  );
  const receipt1 = await tx1.wait();
  console.log("   ✅ Transaction recorded!");
  console.log("   Transaction ID:", txId);
  console.log("   Merchant:", merchant1.address);
  console.log("   Amount:", ethers.formatUnits(domesticAmount, 2), currency);
  console.log("   Tx:", receipt1.hash);

  // 2. Query transaction proof
  console.log("\n2️⃣  Querying transaction proof...");
  const txData = await registry.transactions(txId);
  console.log("   Block Number:", txData.blockNumber.toString());
  console.log("   Timestamp:", new Date(Number(txData.createdAt) * 1000).toISOString());
  console.log("   Status:", ["Pending", "Confirmed", "Disputed", "Resolved"][txData.status]);

  // ============== PART 2: CROSS-BORDER SETTLEMENT FLOW ==============
  console.log("\n═══════════════════════════════════════");
  console.log("   CROSS-BORDER SETTLEMENT FLOW");
  console.log("═══════════════════════════════════════");

  // 3. Check USDC balance
  console.log("\n3️⃣  Checking USDC balances...");
  const fintechBalance = await usdc.balanceOf(fintech.address);
  const settlementBalance = await usdc.balanceOf(addresses.crossBorderSettlement);
  console.log("   Fintech USDC:", ethers.formatUnits(fintechBalance, 6));
  console.log("   Settlement Contract USDC:", ethers.formatUnits(settlementBalance, 6));

  // 4. Approve USDC for cross-border payment
  console.log("\n4️⃣  Approving USDC for cross-border payment...");
  const crossBorderAmount = ethers.parseUnits("100", 6); // 100 USDC
  const approveTx = await usdc.approve(addresses.crossBorderSettlement, crossBorderAmount, { ...gasConfig, gasLimit: 100000 });
  await approveTx.wait();
  console.log("   ✅ Approved", ethers.formatUnits(crossBorderAmount, 6), "USDC");

  // 5. Initiate cross-border payment
  console.log("\n5️⃣  Initiating cross-border payment...");
  const paymentId = ethers.keccak256(ethers.toUtf8Bytes(`payment-${Date.now()}`));
  const targetCurrency = "GHS"; // Ghana Cedis
  const targetBankHash = ethers.keccak256(ethers.toUtf8Bytes("Bank: Stanbic, Account: 1234567890"));

  const tx2 = await settlement.initiatePayment(
    paymentId,
    merchant1.address, // recipient
    crossBorderAmount,
    targetCurrency,
    targetBankHash,
    { ...gasConfig, gasLimit: 400000 }
  );
  const receipt2 = await tx2.wait();
  console.log("   ✅ Payment initiated!");
  console.log("   Payment ID:", paymentId);
  console.log("   Amount:", ethers.formatUnits(crossBorderAmount, 6), "USDC →", targetCurrency);
  console.log("   Tx:", receipt2.hash);

  // 6. Check escrow status
  console.log("\n6️⃣  Checking escrow status...");
  const payment = await settlement.payments(paymentId);
  const statusNames = ["Pending", "Locked", "Confirmed", "Failed", "Refunded", "TimedOut"];
  console.log("   Status:", statusNames[payment.status]);
  console.log("   USDC in escrow:", ethers.formatUnits(payment.usdcAmount, 6));
  console.log("   Expires at:", new Date(Number(payment.expiresAt) * 1000).toISOString());

  // 7. Oracle confirms payment (simulating Yara API confirmation)
  console.log("\n7️⃣  Oracle confirming payment (simulating Yara payout)...");

  // First register oracle if not already registered (fintech/admin calls this)
  try {
    const oracleAsAdmin = new ethers.Contract(addresses.settlementOracle, SettlementOracle.abi, fintech);
    const oracleInfo = await oracleAsAdmin.oracles(oracle1.address);
    if (!oracleInfo.isRegistered) {
      console.log("   Registering oracle first...");
      // Stake is in native tokens (PAS), sent as msg.value
      const stakeAmount = await oracleAsAdmin.minimumStake();
      console.log("   Minimum stake:", ethers.formatEther(stakeAmount), "PAS");

      // Admin (fintech) has ORACLE_MANAGER_ROLE and registers the oracle
      await (await oracleAsAdmin.registerOracle(oracle1.address, {
        ...gasConfig,
        gasLimit: 500000,
        value: stakeAmount
      })).wait();
      console.log("   ✅ Oracle registered with", ethers.formatEther(stakeAmount), "PAS stake");
    } else {
      console.log("   Oracle already registered");
    }
  } catch (e) {
    console.log("   ⚠️  Oracle registration failed:", e.message?.slice(0, 100));
  }

  const yaraReference = "YARA-PAY-67890";
  const confirmTx = await oracle.confirmPayment(paymentId, yaraReference, { ...gasConfig, gasLimit: 300000 });
  const confirmReceipt = await confirmTx.wait();
  console.log("   ✅ Payment confirmed!");
  console.log("   Yara Reference:", yaraReference);
  console.log("   Tx:", confirmReceipt.hash);

  // 8. Check final status
  console.log("\n8️⃣  Checking final settlement status...");
  const finalPayment = await settlement.payments(paymentId);
  console.log("   Status:", statusNames[finalPayment.status]);
  console.log("   Yara Reference:", finalPayment.yaraReference || "N/A");

  const yaraBalance = await usdc.balanceOf(await settlement.yaraSettlementAddress());
  console.log("   Yara Settlement Address Balance:", ethers.formatUnits(yaraBalance, 6), "USDC");

  const totalSettled = await settlement.totalSettled();
  console.log("   Total USDC Settled:", ethers.formatUnits(totalSettled, 6));

  console.log("\n═══════════════════════════════════════");
  console.log("   E2E TEST COMPLETE ✅");
  console.log("═══════════════════════════════════════\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Test failed:", error);
  process.exit(1);
});
