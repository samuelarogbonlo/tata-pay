require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

// Polyfill WebSocket for Node.js environment
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: process.env.ENABLE_OPTIMIZER !== 'false',
        runs: parseInt(process.env.OPTIMIZER_RUNS || '200'),
      },
    },
  },

  networks: {
    // Default hardhat network for unit tests
    hardhat: {
      chainId: 31337,
    },

    // Paseo Asset Hub Testnet (Primary deployment target)
    // IMPORTANT: Asset Hub requires 1000 gwei gas price!
    paseoAssetHub: {
      url: process.env.PASEO_RPC_URL || "https://testnet-passet-hub-eth-rpc.polkadot.io",
      chainId: 420420422,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.ORACLE1_PRIVATE_KEY,
        process.env.ORACLE2_PRIVATE_KEY,
        process.env.MERCHANT1_PRIVATE_KEY,
        process.env.MERCHANT2_PRIVATE_KEY,
        process.env.MERCHANT3_PRIVATE_KEY,
      ].filter(key => key && key !== '0x0000000000000000000000000000000000000000000000000000000000000000'),
      gasPrice: 1000000000000, // 1000 gwei - Asset Hub requires high gas price!
      gas: "auto",
      timeout: 120000, // 2 minutes
    },

    // Westend Asset Hub Testnet (Backup)
    // IMPORTANT: Asset Hub requires 1000 gwei gas price!
    westendAssetHub: {
      url: process.env.WESTEND_RPC_URL || "https://westend-asset-hub-eth-rpc.polkadot.io",
      chainId: 420420421,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.ORACLE1_PRIVATE_KEY,
        process.env.ORACLE2_PRIVATE_KEY,
        process.env.MERCHANT1_PRIVATE_KEY,
        process.env.MERCHANT2_PRIVATE_KEY,
        process.env.MERCHANT3_PRIVATE_KEY,
      ].filter(key => key && key !== '0x0000000000000000000000000000000000000000000000000000000000000000'),
      gasPrice: 1000000000000, // 1000 gwei - Asset Hub requires high gas price!
      gas: "auto",
      timeout: 120000, // 2 minutes
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  mocha: {
    timeout: 120000, // 2 minutes for complex tests
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
  },

  etherscan: {
    apiKey: {
      paseoAssetHub: "no-api-key-needed", // Blockscout doesn't require API key
    },
    customChains: [
      {
        network: "paseoAssetHub",
        chainId: 420420422,
        urls: {
          apiURL: "https://blockscout-passet-hub.parity-testnet.parity.io/api",
          browserURL: "https://blockscout-passet-hub.parity-testnet.parity.io",
        },
      },
    ],
  },
};
