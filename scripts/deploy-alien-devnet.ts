/**
 * Deploy $Alienator Percolator Market on Devnet
 *
 * Creates an inverted ALIENATOR/USD perpetual market using Hyperp mode
 * (admin oracle authority — no external oracle needed for a memecoin).
 *
 * Deposit the memecoin as collateral, trade USD perps.
 * Insurance fund compounds forever from fees (soft burn).
 *
 * Usage:
 *   npx tsx scripts/deploy-alien-devnet.ts
 *
 * Requirements:
 *   - Devnet wallet at ~/.config/solana/id.json with ~10 SOL
 *   - Run: solana config set --url devnet && solana airdrop 2 (repeat a few times)
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
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import {
  encodeInitMarket,
  encodeInitLP,
  encodeDepositCollateral,
  encodeTopUpInsurance,
  encodeKeeperCrank,
  encodeSetOracleAuthority,
  encodePushOraclePrice,
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_MARKET,
  ACCOUNTS_INIT_LP,
  ACCOUNTS_DEPOSIT_COLLATERAL,
  ACCOUNTS_TOPUP_INSURANCE,
  ACCOUNTS_KEEPER_CRANK,
  ACCOUNTS_SET_ORACLE_AUTHORITY,
  ACCOUNTS_PUSH_ORACLE_PRICE,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveVaultAuthority, deriveLpPda } from "../src/solana/pda.js";
import { fetchSlab, parseHeader, parseConfig, parseEngine, parseUsedIndices, parseAccount, AccountKind } from "../src/solana/slab.js";
import { buildIx } from "../src/runtime/tx.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const MATCHER_PROGRAM_ID = new PublicKey("4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy");
const MATCHER_CTX_SIZE = 320;
const SLAB_SIZE = 992560;

// Token config: 6 decimals (matches pump.fun convention)
const TOKEN_DECIMALS = 6;
const ONE_TOKEN = 10 ** TOKEN_DECIMALS; // 1_000_000

// Amounts in token lamports (6 decimals)
const MINT_SUPPLY = BigInt(1_000_000_000) * BigInt(ONE_TOKEN);   // 1 billion tokens
const LP_COLLATERAL = BigInt(100_000_000) * BigInt(ONE_TOKEN);   // 100M tokens for LP
const INSURANCE_AMOUNT = BigInt(10_000_000) * BigInt(ONE_TOKEN); // 10M tokens for insurance

// Initial price: $0.001 in e6 format = 1000
// For inverted market: internal price = 1 / 0.001 = 1000 USD per token unit
// But PushOraclePrice takes the raw price, and inversion is applied by the engine
const INITIAL_PRICE_E6 = "1000"; // $0.001

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("  ALIENATOR PERCOLATOR — DEVNET DEPLOYMENT");
  console.log("=".repeat(70));
  console.log("\n  Sovereign perpetual futures for the $Alienator memecoin.");
  console.log("  Hyperp mode — admin oracle authority, no external oracle needed.");
  console.log("  Inverted market — deposit Alienator, trade USD perps.\n");

  // Setup connection and wallet
  const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
  if (!fs.existsSync(walletPath)) {
    console.error(`ERROR: Wallet not found at ${walletPath}`);
    console.error("Run: solana-keygen new");
    process.exit(1);
  }
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`  Wallet:  ${payer.publicKey.toBase58()}`);
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`  RPC:     ${rpcUrl}\n`);

  if (balance < 8 * LAMPORTS_PER_SOL) {
    console.error("ERROR: Need at least 8 SOL. Run: solana airdrop 2 (repeat a few times)");
    process.exit(1);
  }

  // ============================================================================
  // STEP 1: Create devnet Alienator token
  // ============================================================================
  console.log("Step 1/13: Creating devnet Alienator token (6 decimals)...");

  const alienMint = await createMint(
    connection,
    payer,
    payer.publicKey,  // mint authority
    payer.publicKey,  // freeze authority
    TOKEN_DECIMALS,
  );
  console.log(`  Mint: ${alienMint.toBase58()}`);

  // ============================================================================
  // STEP 2: Mint 1B tokens to admin wallet
  // ============================================================================
  console.log("\nStep 2/13: Minting 1B Alienator tokens...");

  const adminAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, alienMint, payer.publicKey
  );
  await mintTo(
    connection, payer, alienMint, adminAta.address, payer.publicKey, MINT_SUPPLY
  );
  console.log(`  Admin ATA: ${adminAta.address.toBase58()}`);
  console.log(`  Minted: ${Number(MINT_SUPPLY) / ONE_TOKEN} tokens`);

  // ============================================================================
  // STEP 3: Create 992KB slab account
  // ============================================================================
  console.log("\nStep 3/13: Creating slab account...");

  const slab = Keypair.generate();
  const rentExempt = await connection.getMinimumBalanceForRentExemption(SLAB_SIZE);
  console.log(`  Slab:    ${slab.publicKey.toBase58()}`);
  console.log(`  Rent:    ${(rentExempt / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const createSlabTx = new Transaction();
  createSlabTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  createSlabTx.add(SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: slab.publicKey,
    lamports: rentExempt,
    space: SLAB_SIZE,
    programId: PROGRAM_ID,
  }));
  await sendAndConfirmTransaction(connection, createSlabTx, [payer, slab], { commitment: "confirmed" });
  console.log("  Slab created");

  await delay(1000);

  // ============================================================================
  // STEP 4: Derive vault PDA + create vault ATA
  // ============================================================================
  console.log("\nStep 4/13: Setting up vault...");

  const [vaultPda] = deriveVaultAuthority(PROGRAM_ID, slab.publicKey);
  const vaultAccount = await getOrCreateAssociatedTokenAccount(
    connection, payer, alienMint, vaultPda, true
  );
  const vault = vaultAccount.address;
  console.log(`  Vault PDA: ${vaultPda.toBase58()}`);
  console.log(`  Vault ATA: ${vault.toBase58()}`);

  // ============================================================================
  // STEP 5: Initialize market (Hyperp mode, inverted)
  // ============================================================================
  console.log("\nStep 5/13: Initializing INVERTED Hyperp market...");

  const initMarketData = encodeInitMarket({
    admin: payer.publicKey,
    collateralMint: alienMint,
    indexFeedId: "0".repeat(64),         // All zeros = Hyperp mode
    maxStalenessSecs: "86400",           // 24h (generous for devnet)
    confFilterBps: 1000,                 // 10% confidence filter
    invert: 1,                           // INVERTED — deposit memecoin, trade USD
    unitScale: 0,                        // No scaling
    initialMarkPriceE6: INITIAL_PRICE_E6,// $0.001 initial mark price
    warmupPeriodSlots: "10",             // Short warmup for devnet
    maintenanceMarginBps: "1000",        // 10% maintenance margin
    initialMarginBps: "2000",            // 20% initial margin (5x max leverage)
    tradingFeeBps: "30",                 // 0.3% trading fee → feeds insurance
    maxAccounts: "1024",
    newAccountFee: (1 * ONE_TOKEN).toString(), // 1 Alienator to create account
    riskReductionThreshold: "0",
    maintenanceFeePerSlot: "0",
    maxCrankStalenessSlots: "200",
    liquidationFeeBps: "200",            // 2% liquidation fee
    liquidationFeeCap: (1000000 * ONE_TOKEN).toString(),
    liquidationBufferBps: "50",
    minLiquidationAbs: (100 * ONE_TOKEN).toString(),
  });

  const initMarketKeys = buildAccountMetas(ACCOUNTS_INIT_MARKET, [
    payer.publicKey,
    slab.publicKey,
    alienMint,
    vault,
    TOKEN_PROGRAM_ID,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    vaultPda,
    SystemProgram.programId,
  ]);

  const initTx = new Transaction();
  initTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
  initTx.add(buildIx({ programId: PROGRAM_ID, keys: initMarketKeys, data: initMarketData }));
  await sendAndConfirmTransaction(connection, initTx, [payer], { commitment: "confirmed" });
  console.log("  Market initialized (Hyperp, inverted)");
  console.log(`  Initial mark price: ${INITIAL_PRICE_E6} (${Number(INITIAL_PRICE_E6) / 1e6} USD)`);

  await delay(1000);

  // ============================================================================
  // STEP 6: Set oracle authority to admin
  // ============================================================================
  console.log("\nStep 6/13: Setting oracle authority to admin...");

  const setAuthData = encodeSetOracleAuthority({ newAuthority: payer.publicKey });
  const setAuthKeys = buildAccountMetas(ACCOUNTS_SET_ORACLE_AUTHORITY, [
    payer.publicKey,
    slab.publicKey,
  ]);
  const setAuthTx = new Transaction();
  setAuthTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
  setAuthTx.add(buildIx({ programId: PROGRAM_ID, keys: setAuthKeys, data: setAuthData }));
  await sendAndConfirmTransaction(connection, setAuthTx, [payer], { commitment: "confirmed" });
  console.log(`  Oracle authority: ${payer.publicKey.toBase58()}`);

  // ============================================================================
  // STEP 7: Push initial oracle price
  // ============================================================================
  console.log("\nStep 7/13: Pushing initial oracle price...");

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const pushData = encodePushOraclePrice({
    priceE6: INITIAL_PRICE_E6,
    timestamp: timestamp.toString(),
  });
  const pushKeys = buildAccountMetas(ACCOUNTS_PUSH_ORACLE_PRICE, [
    payer.publicKey,
    slab.publicKey,
  ]);
  const pushTx = new Transaction();
  pushTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
  pushTx.add(buildIx({ programId: PROGRAM_ID, keys: pushKeys, data: pushData }));
  await sendAndConfirmTransaction(connection, pushTx, [payer], { commitment: "confirmed" });
  console.log(`  Price pushed: ${INITIAL_PRICE_E6} e6 ($${Number(INITIAL_PRICE_E6) / 1e6})`);

  await delay(1000);

  // ============================================================================
  // STEP 8: Run keeper crank (slab as dummy oracle — Hyperp mode)
  // ============================================================================
  console.log("\nStep 8/13: Running keeper crank...");

  const crankData = encodeKeeperCrank({ callerIdx: 65535, allowPanic: false });
  const crankKeys = buildAccountMetas(ACCOUNTS_KEEPER_CRANK, [
    payer.publicKey,
    slab.publicKey,
    SYSVAR_CLOCK_PUBKEY,
    slab.publicKey,  // Dummy oracle — not used in Hyperp mode
  ]);
  const crankTx = new Transaction();
  crankTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }));
  crankTx.add(buildIx({ programId: PROGRAM_ID, keys: crankKeys, data: crankData }));
  await sendAndConfirmTransaction(connection, crankTx, [payer], { commitment: "confirmed", skipPreflight: true });
  console.log("  Keeper crank executed");

  await delay(1000);

  // ============================================================================
  // STEP 9: Create passive matcher LP (50bps) atomically
  // ============================================================================
  console.log("\nStep 9/13: Creating LP with passive matcher (50bps)...");

  // Create matcher context account
  const matcherCtxKp = Keypair.generate();
  const matcherRent = await connection.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);

  const createMatcherTx = new Transaction();
  createMatcherTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  createMatcherTx.add(SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: matcherCtxKp.publicKey,
    lamports: matcherRent,
    space: MATCHER_CTX_SIZE,
    programId: MATCHER_PROGRAM_ID,
  }));
  await sendAndConfirmTransaction(connection, createMatcherTx, [payer, matcherCtxKp], { commitment: "confirmed" });
  console.log(`  Matcher context: ${matcherCtxKp.publicKey.toBase58()}`);

  // Initialize LP account
  const initLpData = encodeInitLP({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: matcherCtxKp.publicKey,
    feePayment: (1 * ONE_TOKEN).toString(),
  });
  const initLpKeys = buildAccountMetas(ACCOUNTS_INIT_LP, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
  ]);
  const initLpTx = new Transaction();
  initLpTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  initLpTx.add(buildIx({ programId: PROGRAM_ID, keys: initLpKeys, data: initLpData }));
  await sendAndConfirmTransaction(connection, initLpTx, [payer], { commitment: "confirmed" });

  // Find LP index
  await delay(500);
  let slabData = await fetchSlab(connection, slab.publicKey);
  let lpIndex = 0;
  for (const idx of parseUsedIndices(slabData)) {
    const acc = parseAccount(slabData, idx);
    if (acc && acc.kind === AccountKind.LP) {
      lpIndex = idx;
      break;
    }
  }

  // Derive LP PDA
  const [lpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, lpIndex);
  console.log(`  LP index: ${lpIndex}`);
  console.log(`  LP PDA:   ${lpPda.toBase58()}`);

  // Initialize matcher context with LP PDA (tag=2, Passive mode)
  const matcherInitData = Buffer.alloc(66);
  matcherInitData[0] = 2;   // MATCHER_INIT_VAMM_TAG
  matcherInitData[1] = 0;   // kind = Passive
  matcherInitData.writeUInt32LE(5, 2);     // trading_fee_bps = 5 (0.05%)
  matcherInitData.writeUInt32LE(50, 6);    // base_spread_bps = 50 (0.5%)
  matcherInitData.writeUInt32LE(200, 10);  // max_total_bps = 200 (2%)
  matcherInitData.writeUInt32LE(0, 14);    // impact_k_bps = 0 (passive, no impact)
  // liquidity_notional_e6 = 0 (u128 at offset 18, passive allows 0)
  // max_fill_abs = large (u128 at offset 34)
  matcherInitData.writeBigUInt64LE(1_000_000_000_000n, 34);
  // max_inventory_abs = 0 (u128 at offset 50, no limit)

  const matcherInitTx = new Transaction();
  matcherInitTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  matcherInitTx.add({
    programId: MATCHER_PROGRAM_ID,
    keys: [
      { pubkey: lpPda, isSigner: false, isWritable: false },
      { pubkey: matcherCtxKp.publicKey, isSigner: false, isWritable: true },
    ],
    data: matcherInitData,
  });
  await sendAndConfirmTransaction(connection, matcherInitTx, [payer], { commitment: "confirmed" });
  console.log("  Matcher initialized (Passive, fee=5bps, spread=50bps)");

  await delay(1000);

  // ============================================================================
  // STEP 10: Deposit LP collateral
  // ============================================================================
  console.log("\nStep 10/13: Depositing LP collateral...");

  const depositData = encodeDepositCollateral({
    userIdx: lpIndex,
    amount: LP_COLLATERAL.toString(),
  });
  const depositKeys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
    SYSVAR_CLOCK_PUBKEY,
  ]);
  const depositTx = new Transaction();
  depositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  depositTx.add(buildIx({ programId: PROGRAM_ID, keys: depositKeys, data: depositData }));
  await sendAndConfirmTransaction(connection, depositTx, [payer], { commitment: "confirmed" });
  console.log(`  Deposited ${Number(LP_COLLATERAL) / ONE_TOKEN} Alienator tokens to LP`);

  // ============================================================================
  // STEP 11: Top up insurance fund
  // ============================================================================
  console.log("\nStep 11/13: Seeding insurance fund...");

  const topupData = encodeTopUpInsurance({ amount: INSURANCE_AMOUNT.toString() });
  const topupKeys = buildAccountMetas(ACCOUNTS_TOPUP_INSURANCE, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
  ]);
  const topupTx = new Transaction();
  topupTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  topupTx.add(buildIx({ programId: PROGRAM_ID, keys: topupKeys, data: topupData }));
  await sendAndConfirmTransaction(connection, topupTx, [payer], { commitment: "confirmed" });
  console.log(`  Insurance: ${Number(INSURANCE_AMOUNT) / ONE_TOKEN} Alienator tokens`);

  await delay(1000);

  // ============================================================================
  // STEP 12: Verify market state
  // ============================================================================
  console.log("\nStep 12/13: Verifying market state...");

  const finalSlabInfo = await fetchSlab(connection, slab.publicKey);
  const header = parseHeader(finalSlabInfo);
  const config = parseConfig(finalSlabInfo);
  const engine = parseEngine(finalSlabInfo);

  console.log(`  Version:      ${header.version}`);
  console.log(`  Admin:        ${header.admin.toBase58()}`);
  console.log(`  Inverted:     ${config.invert === 1 ? "YES" : "NO"}`);
  console.log(`  Oracle Auth:  ${config.oracleAuthority.toBase58()}`);
  console.log(`  Mark Price:   ${config.authorityPriceE6} e6`);
  console.log(`  Index Price:  ${config.lastEffectivePriceE6} e6`);
  console.log(`  Insurance:    ${Number(engine.insuranceFund.balance) / ONE_TOKEN} tokens`);
  console.log(`  C_tot:        ${Number(engine.cTot) / ONE_TOKEN} tokens`);

  const isHyperp = config.indexFeedId.toBytes().every((b: number) => b === 0);
  console.log(`  Hyperp mode:  ${isHyperp ? "YES" : "NO"}`);

  // ============================================================================
  // STEP 13: Save output
  // ============================================================================
  console.log("\nStep 13/13: Saving market info...");

  const marketInfo = {
    network: "devnet",
    createdAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
    slab: slab.publicKey.toBase58(),
    mint: alienMint.toBase58(),
    vault: vault.toBase58(),
    vaultPda: vaultPda.toBase58(),
    oracle: slab.publicKey.toBase58(),  // Hyperp = slab as dummy oracle
    oracleType: "hyperp",
    oracleAuthority: payer.publicKey.toBase58(),
    inverted: true,
    tokenDecimals: TOKEN_DECIMALS,
    initialPriceE6: Number(INITIAL_PRICE_E6),
    lp: {
      index: lpIndex,
      pda: lpPda.toBase58(),
      matcherContext: matcherCtxKp.publicKey.toBase58(),
      collateral: Number(LP_COLLATERAL) / ONE_TOKEN,
    },
    insuranceFund: Number(INSURANCE_AMOUNT) / ONE_TOKEN,
    admin: payer.publicKey.toBase58(),
    adminAta: adminAta.address.toBase58(),
  };

  fs.writeFileSync("devnet-market.json", JSON.stringify(marketInfo, null, 2));
  console.log("  Saved to devnet-market.json");

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log("\n" + "=".repeat(70));
  console.log("  ALIENATOR MARKET DEPLOYED!");
  console.log("=".repeat(70));
  console.log(`
  Slab:            ${slab.publicKey.toBase58()}
  Mint:            ${alienMint.toBase58()}
  Vault:           ${vault.toBase58()}
  Oracle Type:     Hyperp (admin push)
  Oracle Auth:     ${payer.publicKey.toBase58()}
  Market Type:     INVERTED (deposit Alienator, trade USD perps)
  Initial Price:   $${Number(INITIAL_PRICE_E6) / 1e6}

  LP (Passive Matcher — 50bps spread):
    Index:         ${lpIndex}
    PDA:           ${lpPda.toBase58()}
    Matcher Ctx:   ${matcherCtxKp.publicKey.toBase58()}
    Collateral:    ${Number(LP_COLLATERAL) / ONE_TOKEN} tokens

  Insurance Fund:  ${Number(INSURANCE_AMOUNT) / ONE_TOKEN} tokens (soft burn — grows forever)

  Admin:           ${payer.publicKey.toBase58()}
  `);

  console.log("  NEXT STEPS:");
  console.log("  1. Copy the Slab address above");
  console.log("  2. Update ui/src/lib/constants.ts KNOWN_MARKETS with the new slab + mint");
  console.log("  3. Push to git — Railway auto-deploys");
  console.log("  4. To push price: npx tsx scripts/push-alien-price.ts <price_usd>");
  console.log("  5. To run crank: npx tsx scripts/crank-bot.ts");
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("\nDEPLOYMENT FAILED:", err.message || err);
  process.exit(1);
});
