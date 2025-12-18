require("dotenv").config();

/**
 * Network configurations for TataPay
 * Single source of truth for RPC endpoints and contract addresses
 */

module.exports = {
  moonbase: {
    name: "Moonbase Alpha",
    rpcUrl: process.env.MOONBASE_RPC_URL || "https://moonbase.unitedbloc.com",
    chainId: 1287,
    contracts: {
      usdc: process.env.MOCK_USDC_ADDRESS || "0x3ee3AcA42AC2D8194Ebb52eEAc4EFa44f0775603",
      collateralPool: process.env.COLLATERAL_POOL_ADDRESS || "0x1dADeb1b5A07582399D4DEcBac045A3b6a0D82E9",
      paymentSettlement: process.env.PAYMENT_SETTLEMENT_ADDRESS || "0xE596d1382cD7488eF8dB13B347bAdc6781110d30",
      fraudPrevention: process.env.FRAUD_PREVENTION_ADDRESS || "0xc08eCE74fAB86680f758Fa5E169E767E076a7b56",
      settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS || "0xdBa042E41871BBA66e290209Bff79a86CfB9a58e",
      governance: process.env.TATAPAY_GOVERNANCE_ADDRESS || "0xA64e6ac9A8D6cbf2d239B9E00152812E0fEf7C2B"
    },
    explorer: "https://moonbase.moonscan.io",
    faucet: "https://faucet.moonbeam.network/",
    nativeCurrency: {
      name: "DEV",
      symbol: "DEV",
      decimals: 18
    }
  },

  moonbeam: {
    name: "Moonbeam Mainnet",
    rpcUrl: process.env.MOONBEAM_RPC_URL || "https://rpc.api.moonbeam.network",
    chainId: 1284,
    contracts: {
      usdc: "0x818ec0A7Fe18Ff94269904fCED6AE3DaE6d6dC0b", // Real USDC on Moonbeam
      collateralPool: process.env.COLLATERAL_POOL_ADDRESS,
      paymentSettlement: process.env.PAYMENT_SETTLEMENT_ADDRESS,
      fraudPrevention: process.env.FRAUD_PREVENTION_ADDRESS,
      settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS,
      governance: process.env.TATAPAY_GOVERNANCE_ADDRESS
    },
    explorer: "https://moonscan.io",
    nativeCurrency: {
      name: "GLMR",
      symbol: "GLMR",
      decimals: 18
    }
  }
};

/**
 * Get network config by name
 * @param {string} networkName - 'moonbase' or 'moonbeam'
 * @returns {object} Network configuration
 */
module.exports.getNetwork = function(networkName = 'moonbase') {
  const config = module.exports[networkName];
  if (!config) {
    throw new Error(`Unknown network: ${networkName}. Use 'moonbase' or 'moonbeam'`);
  }
  return config;
};
