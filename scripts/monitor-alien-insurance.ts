/**
 * ALIEN Insurance Fund Monitor (Soft Burn Tracker)
 *
 * Real-time monitoring of the insurance fund growth from trading fees.
 * After the admin key is burned, fees flowing into insurance are effectively
 * a permanent soft burn of ALIEN tokens - they can never be withdrawn.
 *
 * Usage:
 *   npx tsx scripts/monitor-alien-insurance.ts
 *
 * Optional env vars:
 *   SOLANA_RPC_URL   - RPC endpoint (default: mainnet)
 *   POLL_INTERVAL    - Polling interval in ms (default: 15000)
 */

import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import { fetchSlab, parseHeader, parseParams, parseEngine, parseConfig, parseUsedIndices } from "../src/solana/slab.js";
import * as fs from "fs";

// ============================================================================
// CONFIG
// ============================================================================

const MARKET_FILE = "alien-market.json";
if (!fs.existsSync(MARKET_FILE)) {
  console.error(`ERROR: ${MARKET_FILE} not found.`);
  process.exit(1);
}

const marketInfo = JSON.parse(fs.readFileSync(MARKET_FILE, "utf-8"));
const SLAB = new PublicKey(marketInfo.slab);
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const POLL_MS = parseInt(process.env.POLL_INTERVAL || "15000", 10);
const conn = new Connection(rpcUrl, "confirmed");

// ============================================================================
// TYPES
// ============================================================================

interface Snapshot {
  time: Date;
  insurance: bigint;
  feeRevenue: bigint;
  cTot: bigint;
  totalOI: bigint;
  lpSumAbs: bigint;
  numAccounts: number;
  adminBurned: boolean;
}

// ============================================================================
// STATE
// ============================================================================

const history: Snapshot[] = [];
let startSnapshot: Snapshot | null = null;

// ============================================================================
// HELPERS
// ============================================================================

function formatTokens(lamports: bigint, decimals: number = 9): string {
  const whole = lamports / BigInt(10 ** decimals);
  const frac = lamports % BigInt(10 ** decimals);
  return `${whole}.${frac.toString().padStart(decimals, "0").slice(0, 4)}`;
}

function formatChange(current: bigint, start: bigint, decimals: number = 9): string {
  const diff = current - start;
  const sign = diff >= 0n ? "+" : "";
  return `${sign}${formatTokens(diff, decimals)}`;
}

function formatRate(current: bigint, start: bigint, elapsedMs: number, decimals: number = 9): string {
  if (elapsedMs <= 0) return "0.0000/hr";
  const diff = Number(current - start) / (10 ** decimals);
  const hoursElapsed = elapsedMs / 3600000;
  const rate = diff / hoursElapsed;
  return `${rate.toFixed(4)}/hr`;
}

// ============================================================================
// SNAPSHOT
// ============================================================================

async function getSnapshot(): Promise<Snapshot> {
  const data = await fetchSlab(conn, SLAB);
  const header = parseHeader(data);
  const engine = parseEngine(data);
  const indices = parseUsedIndices(data);

  const DEAD = "11111111111111111111111111111111";

  return {
    time: new Date(),
    insurance: BigInt(engine.insuranceFund?.balance || 0),
    feeRevenue: BigInt(engine.insuranceFund?.feeRevenue || 0),
    cTot: BigInt(engine.cTot || 0),
    totalOI: BigInt(engine.totalOpenInterest || 0),
    lpSumAbs: BigInt(engine.lpSumAbs || 0),
    numAccounts: indices.length,
    adminBurned: header.admin.toBase58() === DEAD,
  };
}

// ============================================================================
// DISPLAY
// ============================================================================

async function printStatus() {
  const snap = await getSnapshot();
  history.push(snap);

  if (!startSnapshot) {
    startSnapshot = snap;
    console.log("=".repeat(70));
    console.log("ALIEN SOVEREIGN PERCOLATOR - INSURANCE FUND MONITOR");
    console.log("=".repeat(70));
    console.log(`  Market:    ${SLAB.toBase58()}`);
    console.log(`  Network:   ${marketInfo.network}`);
    console.log(`  Admin:     ${snap.adminBurned ? "BURNED (sovereign)" : "ACTIVE (not yet burned)"}`);
    console.log(`  Started:   ${snap.time.toISOString()}`);
    console.log(`  Polling:   every ${POLL_MS / 1000}s`);
    console.log("");
    console.log("  Initial State:");
    console.log(`    Insurance balance:  ${formatTokens(snap.insurance)} ALIEN`);
    console.log(`    Fee revenue:        ${formatTokens(snap.feeRevenue)} ALIEN`);
    console.log(`    Total collateral:   ${formatTokens(snap.cTot)} ALIEN`);
    console.log(`    Open interest:      ${formatTokens(snap.totalOI)} ALIEN`);
    console.log(`    Active accounts:    ${snap.numAccounts}`);
    console.log("=".repeat(70));
    console.log("");
    console.log("  TIME       | INSURANCE         | FEE REVENUE       | RATE       | ACCOUNTS");
    console.log("  " + "-".repeat(80));
    return;
  }

  const elapsed = snap.time.getTime() - startSnapshot.time.getTime();
  const elapsedMin = Math.floor(elapsed / 60000);
  const elapsedSec = Math.floor((elapsed % 60000) / 1000);
  const timeStr = `${String(elapsedMin).padStart(3, " ")}m${String(elapsedSec).padStart(2, "0")}s`;

  const insStr = `${formatTokens(snap.insurance)} (${formatChange(snap.insurance, startSnapshot.insurance)})`;
  const feeStr = `${formatTokens(snap.feeRevenue)} (${formatChange(snap.feeRevenue, startSnapshot.feeRevenue)})`;
  const rateStr = formatRate(snap.feeRevenue, startSnapshot.feeRevenue, elapsed);

  console.log(`  ${timeStr} | ${insStr.padEnd(17)} | ${feeStr.padEnd(17)} | ${rateStr.padEnd(10)} | ${snap.numAccounts}`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\nStarting ALIEN insurance fund monitor...");
  console.log("Press Ctrl+C to stop and see summary.\n");

  await printStatus();

  setInterval(async () => {
    try {
      await printStatus();
    } catch (e) {
      console.log(`  [ERROR] ${(e as Error).message}`);
    }
  }, POLL_MS);
}

// Graceful shutdown with summary
process.on("SIGINT", () => {
  console.log("\n\n" + "=".repeat(70));
  console.log("MONITORING SESSION SUMMARY");
  console.log("=".repeat(70));

  if (startSnapshot && history.length > 1) {
    const final = history[history.length - 1];
    const elapsed = final.time.getTime() - startSnapshot.time.getTime();
    const elapsedMin = (elapsed / 60000).toFixed(1);

    console.log(`  Duration:         ${elapsedMin} minutes`);
    console.log(`  Snapshots:        ${history.length}`);
    console.log("");
    console.log("  Insurance Fund:");
    console.log(`    Start:          ${formatTokens(startSnapshot.insurance)} ALIEN`);
    console.log(`    End:            ${formatTokens(final.insurance)} ALIEN`);
    console.log(`    Change:         ${formatChange(final.insurance, startSnapshot.insurance)} ALIEN`);
    console.log("");
    console.log("  Fee Revenue (Soft Burn):");
    console.log(`    Start:          ${formatTokens(startSnapshot.feeRevenue)} ALIEN`);
    console.log(`    End:            ${formatTokens(final.feeRevenue)} ALIEN`);
    console.log(`    Accumulated:    ${formatChange(final.feeRevenue, startSnapshot.feeRevenue)} ALIEN`);
    console.log(`    Rate:           ${formatRate(final.feeRevenue, startSnapshot.feeRevenue, elapsed)} ALIEN`);
    console.log("");
    console.log("  Accounts:");
    console.log(`    Start:          ${startSnapshot.numAccounts}`);
    console.log(`    End:            ${final.numAccounts}`);
    console.log(`    Admin burned:   ${final.adminBurned ? "YES" : "NO"}`);
  }

  console.log("=".repeat(70) + "\n");
  process.exit(0);
});

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
