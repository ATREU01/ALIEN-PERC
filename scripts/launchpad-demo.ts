/**
 * ALIEN PERCOLATOR — Full End-to-End Demo
 *
 * Demonstrates every feature of the Percolator protocol on devnet:
 *   1. Push oracle price
 *   2. Init user account
 *   3. Deposit collateral
 *   4. Execute a trade (long)
 *   5. Keeper crank (apply funding)
 *   6. Execute opposite trade (short — close position)
 *   7. Withdraw collateral
 *   8. Show insurance fund growth from fees
 *
 * Run AFTER deploy-alien-devnet.ts has created the market.
 *
 * Usage:
 *   export SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"
 *   npx tsx scripts/launchpad-demo.ts
 */

import "dotenv/config";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import {
  encodeInitUser,
  encodeDepositCollateral,
  encodeWithdrawCollateral,
  encodeKeeperCrank,
  encodePushOraclePrice,
  encodeTradeCpi,
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_USER,
  ACCOUNTS_DEPOSIT_COLLATERAL,
  ACCOUNTS_WITHDRAW_COLLATERAL,
  ACCOUNTS_KEEPER_CRANK,
  ACCOUNTS_PUSH_ORACLE_PRICE,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveVaultAuthority } from "../src/solana/pda.js";
import { fetchSlab, parseHeader, parseConfig, parseEngine, parseUsedIndices, parseAccount, AccountKind } from "../src/solana/slab.js";
import { buildIx } from "../src/runtime/tx.js";

// ============================================================================
// LOAD
// ============================================================================

const MARKET_FILE = process.env.MARKET_FILE || "devnet-market.json";
if (!fs.existsSync(MARKET_FILE)) {
  console.error(`ERROR: ${MARKET_FILE} not found. Run deploy-alien-devnet.ts first.`);
  process.exit(1);
}

const marketInfo = JSON.parse(fs.readFileSync(MARKET_FILE, "utf-8"));
const PROGRAM_ID = new PublicKey(marketInfo.programId);
const MATCHER_PROGRAM_ID = new PublicKey(marketInfo.matcherProgramId);

const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;

const ONE_TOKEN = 10 ** (marketInfo.tokenDecimals || 6);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  ALIEN PERCOLATOR — FULL DEMO");
  console.log("=".repeat(70));
  console.log(`\n  Market: ${marketInfo.slab}`);
  console.log(`  Network: ${marketInfo.network}`);
  console.log(`  RPC: ${rpcUrl}\n`);

  const connection = new Connection(rpcUrl, "confirmed");
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  console.log(`  Wallet: ${payer.publicKey.toBase58()}`);

  const slabPk = new PublicKey(marketInfo.slab);
  const mint = new PublicKey(marketInfo.mint);
  const vault = new PublicKey(marketInfo.vault);

  // Get initial state
  let slabData = await fetchSlab(connection, slabPk);
  let engine = parseEngine(slabData);
  const initialInsurance = BigInt(engine.insuranceFund?.balance || 0);
  console.log(`  Initial insurance fund: ${Number(initialInsurance) / ONE_TOKEN} tokens\n`);

  // ============================================================================
  // STEP 1: Push fresh oracle price
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 1: Push fresh oracle price ($0.001)");
  console.log("-".repeat(70));

  const priceE6 = "1000"; // $0.001
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const pushData = encodePushOraclePrice({
    priceE6,
    timestamp: timestamp.toString(),
  });
  const pushKeys = buildAccountMetas(ACCOUNTS_PUSH_ORACLE_PRICE, [
    payer.publicKey,
    slabPk,
  ]);
  const pushTx = new Transaction();
  pushTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
  pushTx.add(buildIx({ programId: PROGRAM_ID, keys: pushKeys, data: pushData }));

  const pushSig = await sendAndConfirmTransaction(connection, pushTx, [payer], { commitment: "confirmed" });
  console.log(`  Price: $0.001 (e6: 1000)`);
  console.log(`  TX: ${pushSig}\n`);

  await delay(1000);

  // ============================================================================
  // STEP 2: Keeper crank
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 2: Run keeper crank");
  console.log("-".repeat(70));

  const crankData = encodeKeeperCrank({ callerIdx: 65535, allowPanic: false });
  const crankKeys = buildAccountMetas(ACCOUNTS_KEEPER_CRANK, [
    payer.publicKey,
    slabPk,
    SYSVAR_CLOCK_PUBKEY,
    slabPk, // dummy oracle for Hyperp
  ]);
  const crankTx = new Transaction();
  crankTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  crankTx.add(buildIx({ programId: PROGRAM_ID, keys: crankKeys, data: crankData }));

  const crankSig = await sendAndConfirmTransaction(connection, crankTx, [payer], {
    commitment: "confirmed",
    skipPreflight: true,
  });
  console.log(`  Crank executed`);
  console.log(`  TX: ${crankSig}\n`);

  await delay(1000);

  // ============================================================================
  // STEP 3: Init trader account
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 3: Init trader account");
  console.log("-".repeat(70));

  const userAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, payer.publicKey
  );

  const initUserData = encodeInitUser({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: new PublicKey(marketInfo.lp.matcherContext),
    feePayment: (1 * ONE_TOKEN).toString(),
  });
  const initUserKeys = buildAccountMetas(ACCOUNTS_INIT_USER, [
    payer.publicKey,
    slabPk,
    userAta.address,
    vault,
    TOKEN_PROGRAM_ID,
  ]);
  const initUserTx = new Transaction();
  initUserTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  initUserTx.add(buildIx({ programId: PROGRAM_ID, keys: initUserKeys, data: initUserData }));

  try {
    const initSig = await sendAndConfirmTransaction(connection, initUserTx, [payer], { commitment: "confirmed" });
    console.log(`  New user account created`);
    console.log(`  TX: ${initSig}\n`);
  } catch (e: any) {
    if (e.message?.includes("already")) {
      console.log("  User account already exists (skipping)\n");
    } else {
      throw e;
    }
  }

  await delay(1000);

  // Find user index
  slabData = await fetchSlab(connection, slabPk);
  let userIdx = -1;
  for (const idx of parseUsedIndices(slabData)) {
    const acc = parseAccount(slabData, idx);
    if (acc && acc.kind === AccountKind.User && acc.owner.toBase58() === payer.publicKey.toBase58()) {
      userIdx = idx;
      break;
    }
  }
  if (userIdx < 0) {
    console.error("ERROR: Could not find user account");
    process.exit(1);
  }
  console.log(`  User index: ${userIdx}`);

  // ============================================================================
  // STEP 4: Deposit collateral (1M tokens)
  // ============================================================================
  console.log("\n" + "-".repeat(70));
  console.log("  STEP 4: Deposit 1,000,000 Alienator tokens");
  console.log("-".repeat(70));

  const depositAmount = BigInt(1_000_000) * BigInt(ONE_TOKEN);
  const depositData = encodeDepositCollateral({
    userIdx,
    amount: depositAmount.toString(),
  });
  const depositKeys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
    payer.publicKey,
    slabPk,
    userAta.address,
    vault,
    TOKEN_PROGRAM_ID,
    SYSVAR_CLOCK_PUBKEY,
  ]);
  const depositTx = new Transaction();
  depositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  depositTx.add(buildIx({ programId: PROGRAM_ID, keys: depositKeys, data: depositData }));

  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [payer], { commitment: "confirmed" });
  console.log(`  Deposited: 1,000,000 Alienator tokens`);
  console.log(`  TX: ${depositSig}\n`);

  await delay(1000);

  // ============================================================================
  // STEP 5: Crank again to update funding after deposit
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 5: Keeper crank (post-deposit)");
  console.log("-".repeat(70));

  const crankTx2 = new Transaction();
  crankTx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  crankTx2.add(buildIx({ programId: PROGRAM_ID, keys: crankKeys, data: crankData }));
  const crankSig2 = await sendAndConfirmTransaction(connection, crankTx2, [payer], {
    commitment: "confirmed",
    skipPreflight: true,
  });
  console.log(`  Crank executed`);
  console.log(`  TX: ${crankSig2}\n`);

  await delay(1000);

  // ============================================================================
  // STEP 6: Withdraw some collateral back
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 6: Withdraw 100,000 tokens (partial withdrawal)");
  console.log("-".repeat(70));

  const [vaultPda] = deriveVaultAuthority(PROGRAM_ID, slabPk);
  const withdrawAmount = BigInt(100_000) * BigInt(ONE_TOKEN);
  const withdrawData = encodeWithdrawCollateral({
    userIdx,
    amount: withdrawAmount.toString(),
  });
  const withdrawKeys = buildAccountMetas(ACCOUNTS_WITHDRAW_COLLATERAL, [
    payer.publicKey,
    slabPk,
    userAta.address,
    vault,
    TOKEN_PROGRAM_ID,
    vaultPda,
    SYSVAR_CLOCK_PUBKEY,
  ]);
  const withdrawTx = new Transaction();
  withdrawTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  withdrawTx.add(buildIx({ programId: PROGRAM_ID, keys: withdrawKeys, data: withdrawData }));

  const withdrawSig = await sendAndConfirmTransaction(connection, withdrawTx, [payer], { commitment: "confirmed" });
  console.log(`  Withdrew: 100,000 Alienator tokens`);
  console.log(`  TX: ${withdrawSig}\n`);

  await delay(1000);

  // ============================================================================
  // STEP 7: Final state check
  // ============================================================================
  console.log("-".repeat(70));
  console.log("  STEP 7: Final market state");
  console.log("-".repeat(70));

  slabData = await fetchSlab(connection, slabPk);
  const header = parseHeader(slabData);
  const config = parseConfig(slabData);
  engine = parseEngine(slabData);
  const usedIndices = parseUsedIndices(slabData);
  const finalInsurance = BigInt(engine.insuranceFund?.balance || 0);

  console.log(`  Admin:          ${header.admin.toBase58()}`);
  console.log(`  Resolved:       ${header.resolved ? "YES" : "NO"}`);
  console.log(`  Inverted:       ${config.invert === 1 ? "YES" : "NO"}`);
  console.log(`  Oracle Auth:    ${config.oracleAuthority.toBase58()}`);
  console.log(`  Mark Price:     ${config.authorityPriceE6} e6`);
  console.log(`  Accounts:       ${usedIndices.length}`);
  console.log(`  Insurance:      ${Number(finalInsurance) / ONE_TOKEN} tokens`);
  console.log(`  Fee Revenue:    ${Number(engine.insuranceFund?.feeRevenue || 0) / ONE_TOKEN} tokens`);
  console.log(`  C_tot:          ${Number(engine.cTot) / ONE_TOKEN} tokens`);

  const insuranceDelta = Number(finalInsurance - initialInsurance) / ONE_TOKEN;
  if (insuranceDelta > 0) {
    console.log(`  Insurance Δ:    +${insuranceDelta} tokens (from fees!)`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(70));
  console.log("  DEMO COMPLETE!");
  console.log("=".repeat(70));
  console.log(`
  Demonstrated features:
    [x] Oracle price push (Hyperp admin authority)
    [x] Keeper crank (permissionless funding)
    [x] User account initialization
    [x] Collateral deposit
    [x] Collateral withdrawal
    [x] Insurance fund tracking

  Ready for burn:
    npx tsx scripts/verify-before-burn.ts
    npx tsx scripts/burn-admin-key.ts

  After burn:
    - Market becomes SOVEREIGN (1/1 BURNED on dashboard)
    - No one can modify parameters ever again
    - Trading fees compound in insurance fund forever
    - Oracle authority disabled (price from Hyperp only)
`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("\nDEMO FAILED:", err.message || err);
  console.error(err);
  process.exit(1);
});
