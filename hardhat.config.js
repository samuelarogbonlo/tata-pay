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

    // Moonbase Alpha (Moonbeam Testnet) - Full EVM compatibility
    moonbase: {
      url: process.env.MOONBASE_RPC_URL || "https://moonbase.unitedbloc.com",
      chainId: 1287,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.ORACLE1_PRIVATE_KEY,
        process.env.ORACLE2_PRIVATE_KEY,
        process.env.MERCHANT1_PRIVATE_KEY,
        process.env.MERCHANT2_PRIVATE_KEY,
        process.env.MERCHANT3_PRIVATE_KEY,
      ].filter(key => key && key !== '0x0000000000000000000000000000000000000000000000000000000000000000'),
      gasPrice: "auto",
      gas: "auto",
      timeout: 60000,
    },

    // Moonbeam Mainnet
    moonbeam: {
      url: process.env.MOONBEAM_RPC_URL || "https://rpc.api.moonbeam.network",
      chainId: 1284,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      gasPrice: "auto",
      gas: "auto",
      timeout: 60000,
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
      moonbaseAlpha: process.env.MOONSCAN_API_KEY || "no-api-key-needed",
      moonbeam: process.env.MOONSCAN_API_KEY || "no-api-key-needed",
    },
    customChains: [
      {
        network: "moonbaseAlpha",
        chainId: 1287,
        urls: {
          apiURL: "https://api-moonbase.moonscan.io/api",
          browserURL: "https://moonbase.moonscan.io",
        },
      },
    ],
  },
};
