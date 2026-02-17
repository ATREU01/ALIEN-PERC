/**
 * Burn Admin Key - IRREVERSIBLE
 *
 * This script permanently burns the admin key by transferring admin authority
 * to the system program (11111111111111111111111111111111).
 *
 * After burning:
 *   - No one can update market parameters
 *   - No one can withdraw the insurance fund
 *   - No one can set oracle authority
 *   - No one can resolve the market
 *   - Trading fees flow to insurance fund FOREVER (soft burn)
 *   - The market runs autonomously via permissionless keeper cranks
 *
 * SAFETY: This script runs verify-before-burn checks first.
 *         It requires typing "BURN" to confirm.
 *
 * Usage:
 *   npx tsx scripts/burn-admin-key.ts
 */

import "dotenv/config";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as readline from "readline";
import { encodeUpdateAdmin, encodeSetOracleAuthority } from "../src/abi/instructions.js";
import { ACCOUNTS_UPDATE_ADMIN, buildAccountMetas } from "../src/abi/accounts.js";
import { parseHeader, parseConfig, parseEngine, fetchSlab } from "../src/solana/slab.js";
import { buildIx } from "../src/runtime/tx.js";

// The "dead" admin address - system program, no private key exists
const DEAD_ADMIN = new PublicKey("11111111111111111111111111111111");

const MARKET_FILE = process.env.MARKET_FILE || "devnet-market.json";

function askQuestion(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ALIEN PERCOLATOR - ADMIN KEY BURN");
  console.log("=".repeat(70));
  console.log("\n  WARNING: THIS ACTION IS IRREVERSIBLE!");
  console.log("  After burning, NO ONE can modify market parameters.\n");

  // ---- Load market info ----
  if (!fs.existsSync(MARKET_FILE)) {
    console.error(`ERROR: ${MARKET_FILE} not found. Run setup-alien-market.ts first.`);
    process.exit(1);
  }
  const marketInfo = JSON.parse(fs.readFileSync(MARKET_FILE, "utf-8"));

  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;

  const connection = new Connection(rpcUrl, "confirmed");
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const slabPk = new PublicKey(marketInfo.slab);

  // ---- Pre-burn verification ----
  console.log("Running pre-burn checks...\n");
  let slabData: Buffer;
  try {
    slabData = await fetchSlab(connection, slabPk);
  } catch (e) {
    console.error(`ABORT: Cannot fetch slab: ${(e as Error).message}`);
    process.exit(1);
  }

  const header = parseHeader(slabData);
  const config = parseConfig(slabData);
  const engine = parseEngine(slabData);

  // Verify admin is current wallet
  if (header.admin.toBase58() !== payer.publicKey.toBase58()) {
    console.error(`ABORT: Current admin is ${header.admin.toBase58()}`);
    console.error(`Your wallet is ${payer.publicKey.toBase58()}`);
    console.error("You must be the current admin to burn the key.");
    process.exit(1);
  }

  // Verify not already burned
  if (header.admin.toBase58() === DEAD_ADMIN.toBase58()) {
    console.log("Admin key is already burned. Nothing to do.");
    process.exit(0);
  }

  // Verify market not resolved
  if (header.resolved) {
    console.error("ABORT: Market is already resolved. Cannot burn admin on resolved market.");
    process.exit(1);
  }

  // Print current state
  console.log("  Current State:");
  console.log(`    Slab:      ${slabPk.toBase58()}`);
  console.log(`    Admin:     ${header.admin.toBase58()}`);
  console.log(`    Inverted:  ${config.invert === 1 ? "Yes" : "No"}`);
  console.log(`    Mint:      ${config.collateralMint.toBase58()}`);
  console.log(`    Insurance: ${engine.insuranceFund.balance} lamports`);
  console.log(`    Fee Rev:   ${engine.insuranceFund.feeRevenue} lamports`);

  const oracleAuth = config.oracleAuthority.toBase58();
  const hasOracleAuth = oracleAuth !== DEAD_ADMIN.toBase58() &&
    oracleAuth !== "11111111111111111111111111111111";

  if (hasOracleAuth) {
    console.log(`\n  Oracle authority is set to: ${oracleAuth}`);
    console.log("  This will also be disabled during the burn.\n");
  }

  // ---- Confirmation ----
  console.log("\n" + "-".repeat(70));
  console.log("  After burning:");
  console.log("    - Admin key -> 11111111111111111111111111111111 (system program)");
  console.log("    - Oracle authority -> disabled (Pyth/Chainlink only)");
  console.log("    - Insurance fund CANNOT be withdrawn (permanent soft burn)");
  console.log("    - Market parameters CANNOT be changed");
  console.log("    - Trading fees flow to insurance FOREVER");
  console.log("-".repeat(70));

  const answer = await askQuestion("\n  Type BURN to confirm (anything else to abort): ");
  if (answer !== "BURN") {
    console.log("\n  Aborted. Admin key NOT burned.\n");
    process.exit(0);
  }

  // ---- Step 1: Disable oracle authority (if set) ----
  if (hasOracleAuth) {
    console.log("\nStep 1: Disabling oracle authority...");
    const disableOracleData = encodeSetOracleAuthority({
      newAuthority: DEAD_ADMIN,
    });

    const disableOracleTx = new Transaction();
    disableOracleTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
    disableOracleTx.add(buildIx({
      programId: new PublicKey(marketInfo.programId),
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: slabPk, isSigner: false, isWritable: true },
      ],
      data: disableOracleData,
    }));

    await sendAndConfirmTransaction(connection, disableOracleTx, [payer], { commitment: "confirmed" });
    console.log("  Oracle authority disabled");
  } else {
    console.log("\nStep 1: Oracle authority already disabled (skipping)");
  }

  // ---- Step 2: Transfer admin to dead address ----
  console.log("\nStep 2: Burning admin key...");
  const burnData = encodeUpdateAdmin({ newAdmin: DEAD_ADMIN });
  const burnKeys = buildAccountMetas(ACCOUNTS_UPDATE_ADMIN, [
    payer.publicKey,  // current admin
    slabPk,           // slab
  ]);

  const burnTx = new Transaction();
  burnTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
  burnTx.add(buildIx({
    programId: new PublicKey(marketInfo.programId),
    keys: burnKeys,
    data: burnData,
  }));

  const sig = await sendAndConfirmTransaction(connection, burnTx, [payer], { commitment: "finalized" });
  console.log(`  Transaction: ${sig}`);

  // ---- Step 3: Verify the burn ----
  console.log("\nStep 3: Verifying burn...");
  const postBurnData = await fetchSlab(connection, slabPk);
  const postHeader = parseHeader(postBurnData);
  const postConfig = parseConfig(postBurnData);

  const adminBurned = postHeader.admin.toBase58() === DEAD_ADMIN.toBase58();
  const oracleBurned = postConfig.oracleAuthority.toBase58() === DEAD_ADMIN.toBase58() ||
    postConfig.oracleAuthority.toBase58() === "11111111111111111111111111111111";

  if (adminBurned && oracleBurned) {
    console.log("  Admin key:        BURNED");
    console.log("  Oracle authority:  DISABLED");
    console.log("\n  VERIFICATION PASSED - Market is now sovereign!");
  } else {
    console.error("  VERIFICATION FAILED!");
    if (!adminBurned) console.error(`  Admin is still: ${postHeader.admin.toBase58()}`);
    if (!oracleBurned) console.error(`  Oracle auth is still: ${postConfig.oracleAuthority.toBase58()}`);
    process.exit(1);
  }

  // ---- Update market info ----
  marketInfo.status = "SOVEREIGN - ADMIN KEY BURNED";
  marketInfo.adminBurnedAt = new Date().toISOString();
  marketInfo.adminBurnTx = sig;
  marketInfo.admin = DEAD_ADMIN.toBase58();
  fs.writeFileSync(MARKET_FILE, JSON.stringify(marketInfo, null, 2));

  // ---- Final summary ----
  console.log("\n" + "=".repeat(70));
  console.log("ADMIN KEY BURNED SUCCESSFULLY");
  console.log("=".repeat(70));
  console.log(`
  The ALIEN Percolator market is now SOVEREIGN.

  What this means:
    - Market runs autonomously via permissionless keeper cranks
    - Trading fees (30bps) flow to insurance fund permanently
    - Insurance fund acts as permanent soft burn for ALIEN tokens
    - No admin can modify, resolve, or withdraw from this market
    - Users can always deposit, trade, and withdraw via the protocol

  Monitor the insurance fund growth:
    npx tsx scripts/monitor-alien-insurance.ts

  Burn TX: ${sig}
`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
