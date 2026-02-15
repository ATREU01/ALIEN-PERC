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

// Network
export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_URL || "https://api.mainnet-beta.solana.com";

// Slab rent cost in SOL (approximate ~992KB account)
export const SLAB_RENT_SOL = 7;
export const COLLATERAL_SOL = 3;
export const BURN_FEE_SOL = 2;
export const TOTAL_LISTING_COST_SOL = SLAB_RENT_SOL + COLLATERAL_SOL + BURN_FEE_SOL;

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

// Placeholder — real markets get discovered on-chain
export const KNOWN_MARKETS: KnownMarket[] = [
  // Will be populated once ALIEN market is deployed
  // {
  //   name: "ALIEN / USD",
  //   symbol: "ALIEN",
  //   slabAddress: "<TBD>",
  //   collateralMint: "<ALIEN_MINT>",
  //   inverted: true,
  // },
];
