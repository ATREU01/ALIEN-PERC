#!/usr/bin/env npx ts-node
/**
 * refresh-market.ts — Push oracle price + crank the market
 *
 * Run from LAUNCHPAD machine (needs deploy wallet as oracle authority):
 *   npx ts-node scripts/refresh-market.ts
 *   npx ts-node scripts/refresh-market.ts --price 1000000   # set specific price (e6)
 *   npx ts-node scripts/refresh-market.ts --loop 30          # repeat every 30 seconds
 *
 * Env vars:
 *   SOLANA_RPC_URL  — RPC endpoint (default: devnet)
 *   MARKET_FILE     — path to market JSON (default: devnet-market.json)
 *   KEYPAIR         — path to keypair (default: ~/.config/solana/id.json)
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MARKET_FILE = process.env.MARKET_FILE || resolve(__dirname, "..", "devnet-market.json");
const KEYPAIR_PATH = process.env.KEYPAIR || resolve(process.env.HOME!, ".config/solana/id.json");

const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");

// Parse CLI args
const args = process.argv.slice(2);
let priceE6 = 1_000_000n; // default 1.0 (mark price in e6)
let loopSecs = 0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--price" && args[i + 1]) {
    priceE6 = BigInt(args[++i]);
  } else if (args[i] === "--loop" && args[i + 1]) {
    loopSecs = Number(args[++i]);
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------
function encU8(val: number): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(val, 0);
  return buf;
}

function encU16(val: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(val, 0);
  return buf;
}

function encU64(val: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(val, 0);
  return buf;
}

function encI64(val: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(val, 0);
  return buf;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function refresh() {
  // Load keypair
  const raw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf-8"));
  const payer = Keypair.fromSecretKey(Uint8Array.from(raw));
  console.log(`Wallet:  ${payer.publicKey.toBase58()}`);

  // Load market config
  let slabAddress: string;
  try {
    const market = JSON.parse(readFileSync(MARKET_FILE, "utf-8"));
    slabAddress = market.slabAddress || market.slab;
    console.log(`Market:  ${MARKET_FILE}`);
  } catch {
    // Fallback to hardcoded devnet slab
    slabAddress = "EU6MFz2b85UgZvnAmoRnXRGziJMFzrHVoh1qKRftwvcA";
    console.log("Market:  using hardcoded devnet slab");
  }
  const slab = new PublicKey(slabAddress);
  console.log(`Slab:    ${slab.toBase58()}`);
  console.log(`RPC:     ${RPC}`);
  console.log(`Price:   ${priceE6} (${Number(priceE6) / 1e6})`);

  const conn = new Connection(RPC, "confirmed");

  async function doRefresh() {
    const now = BigInt(Math.floor(Date.now() / 1000));

    // 1. Push oracle price (tag 17: authority + slab)
    const pushData = Buffer.concat([
      encU8(17),        // PushOraclePrice tag
      encU64(priceE6),  // price in e6
      encI64(now),      // unix timestamp
    ]);
    const pushIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: slab, isSigner: false, isWritable: true },
      ],
      data: pushData,
    });

    // 2. Keeper crank (tag 5: caller + slab + clock + oracle)
    // For hyperp, oracle = slab
    const crankData = Buffer.concat([
      encU8(5),         // KeeperCrank tag
      encU16(65535),    // callerIdx = permissionless
      encU8(0),         // allowPanic = false
    ]);
    const crankIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: slab, isSigner: false, isWritable: true },
        { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        { pubkey: slab, isSigner: false, isWritable: false }, // oracle = slab for hyperp
      ],
      data: crankData,
    });

    // Combine into one transaction
    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
    tx.add(pushIx);
    tx.add(crankIx);

    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [payer], {
        commitment: "confirmed",
        skipPreflight: true,
      });
      console.log(`[${new Date().toISOString()}] OK — ${sig}`);
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}] FAIL — ${e.message}`);
    }
  }

  // Run once
  await doRefresh();

  // Loop if requested
  if (loopSecs > 0) {
    console.log(`\nLooping every ${loopSecs}s (Ctrl+C to stop)`);
    setInterval(doRefresh, loopSecs * 1000);
  }
}

refresh().catch(console.error);
