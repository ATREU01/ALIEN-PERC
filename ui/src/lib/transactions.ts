/**
 * Percolator transaction builders for the Alienator UI.
 *
 * Port of the CLI encoding + account-meta logic into a browser-compatible
 * module that works with @solana/wallet-adapter.
 */
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  Connection,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { PERCOLATOR_PROGRAM_ID, MATCHER_PROGRAM_ID, SLAB_DATA_SIZE } from "./constants";

// ============================================================================
// ENCODING PRIMITIVES (matches percolator-ALIEN/src/abi/encode.ts)
// ============================================================================

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

function encU32(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val, 0);
  return buf;
}

function encU64(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(n, 0);
  return buf;
}

function encI64(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(n, 0);
  return buf;
}

function encU128(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(n & 0xffff_ffff_ffff_ffffn, 0);
  buf.writeBigUInt64LE(n >> 64n, 8);
  return buf;
}

function encI128(val: bigint | string): Buffer {
  const n = typeof val === "string" ? BigInt(val) : val;
  let unsigned = n;
  if (n < 0n) unsigned = (1n << 128n) + n;
  const buf = Buffer.alloc(16);
  buf.writeBigUInt64LE(unsigned & 0xffff_ffff_ffff_ffffn, 0);
  buf.writeBigUInt64LE(unsigned >> 64n, 8);
  return buf;
}

function encPubkey(val: PublicKey | string): Buffer {
  const pk = typeof val === "string" ? new PublicKey(val) : val;
  return Buffer.from(pk.toBytes());
}

function encodeFeedId(feedId: string): Buffer {
  const hex = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  if (hex.length !== 64) throw new Error(`Invalid feed ID: expected 64 hex chars`);
  return Buffer.from(hex, "hex");
}

// ============================================================================
// INSTRUCTION TAGS
// ============================================================================

const IX = {
  InitMarket: 0,
  InitUser: 1,
  InitLP: 2,
  DepositCollateral: 3,
  WithdrawCollateral: 4,
  KeeperCrank: 5,
  TradeNoCpi: 6,
  LiquidateAtOracle: 7,
  CloseAccount: 8,
  TopUpInsurance: 9,
  TradeCpi: 10,
  UpdateAdmin: 12,
} as const;

// ============================================================================
// PDA DERIVATION
// ============================================================================

export function deriveVaultAuthority(slab: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), slab.toBuffer()],
    PERCOLATOR_PROGRAM_ID,
  );
}

export function deriveLpPda(slab: PublicKey, lpIdx: number): [PublicKey, number] {
  const idxBuf = Buffer.alloc(2);
  idxBuf.writeUInt16LE(lpIdx, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("lp"), slab.toBuffer(), idxBuf],
    PERCOLATOR_PROGRAM_ID,
  );
}

// ============================================================================
// HELPER: ensure ATA exists
// ============================================================================

export async function ensureAta(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner?: PublicKey,
): Promise<{ ata: PublicKey; createIx: TransactionInstruction | null }> {
  const ataOwner = owner ?? payer;
  const ata = await getAssociatedTokenAddress(mint, ataOwner);
  try {
    await getAccount(connection, ata);
    return { ata, createIx: null };
  } catch {
    const createIx = createAssociatedTokenAccountInstruction(payer, ata, ataOwner, mint);
    return { ata, createIx };
  }
}

// ============================================================================
// SLAB PARSING HELPERS (for finding user account, LP index, etc.)
// ============================================================================

const ENGINE_OFF = 440;
const ENGINE_BITMAP_OFF = 408;
const ENGINE_ACCOUNTS_OFF = 9136;
const ACCOUNT_SIZE = 240;

/** Get list of used account indices from slab bitmap */
export function getUsedIndices(data: Buffer): number[] {
  const base = ENGINE_OFF + ENGINE_BITMAP_OFF;
  const used: number[] = [];
  for (let word = 0; word < 64; word++) {
    const bits = data.readBigUInt64LE(base + word * 8);
    if (bits === 0n) continue;
    for (let bit = 0; bit < 64; bit++) {
      if ((bits >> BigInt(bit)) & 1n) {
        used.push(word * 64 + bit);
      }
    }
  }
  return used;
}

/** Find user's account index on this slab (if they have one) */
export function findUserAccount(
  data: Buffer,
  owner: PublicKey,
  kind: "user" | "lp" = "user",
): number | null {
  const ownerStr = owner.toBase58();
  const targetKind = kind === "user" ? 0 : 1;
  for (const idx of getUsedIndices(data)) {
    const off = ENGINE_OFF + ENGINE_ACCOUNTS_OFF + idx * ACCOUNT_SIZE;
    if (off + ACCOUNT_SIZE > data.length) continue;
    const acctKind = data.readUInt8(off + 24);
    if (acctKind !== targetKind) continue;
    const acctOwner = new PublicKey(data.subarray(off + 184, off + 216)).toBase58();
    if (acctOwner === ownerStr) return idx;
  }
  return null;
}

/** Find the first LP account index and its owner/matcher info */
export function findFirstLP(data: Buffer): {
  idx: number;
  owner: PublicKey;
  matcherProgram: PublicKey;
  matcherContext: PublicKey;
} | null {
  for (const idx of getUsedIndices(data)) {
    const off = ENGINE_OFF + ENGINE_ACCOUNTS_OFF + idx * ACCOUNT_SIZE;
    if (off + ACCOUNT_SIZE > data.length) continue;
    const kind = data.readUInt8(off + 24);
    if (kind !== 1) continue; // LP = 1
    return {
      idx,
      owner: new PublicKey(data.subarray(off + 184, off + 216)),
      matcherProgram: new PublicKey(data.subarray(off + 120, off + 152)),
      matcherContext: new PublicKey(data.subarray(off + 152, off + 184)),
    };
  }
  return null;
}

/** Read vault pubkey from slab config (offset 72 + 32) */
export function readVault(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(72 + 32, 72 + 64));
}

/** Read collateral mint from slab config (offset 72) */
export function readMint(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(72, 72 + 32));
}

/** Read oracle authority from config */
export function readOracleAuthority(data: Buffer): PublicKey {
  return new PublicKey(data.subarray(72 + 256, 72 + 288));
}

/** Check if market is hyperp (all-zero feed id) */
export function isHyperp(data: Buffer): boolean {
  const feed = data.subarray(72 + 64, 72 + 96);
  return feed.every((b: number) => b === 0);
}

/** Read new account fee from risk params */
export function readNewAccountFee(data: Buffer): bigint {
  // RiskParams at ENGINE_OFF + 48, newAccountFee at offset 40 within params
  const off = ENGINE_OFF + 48 + 40;
  const lo = data.readBigUInt64LE(off);
  const hi = data.readBigUInt64LE(off + 8);
  return (hi << 64n) | lo;
}

// ============================================================================
// HIGH-LEVEL TRANSACTION BUILDERS
// ============================================================================

function buildIx(programId: PublicKey, keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[], ixData: Buffer): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data: ixData });
}

/**
 * Build InitUser transaction
 */
export async function buildInitUserTx(
  connection: Connection,
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
): Promise<Transaction> {
  const vault = readVault(slabData);
  const mint = readMint(slabData);
  const fee = readNewAccountFee(slabData);
  const { ata, createIx } = await ensureAta(connection, user, mint);

  const ixData = Buffer.concat([encU8(IX.InitUser), encU64(fee)]);
  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  if (createIx) tx.add(createIx);
  tx.add(ix);
  return tx;
}

/**
 * Build DepositCollateral transaction
 */
export async function buildDepositTx(
  connection: Connection,
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
  userIdx: number,
  amount: bigint,
): Promise<Transaction> {
  const vault = readVault(slabData);
  const mint = readMint(slabData);
  const { ata, createIx } = await ensureAta(connection, user, mint);

  const ixData = Buffer.concat([
    encU8(IX.DepositCollateral),
    encU16(userIdx),
    encU64(amount),
  ]);

  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  if (createIx) tx.add(createIx);
  tx.add(ix);
  return tx;
}

/**
 * Build WithdrawCollateral transaction
 */
export async function buildWithdrawTx(
  connection: Connection,
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
  userIdx: number,
  amount: bigint,
): Promise<Transaction> {
  const vault = readVault(slabData);
  const mint = readMint(slabData);
  const [vaultPda] = deriveVaultAuthority(slab);
  const { ata, createIx } = await ensureAta(connection, user, mint);

  // For hyperp markets, oracle is the slab itself (admin authority)
  const oracle = isHyperp(slabData) ? slab : readOracleAuthority(slabData);

  const ixData = Buffer.concat([
    encU8(IX.WithdrawCollateral),
    encU16(userIdx),
    encU64(amount),
  ]);

  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: oracle, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  if (createIx) tx.add(createIx);
  tx.add(ix);
  return tx;
}

/**
 * Build TradeCpi transaction (trade against LP via matcher)
 */
export async function buildTradeCpiTx(
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
  lpIdx: number,
  lpOwner: PublicKey,
  matcherProg: PublicKey,
  matcherCtx: PublicKey,
  userIdx: number,
  size: bigint, // positive = long, negative = short
): Promise<Transaction> {
  const [lpPda] = deriveLpPda(slab, lpIdx);

  // For hyperp, oracle is the slab itself
  const oracle = isHyperp(slabData) ? slab : readOracleAuthority(slabData);

  const ixData = Buffer.concat([
    encU8(IX.TradeCpi),
    encU16(lpIdx),
    encU16(userIdx),
    encI128(size),
  ]);

  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: lpOwner, isSigner: false, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: oracle, isSigner: false, isWritable: false },
    { pubkey: matcherProg, isSigner: false, isWritable: false },
    { pubkey: matcherCtx, isSigner: false, isWritable: true },
    { pubkey: lpPda, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }));
  tx.add(ix);
  return tx;
}

/**
 * Build InitLP transaction
 */
export async function buildInitLpTx(
  connection: Connection,
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
  matcherProgram: PublicKey,
  matcherContext: PublicKey,
): Promise<Transaction> {
  const vault = readVault(slabData);
  const mint = readMint(slabData);
  const fee = readNewAccountFee(slabData);
  const { ata, createIx } = await ensureAta(connection, user, mint);

  const ixData = Buffer.concat([
    encU8(IX.InitLP),
    encPubkey(matcherProgram),
    encPubkey(matcherContext),
    encU64(fee),
  ]);

  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  if (createIx) tx.add(createIx);
  tx.add(ix);
  return tx;
}

/**
 * Build InitMarket transaction (including slab account creation)
 * Returns { tx, slabKeypair } — caller must include slabKeypair as signer
 */
export async function buildInitMarketTx(
  connection: Connection,
  admin: PublicKey,
  args: {
    collateralMint: PublicKey;
    indexFeedId: string;
    invert: number;
    initialMarginBps: number;
    maintenanceMarginBps: number;
    tradingFeeBps: number;
    initialMarkPriceE6: bigint;
  },
): Promise<{ tx: Transaction; slabKeypair: Keypair; vaultKeypair: Keypair }> {
  const slabKeypair = Keypair.generate();
  const vaultKeypair = Keypair.generate();
  const slab = slabKeypair.publicKey;

  // Calculate rent for slab
  const slabRent = await connection.getMinimumBalanceForRentExemption(SLAB_DATA_SIZE);

  // Create slab account owned by percolator program
  const createSlabIx = SystemProgram.createAccount({
    fromPubkey: admin,
    newAccountPubkey: slab,
    lamports: slabRent,
    space: SLAB_DATA_SIZE,
    programId: PERCOLATOR_PROGRAM_ID,
  });

  // Create vault token account
  const createVaultIx = createAssociatedTokenAccountInstruction(
    admin,
    await getAssociatedTokenAddress(args.collateralMint, slab, true),
    slab,
    args.collateralMint,
  );

  // Derive vault ATA
  const vaultAta = await getAssociatedTokenAddress(args.collateralMint, slab, true);

  // Dummy ATA — just use admin's ATA
  const dummyAta = await getAssociatedTokenAddress(args.collateralMint, admin);

  // InitMarket instruction
  const ixData = Buffer.concat([
    encU8(IX.InitMarket),
    encPubkey(admin),
    encPubkey(args.collateralMint),
    encodeFeedId(args.indexFeedId),
    encU64(86400n),                         // maxStalenessSecs
    encU16(100),                            // confFilterBps
    encU8(args.invert),
    encU32(0),                              // unitScale
    encU64(args.initialMarkPriceE6),        // initialMarkPriceE6
    encU128(1_000_000_000_000n),            // maxMaintenanceFeePerSlot (admin limit)
    encU128(1_000_000_000_000n),            // maxRiskThreshold (admin limit)
    encU64(0n),                             // minOraclePriceCapE2bps (admin limit, 0=no floor)
    encU64(100n),                           // warmupPeriodSlots
    encU64(BigInt(args.maintenanceMarginBps)),
    encU64(BigInt(args.initialMarginBps)),
    encU64(BigInt(args.tradingFeeBps)),
    encU64(1000n),                          // maxAccounts
    encU128(10_000_000n),                   // newAccountFee (0.01 SOL)
    encU128(1_000_000_000n),                // riskReductionThreshold
    encU128(1000n),                         // maintenanceFeePerSlot
    encU64(100n),                           // maxCrankStalenessSlots
    encU64(250n),                           // liquidationFeeBps
    encU128(100_000_000n),                  // liquidationFeeCap
    encU64(50n),                            // liquidationBufferBps
    encU128(1_000_000n),                    // minLiquidationAbs
  ]);

  const initIx = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: admin, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: args.collateralMint, isSigner: false, isWritable: false },
    { pubkey: vaultAta, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: dummyAta, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(createSlabIx);
  tx.add(createVaultIx);
  tx.add(initIx);

  return { tx, slabKeypair, vaultKeypair };
}

/**
 * Build UpdateAdmin transaction (for burning admin key)
 */
export function buildUpdateAdminTx(
  admin: PublicKey,
  slab: PublicKey,
  newAdmin: PublicKey,
): Transaction {
  const ixData = Buffer.concat([encU8(IX.UpdateAdmin), encPubkey(newAdmin)]);
  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: admin, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
  ], ixData);

  const tx = new Transaction();
  tx.add(ix);
  return tx;
}

/**
 * Build KeeperCrank transaction (permissionless — any wallet can call)
 * This must be called before TradeCpi to keep the crank fresh.
 */
export function buildKeeperCrankTx(
  caller: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
): Transaction {
  // For hyperp, oracle is the slab itself
  const oracle = isHyperp(slabData) ? slab : readOracleAuthority(slabData);

  // callerIdx = 65535 (u16::MAX) = permissionless mode
  const ixData = Buffer.concat([
    encU8(IX.KeeperCrank),
    encU16(65535),
    encU8(0), // allowPanic = false
  ]);

  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: caller, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: oracle, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ix);
  return tx;
}

/**
 * Build CloseAccount transaction
 */
export async function buildCloseAccountTx(
  connection: Connection,
  user: PublicKey,
  slab: PublicKey,
  slabData: Buffer,
  userIdx: number,
): Promise<Transaction> {
  const vault = readVault(slabData);
  const mint = readMint(slabData);
  const [vaultPda] = deriveVaultAuthority(slab);
  const { ata } = await ensureAta(connection, user, mint);
  const oracle = isHyperp(slabData) ? slab : readOracleAuthority(slabData);

  const ixData = Buffer.concat([encU8(IX.CloseAccount), encU16(userIdx)]);
  const ix = buildIx(PERCOLATOR_PROGRAM_ID, [
    { pubkey: user, isSigner: true, isWritable: false },
    { pubkey: slab, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: vaultPda, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: oracle, isSigner: false, isWritable: false },
  ], ixData);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx.add(ix);
  return tx;
}
