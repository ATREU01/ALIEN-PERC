/**
 * Setup ALIEN Sovereign Percolator Market (Mainnet)
 *
 * Creates an inverted ALIEN/USD perpetual futures market where:
 * - Collateral: ALIEN memecoin tokens
 * - Price model: Inverted (price = 1/ALIEN_USD), so traders get USD-denominated exposure
 * - Insurance fund: Seeded and grows from trading fees (soft burn after admin key burn)
 * - Risk params: Tuned for memecoin volatility (higher margins, wider spreads)
 *
 * After this script succeeds, run:
 *   1. npx tsx scripts/verify-before-burn.ts   (verify everything is correct)
 *   2. npx tsx scripts/burn-admin-key.ts        (permanently burn admin key)
 *
 * Usage:
 *   ALIEN_MINT=<mint_pubkey> ALIEN_ORACLE_FEED=<pyth_feed_hex> npx tsx scripts/setup-alien-market.ts
 *
 * Required env vars:
 *   ALIEN_MINT           - ALIEN token SPL mint address
 *   ALIEN_ORACLE_FEED    - Pyth Pull feed ID for ALIEN/USD (64 hex chars)
 *   WALLET_PATH          - Path to wallet keypair (default: ~/.config/solana/id.json)
 *   SOLANA_RPC_URL       - Mainnet RPC URL (default: https://api.mainnet-beta.solana.com)
 *
 * Optional env vars:
 *   INSURANCE_AMOUNT     - Initial insurance fund amount in token lamports (default: 1000000000)
 *   LP_COLLATERAL        - Initial LP collateral in token lamports (default: 1000000000)
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
} from "../src/abi/instructions.js";
import {
  ACCOUNTS_INIT_MARKET,
  ACCOUNTS_INIT_LP,
  ACCOUNTS_DEPOSIT_COLLATERAL,
  ACCOUNTS_TOPUP_INSURANCE,
  ACCOUNTS_KEEPER_CRANK,
  buildAccountMetas,
} from "../src/abi/accounts.js";
import { deriveVaultAuthority, deriveLpPda } from "../src/solana/pda.js";
import { parseHeader, parseConfig, parseEngine, parseUsedIndices } from "../src/solana/slab.js";
import { buildIx } from "../src/runtime/tx.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Program IDs (same as upstream percolator)
const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const MATCHER_PROGRAM_ID = new PublicKey("4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy");
const MATCHER_CTX_SIZE = 320;

// Slab account size (supports up to 4096 accounts)
const SLAB_SIZE = 992560;

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: Missing required environment variable: ${name}`);
    console.error(`\nUsage:`);
    console.error(`  ALIEN_MINT=<pubkey> ALIEN_ORACLE_FEED=<hex> npx tsx scripts/setup-alien-market.ts`);
    process.exit(1);
  }
  return value;
}

// ============================================================================
// vAMM ENCODER
// ============================================================================

function encodeInitVamm(params: {
  mode: number;
  tradingFeeBps: number;
  baseSpreadBps: number;
  maxTotalBps: number;
  impactKBps: number;
  liquidityNotionalE6: bigint;
  maxFillAbs: bigint;
  maxInventoryAbs: bigint;
}): Buffer {
  const data = Buffer.alloc(66);
  let offset = 0;
  data.writeUInt8(2, offset); offset += 1;  // Tag 2 = InitVamm
  data.writeUInt8(params.mode, offset); offset += 1;
  data.writeUInt32LE(params.tradingFeeBps, offset); offset += 4;
  data.writeUInt32LE(params.baseSpreadBps, offset); offset += 4;
  data.writeUInt32LE(params.maxTotalBps, offset); offset += 4;
  data.writeUInt32LE(params.impactKBps, offset); offset += 4;
  const liq = params.liquidityNotionalE6;
  data.writeBigUInt64LE(liq & 0xFFFFFFFFFFFFFFFFn, offset); offset += 8;
  data.writeBigUInt64LE(liq >> 64n, offset); offset += 8;
  const maxFill = params.maxFillAbs;
  data.writeBigUInt64LE(maxFill & 0xFFFFFFFFFFFFFFFFn, offset); offset += 8;
  data.writeBigUInt64LE(maxFill >> 64n, offset); offset += 8;
  const maxInv = params.maxInventoryAbs;
  data.writeBigUInt64LE(maxInv & 0xFFFFFFFFFFFFFFFFn, offset); offset += 8;
  data.writeBigUInt64LE(maxInv >> 64n, offset); offset += 8;
  return data;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("ALIEN SOVEREIGN PERCOLATOR - MAINNET MARKET SETUP");
  console.log("=".repeat(70));
  console.log("\nThis creates an inverted ALIEN/USD perpetual futures market.");
  console.log("Collateral: ALIEN tokens | Price: 1/ALIEN_USD | Fees → Insurance Fund\n");

  // ---- Validate environment ----
  const alienMintStr = requireEnv("ALIEN_MINT");
  const alienOracleFeed = requireEnv("ALIEN_ORACLE_FEED");
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;

  // Parse ALIEN mint
  let alienMint: PublicKey;
  try {
    alienMint = new PublicKey(alienMintStr);
  } catch {
    console.error(`ERROR: Invalid ALIEN_MINT pubkey: ${alienMintStr}`);
    process.exit(1);
  }

  // Validate oracle feed ID (64 hex chars)
  const feedHex = alienOracleFeed.startsWith("0x") ? alienOracleFeed.slice(2) : alienOracleFeed;
  if (feedHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(feedHex)) {
    console.error(`ERROR: Invalid ALIEN_ORACLE_FEED. Must be 64 hex chars. Got: ${alienOracleFeed}`);
    process.exit(1);
  }

  // Funding amounts
  const insuranceAmount = BigInt(process.env.INSURANCE_AMOUNT || "1000000000");
  const lpCollateral = BigInt(process.env.LP_COLLATERAL || "1000000000");

  // ---- Setup connection & wallet ----
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Network:    ${rpcUrl}`);
  console.log(`Wallet:     ${payer.publicKey.toBase58()}`);
  console.log(`ALIEN Mint: ${alienMint.toBase58()}`);
  console.log(`Oracle:     ${alienOracleFeed}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`SOL Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (balance < 5 * LAMPORTS_PER_SOL) {
    console.error("ERROR: Need at least 5 SOL for rent + fees. Current balance too low.");
    process.exit(1);
  }

  // ---- Step 1: Create slab account ----
  console.log("Step 1: Creating slab account...");
  const slab = Keypair.generate();
  console.log(`  Slab: ${slab.publicKey.toBase58()}`);

  const rentExempt = await connection.getMinimumBalanceForRentExemption(SLAB_SIZE);
  console.log(`  Rent: ${(rentExempt / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

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

  // ---- Step 2: Derive vault PDA & create vault ATA ----
  console.log("\nStep 2: Setting up vault...");
  const [vaultPda, vaultBump] = deriveVaultAuthority(PROGRAM_ID, slab.publicKey);
  console.log(`  Vault PDA: ${vaultPda.toBase58()}`);

  const vaultAccount = await getOrCreateAssociatedTokenAccount(
    connection, payer, alienMint, vaultPda, true
  );
  const vault = vaultAccount.address;
  console.log(`  Vault ATA: ${vault.toBase58()}`);

  // ---- Step 3: Initialize INVERTED market ----
  // Memecoin risk parameters (conservative for volatile assets):
  //   - 20% initial margin (vs 10% for major assets)
  //   - 10% maintenance margin (vs 5% for major assets)
  //   - 30bps trading fee (vs 10bps) → faster insurance fund growth
  //   - 200bps liquidation fee (vs 100bps) → stronger incentive for keepers
  //   - Higher oracle staleness tolerance for less liquid feeds
  console.log("\nStep 3: Initializing INVERTED ALIEN/USD market...");
  console.log("  Risk params tuned for memecoin volatility:");
  console.log("    Initial margin:    20%  (2000 bps)");
  console.log("    Maintenance margin: 10%  (1000 bps)");
  console.log("    Trading fee:        0.3% (30 bps)");
  console.log("    Liquidation fee:    2%   (200 bps)");

  const initMarketData = encodeInitMarket({
    admin: payer.publicKey,
    collateralMint: alienMint,
    indexFeedId: feedHex,
    maxStalenessSecs: "120",              // 2 min staleness (mainnet oracles update fast)
    confFilterBps: 1000,                  // 10% confidence filter (memecoins have wide bands)
    invert: 1,                            // INVERTED market: price = 1/ALIEN_USD
    unitScale: 0,                         // No unit scaling
    initialMarkPriceE6: "0",              // Pyth oracle mode (not Hyperp)
    warmupPeriodSlots: "20",              // ~8 seconds warmup on mainnet
    maintenanceMarginBps: "1000",         // 10% maintenance margin
    initialMarginBps: "2000",             // 20% initial margin
    tradingFeeBps: "30",                  // 0.3% trading fee → insurance fund
    maxAccounts: "4096",                  // Max accounts
    newAccountFee: "10000000",            // 0.01 ALIEN tokens to create account
    riskReductionThreshold: "0",
    maintenanceFeePerSlot: "0",
    maxCrankStalenessSlots: "200",        // ~80 seconds crank staleness
    liquidationFeeBps: "200",             // 2% liquidation fee
    liquidationFeeCap: "10000000000",     // 10B lamport cap
    liquidationBufferBps: "100",          // 1% buffer
    minLiquidationAbs: "100000",          // Min liquidation size
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
  console.log("  Market initialized (inverted=true)");

  // ---- Step 4: Create admin ALIEN token account ----
  console.log("\nStep 4: Setting up admin ALIEN token account...");
  const adminAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, alienMint, payer.publicKey
  );
  console.log(`  Admin ATA: ${adminAta.address.toBase58()}`);
  console.log(`  ALIEN balance: ${Number(adminAta.amount)}`);

  if (adminAta.amount < insuranceAmount + lpCollateral) {
    console.error(`\n  ERROR: Insufficient ALIEN tokens in admin ATA.`);
    console.error(`  Need: ${insuranceAmount + lpCollateral} lamports`);
    console.error(`  Have: ${adminAta.amount} lamports`);
    console.error(`  Please fund ${adminAta.address.toBase58()} with ALIEN tokens and re-run.`);
    // Save partial market info so we can resume
    const partialInfo = {
      network: "mainnet-beta",
      status: "PARTIAL - needs ALIEN tokens",
      createdAt: new Date().toISOString(),
      programId: PROGRAM_ID.toBase58(),
      matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
      slab: slab.publicKey.toBase58(),
      mint: alienMint.toBase58(),
      vault: vault.toBase58(),
      vaultPda: vaultPda.toBase58(),
      oracleFeedId: alienOracleFeed,
      inverted: true,
      admin: payer.publicKey.toBase58(),
      adminAta: adminAta.address.toBase58(),
    };
    fs.writeFileSync("alien-market.json", JSON.stringify(partialInfo, null, 2));
    console.log("\n  Partial market info saved to alien-market.json");
    process.exit(1);
  }

  // ---- Step 5: Create passive matcher LP ----
  console.log("\nStep 5: Creating passive matcher LP (50bps spread)...");

  const slabInfo = await connection.getAccountInfo(slab.publicKey);
  const usedIndices = slabInfo ? parseUsedIndices(slabInfo.data as Buffer) : [];
  const lpIndex = usedIndices.length;

  const matcherCtxKp = Keypair.generate();
  const matcherRent = await connection.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);

  const [lpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, lpIndex);
  console.log(`  LP Index: ${lpIndex}`);
  console.log(`  LP PDA: ${lpPda.toBase58()}`);

  // Atomic: create matcher context + init matcher + init LP
  const initLpData = encodeInitLP({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: matcherCtxKp.publicKey,
    feePayment: "10000000",  // Account creation fee
  });
  const initLpKeys = buildAccountMetas(ACCOUNTS_INIT_LP, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
  ]);

  const atomicLpTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: matcherCtxKp.publicKey,
      lamports: matcherRent,
      space: MATCHER_CTX_SIZE,
      programId: MATCHER_PROGRAM_ID,
    }),
    {
      programId: MATCHER_PROGRAM_ID,
      keys: [
        { pubkey: lpPda, isSigner: false, isWritable: false },
        { pubkey: matcherCtxKp.publicKey, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([1]),  // Passive matcher init
    },
    buildIx({ programId: PROGRAM_ID, keys: initLpKeys, data: initLpData })
  );

  await sendAndConfirmTransaction(connection, atomicLpTx, [payer, matcherCtxKp], { commitment: "confirmed" });
  console.log("  Passive LP created atomically");

  // ---- Step 6: Deposit collateral to LP ----
  console.log(`\nStep 6: Depositing ${lpCollateral} lamports to LP...`);
  const depositData = encodeDepositCollateral({ userIdx: lpIndex, amount: lpCollateral.toString() });
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
  console.log("  LP collateral deposited");

  // ---- Step 7: Create vAMM LP ----
  console.log("\nStep 7: Creating vAMM LP (wider spread for memecoin)...");
  const vammIdx = lpIndex + 1;
  const vammMatcherCtxKp = Keypair.generate();
  const [vammLpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, vammIdx);

  const vammInitData = encodeInitVamm({
    mode: 1,                                      // vAMM mode
    tradingFeeBps: 15,                             // 0.15% trading fee
    baseSpreadBps: 25,                             // 0.25% base spread (wider for memecoin)
    maxTotalBps: 500,                              // 5% max total (spread + impact + fee)
    impactKBps: 200,                               // Higher impact for memecoin
    liquidityNotionalE6: 5_000_000_000_000n,       // 5M notional liquidity
    maxFillAbs: 500_000_000_000n,                  // Max fill per trade
    maxInventoryAbs: 0n,                           // Unlimited inventory
  });

  const vammInitLpData = encodeInitLP({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: vammMatcherCtxKp.publicKey,
    feePayment: "10000000",
  });
  const vammInitLpKeys = buildAccountMetas(ACCOUNTS_INIT_LP, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
  ]);

  const vammAtomicTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: vammMatcherCtxKp.publicKey,
      lamports: matcherRent,
      space: MATCHER_CTX_SIZE,
      programId: MATCHER_PROGRAM_ID,
    }),
    {
      programId: MATCHER_PROGRAM_ID,
      keys: [
        { pubkey: vammLpPda, isSigner: false, isWritable: false },
        { pubkey: vammMatcherCtxKp.publicKey, isSigner: false, isWritable: true },
      ],
      data: vammInitData,
    },
    buildIx({ programId: PROGRAM_ID, keys: vammInitLpKeys, data: vammInitLpData })
  );

  await sendAndConfirmTransaction(connection, vammAtomicTx, [payer, vammMatcherCtxKp], { commitment: "confirmed" });
  console.log(`  vAMM LP created at index ${vammIdx}`);

  // Deposit collateral to vAMM LP
  const vammDepositData = encodeDepositCollateral({ userIdx: vammIdx, amount: lpCollateral.toString() });
  const vammDepositKeys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
    payer.publicKey,
    slab.publicKey,
    adminAta.address,
    vault,
    TOKEN_PROGRAM_ID,
    SYSVAR_CLOCK_PUBKEY,
  ]);

  const vammDepositTx = new Transaction();
  vammDepositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  vammDepositTx.add(buildIx({ programId: PROGRAM_ID, keys: vammDepositKeys, data: vammDepositData }));
  await sendAndConfirmTransaction(connection, vammDepositTx, [payer], { commitment: "confirmed" });
  console.log("  vAMM LP collateral deposited");

  // ---- Step 8: Top up insurance fund ----
  console.log(`\nStep 8: Seeding insurance fund with ${insuranceAmount} lamports...`);
  const topupData = encodeTopUpInsurance({ amount: insuranceAmount.toString() });
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
  console.log("  Insurance fund seeded");

  // ---- Step 9: Verify final state ----
  console.log("\nStep 9: Verifying market state...");
  const finalSlabInfo = await connection.getAccountInfo(slab.publicKey);
  if (finalSlabInfo) {
    const header = parseHeader(finalSlabInfo.data as Buffer);
    const config = parseConfig(finalSlabInfo.data as Buffer);
    const engine = parseEngine(finalSlabInfo.data as Buffer);

    console.log(`  Version:   ${header.version}`);
    console.log(`  Admin:     ${header.admin.toBase58()}`);
    console.log(`  Inverted:  ${config.invert === 1 ? "YES" : "NO"}`);
    console.log(`  Mint:      ${config.collateralMint.toBase58()}`);
    console.log(`  Insurance: ${engine.insuranceFund.balance}`);
    console.log(`  C_tot:     ${engine.cTot}`);
  }

  // ---- Save market info ----
  const marketInfo = {
    network: "mainnet-beta",
    status: "ACTIVE - ADMIN KEY NOT YET BURNED",
    createdAt: new Date().toISOString(),
    programId: PROGRAM_ID.toBase58(),
    matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
    slab: slab.publicKey.toBase58(),
    mint: alienMint.toBase58(),
    vault: vault.toBase58(),
    vaultPda: vaultPda.toBase58(),
    oracleFeedId: alienOracleFeed,
    oracleType: "pyth",
    inverted: true,
    riskParams: {
      initialMarginBps: 2000,
      maintenanceMarginBps: 1000,
      tradingFeeBps: 30,
      liquidationFeeBps: 200,
      warmupPeriodSlots: 20,
    },
    passiveLp: {
      index: lpIndex,
      pda: lpPda.toBase58(),
      matcherContext: matcherCtxKp.publicKey.toBase58(),
      collateral: lpCollateral.toString(),
    },
    vammLp: {
      index: vammIdx,
      pda: vammLpPda.toBase58(),
      matcherContext: vammMatcherCtxKp.publicKey.toBase58(),
      collateral: lpCollateral.toString(),
      config: {
        mode: "vAMM",
        tradingFeeBps: 15,
        baseSpreadBps: 25,
        maxTotalBps: 500,
        impactKBps: 200,
      },
    },
    insuranceFund: insuranceAmount.toString(),
    admin: payer.publicKey.toBase58(),
    adminAta: adminAta.address.toBase58(),
  };

  fs.writeFileSync("alien-market.json", JSON.stringify(marketInfo, null, 2));
  console.log("\nMarket info saved to alien-market.json");

  // ---- Summary ----
  console.log("\n" + "=".repeat(70));
  console.log("ALIEN SOVEREIGN PERCOLATOR - MARKET CREATED!");
  console.log("=".repeat(70));
  console.log(`
Market:
  Slab:           ${slab.publicKey.toBase58()}
  Mint:           ${alienMint.toBase58()} (ALIEN)
  Vault:          ${vault.toBase58()}
  Oracle:         Pyth ${alienOracleFeed.slice(0, 16)}...
  Type:           INVERTED (price = 1/ALIEN_USD)

Passive LP (50bps):
  Index:          ${lpIndex}
  PDA:            ${lpPda.toBase58()}
  Collateral:     ${lpCollateral} lamports

vAMM LP (memecoin-tuned):
  Index:          ${vammIdx}
  PDA:            ${vammLpPda.toBase58()}
  Collateral:     ${lpCollateral} lamports

Insurance Fund:   ${insuranceAmount} lamports (grows from 30bps trading fees)
Admin:            ${payer.publicKey.toBase58()}

NEXT STEPS:
  1. Verify:  npx tsx scripts/verify-before-burn.ts
  2. Burn:    npx tsx scripts/burn-admin-key.ts
  3. Monitor: npx tsx scripts/monitor-alien-insurance.ts
`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
