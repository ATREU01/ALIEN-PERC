/**
 * Percolator on-chain data parsing for the Alienator UI
 * Mirrors the CLI's slab.ts but browser-compatible
 *
 * Offset constants sourced from src/solana/slab.ts (the canonical layout)
 */
import { PublicKey, Connection } from "@solana/web3.js";

// ============================================================================
// LAYOUT CONSTANTS (must match src/solana/slab.ts exactly)
// ============================================================================

const MAGIC = 0x504552434f4c4154n; // "PERCOLAT"
const HEADER_LEN = 72;
const CONFIG_OFFSET = HEADER_LEN;  // 72
const CONFIG_LEN = 320;
const ENGINE_OFF = CONFIG_OFFSET + CONFIG_LEN; // 392

// Engine layout offsets (relative to ENGINE_OFF)
const ENGINE_VAULT_OFF = 0;          // u128
const ENGINE_INSURANCE_OFF = 16;     // InsuranceFund { balance: u128, fee_revenue: u128 }
const ENGINE_PARAMS_OFF = 48;        // RiskParams (144 bytes)
const ENGINE_CURRENT_SLOT_OFF = 192;
const ENGINE_LAST_CRANK_SLOT_OFF = 232;
const ENGINE_TOTAL_OI_OFF = 248;     // u128
const ENGINE_C_TOT_OFF = 264;        // u128
const ENGINE_PNL_POS_TOT_OFF = 280;  // u128
const ENGINE_NET_LP_POS_OFF = 344;   // i128
const ENGINE_LP_SUM_ABS_OFF = 360;   // u128
const ENGINE_BITMAP_OFF = 408;       // 64 u64 words = 512 bytes
const ENGINE_ACCOUNTS_OFF = 9136;    // Account array starts here

// RiskParams offsets (relative to ENGINE_OFF + ENGINE_PARAMS_OFF)
const PARAMS_WARMUP_PERIOD_OFF = 0;
const PARAMS_MAINTENANCE_MARGIN_OFF = 8;
const PARAMS_INITIAL_MARGIN_OFF = 16;
const PARAMS_TRADING_FEE_OFF = 24;

// Config layout: field offsets relative to CONFIG_OFFSET
// collateral_mint(32) + vault(32) + feed_id(32) + staleness(8) + conf(2) + bump(1) + invert(1) + unit_scale(4)
// = 112 bytes before funding params
// funding params: horizon(8) + k(8) + inv_scale(16) + max_premium(8) + max_bps(8) = 48
// threshold params: floor(16) + risk(8) + interval(8) + step(8) + alpha(8) + min(16) + max(16) + min_step(16) = 96
// Total before oracle_authority: 112 + 48 + 96 = 256
const CONFIG_ORACLE_AUTHORITY_OFF = 256;
const CONFIG_AUTHORITY_PRICE_E6_OFF = 288;  // oracle_authority(32) + = 288
const CONFIG_AUTHORITY_TIMESTAMP_OFF = 296;
const CONFIG_ORACLE_CAP_OFF = 304;
const CONFIG_LAST_EFFECTIVE_PRICE_OFF = 312;

const ACCOUNT_SIZE = 240;
const MAX_ACCOUNTS = 4096;

// ============================================================================
// TYPES
// ============================================================================

export interface MarketState {
  // Header
  admin: string;
  adminBurned: boolean;
  version: number;
  resolved: boolean;

  // Config
  collateralMint: string;
  vault: string;
  inverted: boolean;
  oracleAuthority: string;
  isHyperp: boolean;
  tradingFeeBps: number;
  initialMarginBps: number;
  maintenanceMarginBps: number;

  // Engine
  insuranceBalance: bigint;
  feeRevenue: bigint;
  cTot: bigint;
  pnlPosTot: bigint;
  totalOI: bigint;
  lpSumAbs: bigint;
  markPriceE6: bigint;
  lastCrankSlot: bigint;
  vaultBalance: bigint;

  // Accounts
  numAccounts: number;
}

export interface AccountData {
  index: number;
  kind: "user" | "lp";
  owner: string;
  capital: bigint;
  pnl: bigint;
  positionSize: bigint;
  entryPrice: bigint;
}

// ============================================================================
// PARSING HELPERS
// ============================================================================

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function readU64(buf: Buffer, offset: number): bigint {
  return buf.readBigUInt64LE(offset);
}

function readI128(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigInt64LE(offset + 8);
  return (hi << 64n) | lo;
}

function readU128(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  return (hi << 64n) | lo;
}

// ============================================================================
// MARKET STATE PARSER
// ============================================================================

export function parseMarketState(data: Buffer): MarketState {
  const magic = data.readBigUInt64LE(0);
  if (magic !== MAGIC) throw new Error("Invalid slab magic");

  // --- Header ---
  const version = data.readUInt32LE(8);
  const flags = data.readUInt8(13);
  const resolved = (flags & 1) !== 0;
  const admin = readPubkey(data, 16);
  const adminBurned = admin === "11111111111111111111111111111111";

  // --- Config (offset 72) ---
  const co = CONFIG_OFFSET;
  const collateralMint = readPubkey(data, co);
  const vault = readPubkey(data, co + 32);

  // Check if Hyperp mode (all-zero feed ID)
  const feedIdBytes = data.subarray(co + 64, co + 96);
  const isHyperp = feedIdBytes.every((b: number) => b === 0);

  // invert is at: co + 32(mint) + 32(vault) + 32(feed) + 8(staleness) + 2(conf) + 1(bump) = co + 107
  const inverted = data.readUInt8(co + 107) === 1;

  // Oracle authority
  const oracleAuthority = readPubkey(data, co + CONFIG_ORACLE_AUTHORITY_OFF);

  // Price: use authority price if set (Hyperp mode), otherwise last effective price
  const authorityPriceE6 = readU64(data, co + CONFIG_AUTHORITY_PRICE_E6_OFF);
  const lastEffectivePriceE6 = readU64(data, co + CONFIG_LAST_EFFECTIVE_PRICE_OFF);
  const markPriceE6 = authorityPriceE6 > 0n ? authorityPriceE6 : lastEffectivePriceE6;

  // --- Risk params (engine offset 48) ---
  const po = ENGINE_OFF + ENGINE_PARAMS_OFF;
  const maintenanceMarginBps = Number(readU64(data, po + PARAMS_MAINTENANCE_MARGIN_OFF));
  const initialMarginBps = Number(readU64(data, po + PARAMS_INITIAL_MARGIN_OFF));
  const tradingFeeBps = Number(readU64(data, po + PARAMS_TRADING_FEE_OFF));

  // --- Engine state ---
  const eo = ENGINE_OFF;
  const vaultBalance = readU128(data, eo + ENGINE_VAULT_OFF);
  const insuranceBalance = readU128(data, eo + ENGINE_INSURANCE_OFF);
  const feeRevenue = readU128(data, eo + ENGINE_INSURANCE_OFF + 16);
  const cTot = readU128(data, eo + ENGINE_C_TOT_OFF);
  const pnlPosTot = readU128(data, eo + ENGINE_PNL_POS_TOT_OFF);
  const totalOI = readU128(data, eo + ENGINE_TOTAL_OI_OFF);
  const lpSumAbs = readU128(data, eo + ENGINE_LP_SUM_ABS_OFF);
  const lastCrankSlot = readU64(data, eo + ENGINE_LAST_CRANK_SLOT_OFF);

  // --- Count accounts from bitmap ---
  let numAccounts = 0;
  const bitmapOff = ENGINE_OFF + ENGINE_BITMAP_OFF;
  for (let i = 0; i < 64; i++) {
    let word = data.readBigUInt64LE(bitmapOff + i * 8);
    while (word > 0n) {
      word &= word - 1n;
      numAccounts++;
    }
  }

  return {
    admin,
    adminBurned,
    version,
    resolved,
    collateralMint,
    vault,
    inverted,
    oracleAuthority,
    isHyperp,
    tradingFeeBps,
    initialMarginBps,
    maintenanceMarginBps,
    insuranceBalance,
    feeRevenue,
    cTot,
    pnlPosTot,
    totalOI,
    lpSumAbs,
    markPriceE6,
    lastCrankSlot,
    vaultBalance,
    numAccounts,
  };
}

// ============================================================================
// ACCOUNT PARSER
// ============================================================================

export function parseAccount(data: Buffer, index: number): AccountData | null {
  const offset = ENGINE_OFF + ENGINE_ACCOUNTS_OFF + index * ACCOUNT_SIZE;
  if (offset + ACCOUNT_SIZE > data.length) return null;

  const accountId = readU64(data, offset);
  if (accountId === 0n) return null; // Empty slot

  const capital = readU128(data, offset + 8);
  const kind = data.readUInt8(offset + 24);
  const pnl = readI128(data, offset + 32);
  const positionSize = readI128(data, offset + 80);
  const entryPrice = readU64(data, offset + 96);
  const owner = readPubkey(data, offset + 184);

  return {
    index,
    kind: kind === 0 ? "user" : "lp",
    owner,
    capital,
    pnl,
    positionSize,
    entryPrice,
  };
}

// ============================================================================
// CHAINLINK ORACLE PARSER (ported from Toly's src/solana/oracle.ts)
// ============================================================================

const CHAINLINK_MIN_SIZE = 224; // offset 216 + 8 bytes for i64
const MAX_DECIMALS = 18;
const CHAINLINK_DECIMALS_OFFSET = 138;
const CHAINLINK_ANSWER_OFFSET = 216;

export interface OraclePrice {
  price: bigint;
  decimals: number;
}

/**
 * Parse price from a Chainlink aggregator account buffer.
 * Validates buffer size, decimals range (0-18), and positive price.
 */
export function parseChainlinkPrice(data: Buffer): OraclePrice {
  if (data.length < CHAINLINK_MIN_SIZE) {
    throw new Error(
      `Oracle account data too small: ${data.length} bytes (need at least ${CHAINLINK_MIN_SIZE})`
    );
  }

  const decimals = data.readUInt8(CHAINLINK_DECIMALS_OFFSET);
  if (decimals > MAX_DECIMALS) {
    throw new Error(`Oracle decimals out of range: ${decimals} (max ${MAX_DECIMALS})`);
  }

  const price = data.readBigInt64LE(CHAINLINK_ANSWER_OFFSET);
  if (price <= 0n) {
    throw new Error(`Oracle price is non-positive: ${price}`);
  }

  return { price, decimals };
}

// ============================================================================
// FETCH
// ============================================================================

export async function fetchMarketData(
  connection: Connection,
  slabPubkey: string
): Promise<{ state: MarketState; rawData: Buffer }> {
  const info = await connection.getAccountInfo(new PublicKey(slabPubkey));
  if (!info) throw new Error("Market not found");
  const data = Buffer.from(info.data);
  return { state: parseMarketState(data), rawData: data };
}
