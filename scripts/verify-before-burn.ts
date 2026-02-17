/**
 * Pre-Burn Verification Checklist
 *
 * Run this BEFORE burning the admin key to verify everything is correctly set up.
 * This script reads the on-chain market state and prints a comprehensive checklist.
 *
 * Usage:
 *   npx tsx scripts/verify-before-burn.ts
 *
 * If all checks pass, proceed to:
 *   npx tsx scripts/burn-admin-key.ts
 */

import "dotenv/config";
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import { parseHeader, parseConfig, parseEngine, parseParams, parseUsedIndices, fetchSlab } from "../src/solana/slab.js";

// ============================================================================
// LOAD MARKET INFO
// ============================================================================

const MARKET_FILE = process.env.MARKET_FILE || "devnet-market.json";

if (!fs.existsSync(MARKET_FILE)) {
  console.error(`ERROR: ${MARKET_FILE} not found. Run deploy-alien-devnet.ts or setup-alien-market.ts first.`);
  process.exit(1);
}

const marketInfo = JSON.parse(fs.readFileSync(MARKET_FILE, "utf-8"));
const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// ============================================================================
// VERIFICATION
// ============================================================================

interface Check {
  name: string;
  status: "PASS" | "FAIL" | "WARN";
  detail: string;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ALIEN PERCOLATOR - PRE-BURN VERIFICATION");
  console.log("=".repeat(70));
  console.log(`\nMarket: ${marketInfo.slab}`);
  console.log(`Network: ${marketInfo.network}`);
  console.log(`Created: ${marketInfo.createdAt}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  const checks: Check[] = [];

  // Fetch slab data
  let slabData: Buffer;
  try {
    slabData = await fetchSlab(connection, new PublicKey(marketInfo.slab));
    checks.push({ name: "Slab account exists", status: "PASS", detail: marketInfo.slab });
  } catch (e) {
    checks.push({ name: "Slab account exists", status: "FAIL", detail: `Not found: ${(e as Error).message}` });
    printResults(checks);
    process.exit(1);
  }

  // Parse all components
  const header = parseHeader(slabData);
  const config = parseConfig(slabData);
  const engine = parseEngine(slabData);
  const usedIndices = parseUsedIndices(slabData);

  // ---- Header checks ----
  checks.push({
    name: "Magic number valid",
    status: header.magic === 0x504552434f4c4154n ? "PASS" : "FAIL",
    detail: `0x${header.magic.toString(16)}`,
  });

  checks.push({
    name: "Admin matches expected",
    status: header.admin.toBase58() === marketInfo.admin ? "PASS" : "FAIL",
    detail: header.admin.toBase58(),
  });

  checks.push({
    name: "Market not resolved",
    status: !header.resolved ? "PASS" : "FAIL",
    detail: header.resolved ? "RESOLVED (cannot burn)" : "Active",
  });

  // ---- Config checks ----
  checks.push({
    name: "Collateral mint matches ALIEN",
    status: config.collateralMint.toBase58() === marketInfo.mint ? "PASS" : "FAIL",
    detail: config.collateralMint.toBase58(),
  });

  checks.push({
    name: "Market is INVERTED",
    status: config.invert === 1 ? "PASS" : "FAIL",
    detail: config.invert === 1 ? "Yes (price = 1/ALIEN_USD)" : "No (should be inverted!)",
  });

  checks.push({
    name: "Vault matches",
    status: config.vaultPubkey.toBase58() === marketInfo.vault ? "PASS" : "FAIL",
    detail: config.vaultPubkey.toBase58(),
  });

  // ---- Risk parameter checks ----
  const params = parseParams(slabData);

  checks.push({
    name: "Initial margin >= 10%",
    status: Number(params.initialMarginBps) >= 1000 ? "PASS" : "WARN",
    detail: `${Number(params.initialMarginBps) / 100}%`,
  });

  checks.push({
    name: "Maintenance margin >= 5%",
    status: Number(params.maintenanceMarginBps) >= 500 ? "PASS" : "WARN",
    detail: `${Number(params.maintenanceMarginBps) / 100}%`,
  });

  checks.push({
    name: "Trading fee > 0",
    status: Number(params.tradingFeeBps) > 0 ? "PASS" : "FAIL",
    detail: `${Number(params.tradingFeeBps) / 100}% (feeds insurance fund)`,
  });

  // ---- Insurance fund checks ----
  const insuranceBalance = BigInt(engine.insuranceFund?.balance || 0);

  checks.push({
    name: "Insurance fund seeded",
    status: insuranceBalance > 0n ? "PASS" : "FAIL",
    detail: `${insuranceBalance} lamports`,
  });

  // ---- Account checks ----
  checks.push({
    name: "LP accounts created",
    status: usedIndices.length > 0 ? "PASS" : "FAIL",
    detail: `${usedIndices.length} accounts (indices: ${usedIndices.join(", ")})`,
  });

  // ---- Oracle authority check ----
  const zeroKey = "11111111111111111111111111111111";
  const oracleAuth = config.oracleAuthority.toBase58();

  checks.push({
    name: "Oracle authority status",
    status: oracleAuth === zeroKey ? "PASS" : "WARN",
    detail: oracleAuth === zeroKey
      ? "Disabled (using Pyth/Chainlink only)"
      : `Active: ${oracleAuth} (consider disabling before burn)`,
  });

  // ---- Price cap check ----
  checks.push({
    name: "Oracle price cap set",
    status: config.oraclePriceCapE2bps > 0n ? "PASS" : "WARN",
    detail: config.oraclePriceCapE2bps > 0n
      ? `${Number(config.oraclePriceCapE2bps) / 10000}%`
      : "No cap (consider setting one before burn)",
  });

  // ---- Print results ----
  printResults(checks);

  // ---- Summary ----
  const failures = checks.filter((c) => c.status === "FAIL");
  const warnings = checks.filter((c) => c.status === "WARN");

  console.log("\n" + "-".repeat(70));
  if (failures.length > 0) {
    console.log(`\n  ${failures.length} FAILURES - DO NOT BURN YET!`);
    console.log("  Fix the issues above before proceeding.\n");
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(`\n  All critical checks PASS. ${warnings.length} warnings to review.`);
    console.log("  Warnings are non-blocking but should be reviewed.\n");
    console.log("  If satisfied, run:  npx tsx scripts/burn-admin-key.ts\n");
  } else {
    console.log("\n  ALL CHECKS PASS!");
    console.log("  Ready to burn admin key.\n");
    console.log("  Run:  npx tsx scripts/burn-admin-key.ts\n");
  }
}

function printResults(checks: Check[]) {
  console.log("-".repeat(70));
  for (const check of checks) {
    const icon = check.status === "PASS" ? "[OK]" : check.status === "FAIL" ? "[!!]" : "[??]";
    const pad = " ".repeat(Math.max(0, 40 - check.name.length));
    console.log(`  ${icon} ${check.name}${pad} ${check.detail}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
