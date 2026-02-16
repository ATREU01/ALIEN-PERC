/**
 * Setup Inverted Memecoin Percolator Market (Generic)
 *
 * Deploys a complete inverted perpetual futures market for ANY memecoin:
 * - Collateral: The memecoin itself (any SPL token)
 * - Price model: Inverted (price = 1/TOKEN_USD) so traders get USD exposure
 * - Insurance fund: Seeded from initial deposit, grows from trading fees
 * - Risk params: Tuned for memecoin volatility (wider margins, higher fees)
 * - Dual LP: Passive matcher (50bps) + vAMM matcher (tighter, impact-based)
 *
 * Usage:
 *   npx tsx scripts/setup-memecoin-market.ts \
 *     --mint <TOKEN_MINT> \
 *     --oracle <PYTH_FEED_HEX> \
 *     [--network devnet|mainnet] \
 *     [--insurance <lamports>] \
 *     [--lp-collateral <lamports>] \
 *     [--burn-admin] \
 *     [--initial-margin-bps <bps>] \
 *     [--maintenance-margin-bps <bps>] \
 *     [--trading-fee-bps <bps>]
 *
 * Or via environment variables:
 *   TOKEN_MINT=<pubkey> TOKEN_ORACLE_FEED=<hex> npx tsx scripts/setup-memecoin-market.ts
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
// PROGRAM CONSTANTS
// ============================================================================

const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");
const MATCHER_PROGRAM_ID = new PublicKey("4HcGCsyjAqnFua5ccuXyt8KRRQzKFbGTJkVChpS7Yfzy");
const MATCHER_CTX_SIZE = 320;
const SLAB_SIZE = 992560;

// ============================================================================
// MEMECOIN RISK PRESETS
// ============================================================================

interface RiskPreset {
  name: string;
  description: string;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  tradingFeeBps: number;
  liquidationFeeBps: number;
  liquidationBufferBps: number;
  confFilterBps: number;
  maxStalenessSecs: number;
  warmupPeriodSlots: number;
  maxCrankStalenessSlots: number;
  vammBaseSpreadBps: number;
  vammImpactKBps: number;
  vammMaxTotalBps: number;
  vammTradingFeeBps: number;
}

const RISK_PRESETS: Record<string, RiskPreset> = {
  conservative: {
    name: "Conservative",
    description: "Higher margins, wider spreads — safest for volatile memecoins",
    initialMarginBps: 2500,     // 25% → 4x max leverage
    maintenanceMarginBps: 1250, // 12.5%
    tradingFeeBps: 50,          // 0.50% trading fee
    liquidationFeeBps: 300,     // 3% liquidation penalty
    liquidationBufferBps: 150,  // 1.5% buffer
    confFilterBps: 1500,        // 15% oracle confidence filter
    maxStalenessSecs: 300,      // 5 min staleness
    warmupPeriodSlots: 40,      // ~16 seconds
    maxCrankStalenessSlots: 300,
    vammBaseSpreadBps: 50,
    vammImpactKBps: 400,
    vammMaxTotalBps: 800,
    vammTradingFeeBps: 25,
  },
  standard: {
    name: "Standard",
    description: "Balanced risk parameters — good default for most memecoins",
    initialMarginBps: 2000,     // 20% → 5x max leverage
    maintenanceMarginBps: 1000, // 10%
    tradingFeeBps: 30,          // 0.30% trading fee
    liquidationFeeBps: 200,     // 2% liquidation penalty
    liquidationBufferBps: 100,  // 1% buffer
    confFilterBps: 1000,        // 10% confidence filter
    maxStalenessSecs: 120,      // 2 min staleness
    warmupPeriodSlots: 20,      // ~8 seconds
    maxCrankStalenessSlots: 200,
    vammBaseSpreadBps: 25,
    vammImpactKBps: 200,
    vammMaxTotalBps: 500,
    vammTradingFeeBps: 15,
  },
  aggressive: {
    name: "Aggressive",
    description: "Lower margins, tighter spreads — for established tokens with good liquidity",
    initialMarginBps: 1000,     // 10% → 10x max leverage
    maintenanceMarginBps: 500,  // 5%
    tradingFeeBps: 15,          // 0.15% trading fee
    liquidationFeeBps: 150,     // 1.5% liquidation penalty
    liquidationBufferBps: 50,   // 0.5% buffer
    confFilterBps: 500,         // 5% confidence filter
    maxStalenessSecs: 60,       // 1 min staleness
    warmupPeriodSlots: 10,      // ~4 seconds
    maxCrankStalenessSlots: 100,
    vammBaseSpreadBps: 10,
    vammImpactKBps: 100,
    vammMaxTotalBps: 300,
    vammTradingFeeBps: 10,
  },
};

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
  data.writeUInt8(2, offset); offset += 1;
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
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs(): {
  mint: string;
  oracleFeed: string;
  network: "devnet" | "mainnet";
  insuranceAmount: bigint;
  lpCollateral: bigint;
  burnAdmin: boolean;
  preset: string;
  overrides: Partial<RiskPreset>;
} {
  const args = process.argv.slice(2);
  const flags: Record<string, string> = {};
  const boolFlags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--burn-admin") {
      boolFlags.add("burn-admin");
    } else if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }

  return {
    mint: flags["mint"] || process.env.TOKEN_MINT || "",
    oracleFeed: flags["oracle"] || process.env.TOKEN_ORACLE_FEED || "",
    network: (flags["network"] || process.env.NETWORK || "devnet") as "devnet" | "mainnet",
    insuranceAmount: BigInt(flags["insurance"] || process.env.INSURANCE_AMOUNT || "1000000000"),
    lpCollateral: BigInt(flags["lp-collateral"] || process.env.LP_COLLATERAL || "1000000000"),
    burnAdmin: boolFlags.has("burn-admin") || process.env.BURN_ADMIN === "true",
    preset: flags["preset"] || process.env.RISK_PRESET || "standard",
    overrides: {
      ...(flags["initial-margin-bps"] ? { initialMarginBps: Number(flags["initial-margin-bps"]) } : {}),
      ...(flags["maintenance-margin-bps"] ? { maintenanceMarginBps: Number(flags["maintenance-margin-bps"]) } : {}),
      ...(flags["trading-fee-bps"] ? { tradingFeeBps: Number(flags["trading-fee-bps"]) } : {}),
    },
  };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const config = parseArgs();

  // Validate required inputs
  if (!config.mint) {
    console.error("ERROR: Token mint address required.");
    console.error("  --mint <pubkey>  or  TOKEN_MINT=<pubkey>");
    process.exit(1);
  }
  if (!config.oracleFeed) {
    console.error("ERROR: Pyth oracle feed ID required.");
    console.error("  --oracle <hex>  or  TOKEN_ORACLE_FEED=<hex>");
    process.exit(1);
  }

  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(config.mint);
  } catch {
    console.error(`ERROR: Invalid token mint address: ${config.mint}`);
    process.exit(1);
  }

  const feedHex = config.oracleFeed.startsWith("0x") ? config.oracleFeed.slice(2) : config.oracleFeed;
  if (feedHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(feedHex)) {
    console.error(`ERROR: Invalid oracle feed. Must be 64 hex chars. Got: ${config.oracleFeed}`);
    process.exit(1);
  }

  // Load risk preset with overrides
  const basePreset = RISK_PRESETS[config.preset] || RISK_PRESETS.standard;
  const risk: RiskPreset = { ...basePreset, ...config.overrides };

  const rpcUrl = config.network === "mainnet"
    ? (process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com")
    : (process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com");
  const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;

  console.log("\n" + "=".repeat(70));
  console.log("MEMECOIN INVERTED PERCOLATOR — MARKET SETUP");
  console.log("=".repeat(70));
  console.log(`\nCreating inverted perpetual futures market for memecoin.`);
  console.log(`Collateral: token itself | Price: 1/TOKEN_USD | Fees → Insurance Fund\n`);

  // Setup connection & wallet
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const connection = new Connection(rpcUrl, "confirmed");

  console.log(`Network:    ${config.network} (${rpcUrl})`);
  console.log(`Wallet:     ${payer.publicKey.toBase58()}`);
  console.log(`Token Mint: ${tokenMint.toBase58()}`);
  console.log(`Oracle:     ${config.oracleFeed}`);
  console.log(`Risk Preset: ${risk.name}`);
  console.log(`Burn Admin: ${config.burnAdmin ? "YES" : "no"}`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`SOL Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  if (balance < 5 * LAMPORTS_PER_SOL) {
    console.error("ERROR: Need at least 5 SOL for rent + fees.");
    process.exit(1);
  }

  // ==== Step 1: Create slab account ====
  console.log("Step 1/8: Creating slab account...");
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
  console.log("  Done");

  // ==== Step 2: Derive vault PDA & create vault ATA ====
  console.log("\nStep 2/8: Setting up vault...");
  const [vaultPda] = deriveVaultAuthority(PROGRAM_ID, slab.publicKey);
  console.log(`  Vault PDA: ${vaultPda.toBase58()}`);

  const vaultAccount = await getOrCreateAssociatedTokenAccount(
    connection, payer, tokenMint, vaultPda, true
  );
  const vault = vaultAccount.address;
  console.log(`  Vault ATA: ${vault.toBase58()}`);

  // ==== Step 3: Initialize INVERTED market ====
  console.log("\nStep 3/8: Initializing INVERTED market...");
  console.log(`  Risk params (${risk.name} preset):`);
  console.log(`    Initial margin:    ${(risk.initialMarginBps / 100).toFixed(1)}%  (${risk.initialMarginBps} bps)`);
  console.log(`    Maintenance margin: ${(risk.maintenanceMarginBps / 100).toFixed(1)}%  (${risk.maintenanceMarginBps} bps)`);
  console.log(`    Trading fee:        ${(risk.tradingFeeBps / 100).toFixed(2)}% (${risk.tradingFeeBps} bps)`);
  console.log(`    Liquidation fee:    ${(risk.liquidationFeeBps / 100).toFixed(1)}%  (${risk.liquidationFeeBps} bps)`);
  console.log(`    Max leverage:       ${Math.floor(10000 / risk.initialMarginBps)}x`);

  const initMarketData = encodeInitMarket({
    admin: payer.publicKey,
    collateralMint: tokenMint,
    indexFeedId: feedHex,
    maxStalenessSecs: String(risk.maxStalenessSecs),
    confFilterBps: risk.confFilterBps,
    invert: 1, // ALWAYS inverted for memecoin
    unitScale: 0,
    initialMarkPriceE6: "0", // Pyth oracle mode
    warmupPeriodSlots: String(risk.warmupPeriodSlots),
    maintenanceMarginBps: String(risk.maintenanceMarginBps),
    initialMarginBps: String(risk.initialMarginBps),
    tradingFeeBps: String(risk.tradingFeeBps),
    maxAccounts: "4096",
    newAccountFee: "10000000",
    riskReductionThreshold: "0",
    maintenanceFeePerSlot: "0",
    maxCrankStalenessSlots: String(risk.maxCrankStalenessSlots),
    liquidationFeeBps: String(risk.liquidationFeeBps),
    liquidationFeeCap: "10000000000",
    liquidationBufferBps: String(risk.liquidationBufferBps),
    minLiquidationAbs: "100000",
  });

  const initMarketKeys = buildAccountMetas(ACCOUNTS_INIT_MARKET, [
    payer.publicKey,
    slab.publicKey,
    tokenMint,
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

  // ==== Step 4: Setup admin token account ====
  console.log("\nStep 4/8: Setting up admin token account...");
  const adminAta = await getOrCreateAssociatedTokenAccount(
    connection, payer, tokenMint, payer.publicKey
  );
  console.log(`  Admin ATA: ${adminAta.address.toBase58()}`);
  console.log(`  Token balance: ${Number(adminAta.amount)}`);

  if (adminAta.amount < config.insuranceAmount + config.lpCollateral * 2n) {
    console.error(`\n  WARNING: Insufficient tokens.`);
    console.error(`  Need: ${config.insuranceAmount + config.lpCollateral * 2n} lamports`);
    console.error(`  Have: ${adminAta.amount} lamports`);

    // Save partial state
    const partialInfo = {
      status: "PARTIAL - needs tokens",
      createdAt: new Date().toISOString(),
      network: config.network,
      programId: PROGRAM_ID.toBase58(),
      matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
      slab: slab.publicKey.toBase58(),
      mint: tokenMint.toBase58(),
      vault: vault.toBase58(),
      vaultPda: vaultPda.toBase58(),
      oracleFeedId: config.oracleFeed,
      inverted: true,
      riskPreset: config.preset,
      admin: payer.publicKey.toBase58(),
    };
    fs.writeFileSync("memecoin-market.json", JSON.stringify(partialInfo, null, 2));
    console.log("\n  Partial market info saved to memecoin-market.json");
    process.exit(1);
  }

  // ==== Step 5: Create passive matcher LP (50bps) ====
  console.log("\nStep 5/8: Creating passive matcher LP (50bps spread)...");

  const slabInfo = await connection.getAccountInfo(slab.publicKey);
  const usedIndices = slabInfo ? parseUsedIndices(slabInfo.data as Buffer) : [];
  const lpIndex = usedIndices.length;

  const matcherCtxKp = Keypair.generate();
  const matcherRent = await connection.getMinimumBalanceForRentExemption(MATCHER_CTX_SIZE);

  const [lpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, lpIndex);
  console.log(`  LP Index: ${lpIndex}`);
  console.log(`  LP PDA: ${lpPda.toBase58()}`);

  const initLpData = encodeInitLP({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: matcherCtxKp.publicKey,
    feePayment: "10000000",
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
      data: Buffer.from([1]),
    },
    buildIx({ programId: PROGRAM_ID, keys: initLpKeys, data: initLpData })
  );
  await sendAndConfirmTransaction(connection, atomicLpTx, [payer, matcherCtxKp], { commitment: "confirmed" });
  console.log("  Passive LP created atomically");

  // ==== Step 6: Deposit collateral to passive LP ====
  console.log(`\nStep 6/8: Depositing collateral to passive LP...`);
  const depositData = encodeDepositCollateral({ userIdx: lpIndex, amount: config.lpCollateral.toString() });
  const depositKeys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
    payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY,
  ]);

  const depositTx = new Transaction();
  depositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  depositTx.add(buildIx({ programId: PROGRAM_ID, keys: depositKeys, data: depositData }));
  await sendAndConfirmTransaction(connection, depositTx, [payer], { commitment: "confirmed" });
  console.log("  Done");

  // ==== Step 7: Create vAMM LP ====
  console.log("\nStep 7/8: Creating vAMM LP (impact-based spreads)...");
  const vammIdx = lpIndex + 1;
  const vammMatcherCtxKp = Keypair.generate();
  const [vammLpPda] = deriveLpPda(PROGRAM_ID, slab.publicKey, vammIdx);

  const vammInitData = encodeInitVamm({
    mode: 1,
    tradingFeeBps: risk.vammTradingFeeBps,
    baseSpreadBps: risk.vammBaseSpreadBps,
    maxTotalBps: risk.vammMaxTotalBps,
    impactKBps: risk.vammImpactKBps,
    liquidityNotionalE6: 5_000_000_000_000n,
    maxFillAbs: 500_000_000_000n,
    maxInventoryAbs: 0n,
  });

  const vammInitLpData = encodeInitLP({
    matcherProgram: MATCHER_PROGRAM_ID,
    matcherContext: vammMatcherCtxKp.publicKey,
    feePayment: "10000000",
  });
  const vammInitLpKeys = buildAccountMetas(ACCOUNTS_INIT_LP, [
    payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID,
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

  // Deposit to vAMM LP
  const vammDepositData = encodeDepositCollateral({ userIdx: vammIdx, amount: config.lpCollateral.toString() });
  const vammDepositKeys = buildAccountMetas(ACCOUNTS_DEPOSIT_COLLATERAL, [
    payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID, SYSVAR_CLOCK_PUBKEY,
  ]);
  const vammDepositTx = new Transaction();
  vammDepositTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  vammDepositTx.add(buildIx({ programId: PROGRAM_ID, keys: vammDepositKeys, data: vammDepositData }));
  await sendAndConfirmTransaction(connection, vammDepositTx, [payer], { commitment: "confirmed" });
  console.log("  vAMM LP collateral deposited");

  // ==== Step 8: Top up insurance fund ====
  console.log(`\nStep 8/8: Seeding insurance fund...`);
  const topupData = encodeTopUpInsurance({ amount: config.insuranceAmount.toString() });
  const topupKeys = buildAccountMetas(ACCOUNTS_TOPUP_INSURANCE, [
    payer.publicKey, slab.publicKey, adminAta.address, vault, TOKEN_PROGRAM_ID,
  ]);

  const topupTx = new Transaction();
  topupTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100000 }));
  topupTx.add(buildIx({ programId: PROGRAM_ID, keys: topupKeys, data: topupData }));
  await sendAndConfirmTransaction(connection, topupTx, [payer], { commitment: "confirmed" });
  console.log("  Insurance fund seeded");

  // ==== Verify final state ====
  console.log("\nVerifying market state...");
  const finalSlabInfo = await connection.getAccountInfo(slab.publicKey);
  if (finalSlabInfo) {
    const header = parseHeader(finalSlabInfo.data as Buffer);
    const parsedConfig = parseConfig(finalSlabInfo.data as Buffer);
    const engine = parseEngine(finalSlabInfo.data as Buffer);

    console.log(`  Version:   ${header.version}`);
    console.log(`  Admin:     ${header.admin.toBase58()}`);
    console.log(`  Inverted:  ${parsedConfig.invert === 1 ? "YES" : "NO"}`);
    console.log(`  Mint:      ${parsedConfig.collateralMint.toBase58()}`);
    console.log(`  Insurance: ${engine.insuranceFund.balance}`);
    console.log(`  C_tot:     ${engine.cTot}`);
  }

  // ==== Save market info ====
  const marketInfo = {
    network: config.network,
    status: config.burnAdmin ? "PENDING ADMIN BURN" : "ACTIVE",
    createdAt: new Date().toISOString(),
    type: "inverted-memecoin-percolator",
    programId: PROGRAM_ID.toBase58(),
    matcherProgramId: MATCHER_PROGRAM_ID.toBase58(),
    slab: slab.publicKey.toBase58(),
    mint: tokenMint.toBase58(),
    vault: vault.toBase58(),
    vaultPda: vaultPda.toBase58(),
    oracleFeedId: config.oracleFeed,
    oracleType: "pyth",
    inverted: true,
    riskPreset: config.preset,
    riskParams: {
      initialMarginBps: risk.initialMarginBps,
      maintenanceMarginBps: risk.maintenanceMarginBps,
      tradingFeeBps: risk.tradingFeeBps,
      liquidationFeeBps: risk.liquidationFeeBps,
      maxLeverage: Math.floor(10000 / risk.initialMarginBps),
    },
    passiveLp: {
      index: lpIndex,
      pda: lpPda.toBase58(),
      matcherContext: matcherCtxKp.publicKey.toBase58(),
      collateral: config.lpCollateral.toString(),
    },
    vammLp: {
      index: vammIdx,
      pda: vammLpPda.toBase58(),
      matcherContext: vammMatcherCtxKp.publicKey.toBase58(),
      collateral: config.lpCollateral.toString(),
      config: {
        mode: "vAMM",
        tradingFeeBps: risk.vammTradingFeeBps,
        baseSpreadBps: risk.vammBaseSpreadBps,
        maxTotalBps: risk.vammMaxTotalBps,
        impactKBps: risk.vammImpactKBps,
      },
    },
    insuranceFund: config.insuranceAmount.toString(),
    admin: payer.publicKey.toBase58(),
  };

  fs.writeFileSync("memecoin-market.json", JSON.stringify(marketInfo, null, 2));
  console.log("\nMarket info saved to memecoin-market.json");

  // ==== Summary ====
  console.log("\n" + "=".repeat(70));
  console.log("MEMECOIN INVERTED PERCOLATOR — MARKET CREATED!");
  console.log("=".repeat(70));
  console.log(`
Market:
  Slab:           ${slab.publicKey.toBase58()}
  Mint:           ${tokenMint.toBase58()}
  Vault:          ${vault.toBase58()}
  Oracle:         Pyth ${config.oracleFeed.slice(0, 16)}...
  Type:           INVERTED (price = 1/TOKEN_USD)
  Max Leverage:   ${Math.floor(10000 / risk.initialMarginBps)}x

Passive LP (50bps):
  Index:          ${lpIndex}
  PDA:            ${lpPda.toBase58()}

vAMM LP (impact-based):
  Index:          ${vammIdx}
  PDA:            ${vammLpPda.toBase58()}

Insurance Fund:   ${config.insuranceAmount} lamports (grows from ${risk.tradingFeeBps}bps trading fees)
Admin:            ${payer.publicKey.toBase58()}
`);

  if (config.burnAdmin) {
    console.log("NEXT: Run burn-admin-key to make market sovereign:");
    console.log("  npx tsx scripts/burn-admin-key.ts");
  } else {
    console.log("NEXT STEPS:");
    console.log("  1. Start keeper: npx tsx scripts/memecoin-keeper.ts");
    console.log("  2. Verify:       npx tsx scripts/dump-market.ts");
    console.log("  3. (Optional) Burn admin: npx tsx scripts/burn-admin-key.ts");
  }

  console.log("\n" + "=".repeat(70));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
