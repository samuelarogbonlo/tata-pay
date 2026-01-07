require("dotenv").config();

/**
 * Network configurations for TataPay
 * Single source of truth for RPC endpoints and contract addresses
 */

module.exports = {
  paseo: {
    name: "Paseo Asset Hub",
    rpcUrl: process.env.PASEO_RPC_URL || "https://testnet-passet-hub-eth-rpc.polkadot.io",
    chainId: 420420422,
    gasPrice: 1000000000000, // 1000 gwei - REQUIRED for Asset Hub!
    contracts: {
      usdc: process.env.MOCK_USDC_ADDRESS || "0xd1bBE61C683B339dE9733b928616C1594e770A3c",
      collateralPool: process.env.COLLATERAL_POOL_ADDRESS || "0x1FCd386a00777A469e7C6993FB7E0f9515DB1bFc",
      paymentSettlement: process.env.PAYMENT_SETTLEMENT_ADDRESS || "0x4B4280B2277e6F15CF4d7fC6Bd6BFAd1144AE9DF",
      fraudPrevention: process.env.FRAUD_PREVENTION_ADDRESS || "0x3F21Eb25bf4dBeC4cAfBD51fb0b5fD9685e66610",
      settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS || "0x94F205EAB260d227Cb8591082125144bA76E6d6A",
      governance: process.env.TATAPAY_GOVERNANCE_ADDRESS || "0xb9A64476CFCD47127d80C6056E7F09D9E9A8BD11"
    },
    explorer: "https://blockscout-passet-hub.parity-testnet.parity.io",
    faucet: "https://faucet.polkadot.io/?parachain=1111",
    nativeCurrency: {
      name: "PAS",
      symbol: "PAS",
      decimals: 18
    }
  },

  westend: {
    name: "Westend Asset Hub",
    rpcUrl: process.env.WESTEND_RPC_URL || "https://westend-asset-hub-eth-rpc.polkadot.io",
    chainId: 420420421,
    gasPrice: 1000000000000, // 1000 gwei - REQUIRED for Asset Hub!
    contracts: {
      usdc: process.env.MOCK_USDC_ADDRESS,
      collateralPool: process.env.COLLATERAL_POOL_ADDRESS,
      paymentSettlement: process.env.PAYMENT_SETTLEMENT_ADDRESS,
      fraudPrevention: process.env.FRAUD_PREVENTION_ADDRESS,
      settlementOracle: process.env.SETTLEMENT_ORACLE_ADDRESS,
      governance: process.env.TATAPAY_GOVERNANCE_ADDRESS
    },
    explorer: "https://westend-asset-hub-eth-explorer.parity.io",
    faucet: "https://faucet.polkadot.io/westend",
    nativeCurrency: {
      name: "WND",
      symbol: "WND",
      decimals: 18
    }
  }
};

/**
 * Get network config by name
 * @param {string} networkName - 'paseo' or 'westend'
 * @returns {object} Network configuration
 */
module.exports.getNetwork = function(networkName = 'paseo') {
  const config = module.exports[networkName];
  if (!config) {
    throw new Error(`Unknown network: ${networkName}. Use 'paseo' or 'westend'`);
  }
  return config;
};
