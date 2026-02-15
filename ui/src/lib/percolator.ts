/**
 * Percolator on-chain data parsing for the UI
 * Mirrors the CLI's slab.ts but browser-compatible
 */
import { PublicKey, Connection } from "@solana/web3.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const MAGIC = 0x504552434f4c4154n; // "PERCOLAT"
const HEADER_LEN = 72;
const CONFIG_OFFSET = HEADER_LEN;
const CONFIG_LEN = 320;
const ENGINE_OFF = CONFIG_OFFSET + CONFIG_LEN; // 392
const ENGINE_INSURANCE_OFF = 16;
const ENGINE_PARAMS_OFF = 64;
const ENGINE_ACCOUNTS_OFF = 8744;
const ACCOUNT_SIZE = 240;
const BITMAP_OFF = ENGINE_OFF + ENGINE_INSURANCE_OFF + 32; // After insurance fund
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
// PARSING
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

export function parseMarketState(data: Buffer): MarketState {
  const magic = data.readBigUInt64LE(0);
  if (magic !== MAGIC) throw new Error("Invalid slab magic");

  const version = data.readUInt32LE(8);
  const flags = data.readUInt8(13);
  const resolved = (flags & 1) !== 0;
  const admin = readPubkey(data, 16);
  const adminBurned = admin === "11111111111111111111111111111111";

  // Config (offset 72)
  const co = CONFIG_OFFSET;
  const collateralMint = readPubkey(data, co);
  const vault = readPubkey(data, co + 32);
  const inverted = data.readUInt8(co + 96 + 2 + 1) === 1; // after feed(32)+staleness(8)+conf(2)+bump(1)

  // Risk params (in engine section)
  const po = ENGINE_OFF + ENGINE_PARAMS_OFF;
  const maintenanceMarginBps = Number(readU64(data, po + 8));
  const initialMarginBps = Number(readU64(data, po + 16));
  const tradingFeeBps = Number(readU64(data, po + 24));

  // Engine state
  const eo = ENGINE_OFF;
  const cTot = readU128(data, eo);
  const insuranceBalance = readU128(data, eo + ENGINE_INSURANCE_OFF);
  const feeRevenue = readU128(data, eo + ENGINE_INSURANCE_OFF + 16);

  // Additional engine fields
  const pnlPosTot = readU128(data, eo + 32);
  const totalOI = readU128(data, eo + 48);
  const lpSumAbs = readU128(data, eo + 80);
  const markPriceE6 = readU64(data, eo + 96);
  const lastCrankSlot = readU64(data, eo + 104);

  // Count accounts from bitmap
  let numAccounts = 0;
  const bitmapOff = ENGINE_OFF + 408; // approximate bitmap offset
  for (let i = 0; i < 64; i++) {
    const word = data.readBigUInt64LE(bitmapOff + i * 8);
    // Count set bits
    let w = word;
    while (w > 0n) {
      w &= w - 1n;
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
    numAccounts,
  };
}

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

export async function fetchMarketData(
  connection: Connection,
  slabPubkey: string
): Promise<{ state: MarketState; rawData: Buffer }> {
  const info = await connection.getAccountInfo(new PublicKey(slabPubkey));
  if (!info) throw new Error("Market not found");
  const data = Buffer.from(info.data);
  return { state: parseMarketState(data), rawData: data };
}
