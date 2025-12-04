require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

// Polyfill WebSocket for Node.js environment
if (typeof WebSocket === 'undefined') {
  global.WebSocket = require('ws');
}

require("@parity/hardhat-polkadot");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000, // Higher runs for deployment size optimization
      },
      viaIR: true, // Enable intermediate representation for better optimization
    },
  },

  resolc: {
    version: "0.3.0", // Must match installed @parity/resolc version
    compilerSource: "npm",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // Default hardhat network for unit tests (no PolkaVM)
    hardhat: {
      chainId: 31337,
    },

    // Local development node with PolkaVM
    localNode: {
      polkavm: true,
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // Paseo Asset Hub Testnet (PVM)
    paseo: {
      polkavm: true,
      url: process.env.PASEO_RPC_URL || "https://testnet-passet-hub-eth-rpc.polkadot.io",
      chainId: parseInt(process.env.PASEO_CHAIN_ID || "420420422"),
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
    timeout: 120000, // 2 minutes for PolkaVM tests
  },

  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
  },

  etherscan: {
    apiKey: {
      paseo: "no-api-key-needed", // BlockScout doesn't require API key
    },
    customChains: [
      {
        network: "paseo",
        chainId: 420420422,
        urls: {
          apiURL: "https://blockscout-passet-hub.parity-testnet.parity.io/api",
          browserURL: "https://blockscout-passet-hub.parity-testnet.parity.io",
        },
      },
    ],
  },
};
