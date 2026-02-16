/**
 * ALIEN Percolator Constants
 */
import { PublicKey } from "@solana/web3.js";

// Program IDs
export const PERCOLATOR_PROGRAM_ID = new PublicKey(
  "2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp"
);
export const MATCHER_PROGRAM_ID = new PublicKey(
  "4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy"
);

// Network — defaults to devnet where ALIEN market is deployed.
// Set VITE_RPC_URL in .env to override (e.g. your Helius endpoint).
export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_URL || "https://api.devnet.solana.com";

// Contract Address (set via env var VITE_CONTRACT_ADDRESS after pump.fun launch)
export const CONTRACT_ADDRESS: string =
  import.meta.env.VITE_CONTRACT_ADDRESS || "";

// On-chain slab account size (ENGINE_OFF + ENGINE_LEN for 4096 accounts)
export const SLAB_DATA_SIZE = 992_560;

// Minimum LP collateral deposit (SOL)
export const MIN_COLLATERAL_SOL = 3;

// Estimated Solana transaction fees for deploy (~5 instructions)
export const TX_FEE_SOL = 0.01;

// Precision
export const PRICE_PRECISION = 1_000_000; // 1e6 for mark price
export const BPS_PRECISION = 10_000;

// Layout
export const MAX_ACCOUNTS = 4096;
export const ACCOUNT_SIZE = 240;

// Navigation
export const ROUTES = {
  HOME: "",
  TRADE: "trade",
  EARN: "earn",
  REGISTER: "register",
  INDEXER: "indexer",
} as const;

// Known markets (will be populated from on-chain discovery)
export interface KnownMarket {
  name: string;
  symbol: string;
  slabAddress: string;
  collateralMint: string;
  inverted: boolean;
  icon?: string;
}

// Known deployed markets — used as fallback when getProgramAccounts is unavailable
export const KNOWN_MARKETS: KnownMarket[] = [
  {
    name: "ALIEN / USD",
    symbol: "ALIEN",
    slabAddress: "A7wQtRT9DhFqYho8wTVqQCDc7kYPTUXGPATiyVbZKVFs",
    collateralMint: "So11111111111111111111111111111111111111112",
    inverted: true,
  },
];
