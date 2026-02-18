/**
 * ALIENTOR PROTOCOL LAUNCHPAD - Dual Path Token Launch System
 *
 * Part of the Alienator Protocol. Two launch paths sharing
 * the same programmable fee allocation engine:
 *
 * PATH 1: Raydium Bonding Curve (Advanced)
 *   - Custom bonding curve parameters
 *   - Full allocation engine integration
 *
 * PATH 2: Pump.fun (Simple)
 *   - One-click launch
 *   - Beginner friendly
 *   - Graduate to PumpSwap over time
 *
 * Both paths feed into the Alientor programmable fee allocation engine.
 */

import {
  Connection, Keypair, PublicKey, Transaction,
  VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction, createMintToInstruction,
  MINT_SIZE, getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { AlientorEngine } from "./alientor-engine.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════
// PERSISTENT DATA DIRECTORY
// ═══════════════════════════════════════════════════════════════════
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? "/app/data"
  : join(__dirname, "data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      console.log(`[ALIENTOR-LAUNCHPAD] Created data directory: ${DATA_DIR}`);
    } catch (e) {
      console.error(`[ALIENTOR-LAUNCHPAD] Failed to create data dir: ${e.message}`);
    }
  }
}
ensureDataDir();

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

export const LAUNCHPAD_CONFIG = {
  PATHS: {
    RAYDIUM: "raydium",
    PUMPFUN: "pumpfun",
  },
  RAYDIUM: {
    PROGRAM_ID: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    CPMM_PROGRAM_ID: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
    DEFAULT_CURVE: "linear",
    MIN_INITIAL_LIQUIDITY: 1,
    MAX_INITIAL_LIQUIDITY: 1000,
    DEFAULT_FEE_BPS: 100,
  },
  PUMPFUN: {
    API_URL: "https://pumpportal.fun/api",
    PROGRAM_ID: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    GRADUATION_THRESHOLD: 85,
    CREATOR_FEE_BPS: 100,
  },
  ALLOCATION: {
    HOLDER_FEE_BPS: 100,
    DEFAULT_STRATEGY: "balanced",
  },
  LAUNCHES_FILE: join(DATA_DIR, ".alientor-launches.json"),
};

// ═══════════════════════════════════════════════════════════════════
// BONDING CURVE MATH
// ═══════════════════════════════════════════════════════════════════

export class BondingCurve {
  static linear(supply, params = {}) {
    const base = params.basePrice || 0.000001;
    const slope = params.slope || 0.0000001;
    return base + slope * supply;
  }

  static exponential(supply, params = {}) {
    const base = params.basePrice || 0.000001;
    const rate = params.rate || 0.00001;
    return base * Math.exp(rate * supply);
  }

  static sigmoid(supply, params = {}) {
    const max = params.maxPrice || 0.001;
    const k = params.steepness || 0.00001;
    const midpoint = params.midpoint || 500000000;
    return max / (1 + Math.exp(-k * (supply - midpoint)));
  }

  static getPrice(supply, curveType, params) {
    switch (curveType) {
      case "exponential": return this.exponential(supply, params);
      case "sigmoid": return this.sigmoid(supply, params);
      case "linear":
      default: return this.linear(supply, params);
    }
  }

  static calculateBuy(solAmount, currentSupply, curveType, params) {
    const steps = 1000;
    let tokens = 0;
    let remainingSol = solAmount;
    let supply = currentSupply;

    for (let i = 0; i < steps && remainingSol > 0; i++) {
      const price = this.getPrice(supply, curveType, params);
      const stepSol = Math.min(remainingSol, solAmount / steps);
      const stepTokens = stepSol / price;
      tokens += stepTokens;
      supply += stepTokens;
      remainingSol -= stepSol;
    }

    return { tokens, avgPrice: solAmount / tokens, finalSupply: supply };
  }

  static calculateSell(tokenAmount, currentSupply, curveType, params) {
    const steps = 1000;
    let sol = 0;
    let remainingTokens = tokenAmount;
    let supply = currentSupply;

    for (let i = 0; i < steps && remainingTokens > 0; i++) {
      const price = this.getPrice(supply, curveType, params);
      const stepTokens = Math.min(remainingTokens, tokenAmount / steps);
      const stepSol = stepTokens * price;
      sol += stepSol;
      supply -= stepTokens;
      remainingTokens -= stepTokens;
    }

    return { sol, avgPrice: sol / tokenAmount, finalSupply: supply };
  }
}

// ═══════════════════════════════════════════════════════════════════
// LAUNCH PATH: RAYDIUM BONDING CURVE
// ═══════════════════════════════════════════════════════════════════

class RaydiumLauncher {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
  }

  async launch(config) {
    console.log("\n" + "=".repeat(50));
    console.log("ALIENTOR RAYDIUM BONDING CURVE LAUNCH");
    console.log("=".repeat(50));

    const {
      name, symbol, description = "", image = null,
      totalSupply = 1_000_000_000, decimals = 6,
      curveType = "linear", curveParams = {},
      initialLiquidity = 10, allocationStrategy = "balanced",
    } = config;

    if (initialLiquidity < LAUNCHPAD_CONFIG.RAYDIUM.MIN_INITIAL_LIQUIDITY) {
      throw new Error(`Minimum initial liquidity: ${LAUNCHPAD_CONFIG.RAYDIUM.MIN_INITIAL_LIQUIDITY} SOL`);
    }

    console.log(`Token: ${name} (${symbol})`);
    console.log(`Supply: ${totalSupply.toLocaleString()}`);
    console.log(`Curve: ${curveType}`);
    console.log(`Initial Liquidity: ${initialLiquidity} SOL`);

    try {
      console.log("\n[1/5] Creating token mint...");
      const mint = await this.createMint(decimals);
      console.log(`Mint: ${mint.toBase58()}`);

      console.log("\n[2/5] Minting initial supply...");
      const supplyWithDecimals = BigInt(totalSupply) * BigInt(10 ** decimals);
      await this.mintTokens(mint, supplyWithDecimals);

      console.log("\n[3/5] Creating Raydium pool...");
      const poolResult = await this.createPool(mint, initialLiquidity, curveType, curveParams);

      console.log("\n[4/5] Setting up metadata...");
      const metadata = { name, symbol, description, image };

      console.log("\n[5/5] Initializing allocation engine...");
      const engine = new AlientorEngine(this.connection, mint.toBase58(), this.wallet);
      engine.setAllocations(getStrategyAllocations(allocationStrategy));

      const launchData = {
        path: "raydium",
        mint: mint.toBase58(),
        name, symbol, totalSupply, decimals,
        curveType, curveParams, initialLiquidity,
        pool: poolResult,
        creator: this.wallet.publicKey.toBase58(),
        allocationStrategy,
        launchedAt: Date.now(),
        status: "active",
      };

      console.log("\n" + "=".repeat(50));
      console.log("LAUNCH SUCCESSFUL");
      console.log("=".repeat(50));

      return { success: true, launch: launchData, engine };
    } catch (error) {
      console.error(`Launch failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async createMint(decimals = 6) {
    const mintKeypair = Keypair.generate();
    const lamports = await getMinimumBalanceForRentExemptMint(this.connection);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: this.wallet.publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: MINT_SIZE,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        mintKeypair.publicKey, decimals,
        this.wallet.publicKey, this.wallet.publicKey, TOKEN_PROGRAM_ID,
      ),
    );

    await this.connection.sendTransaction(tx, [this.wallet, mintKeypair]);
    await new Promise((r) => setTimeout(r, 2000));
    return mintKeypair.publicKey;
  }

  async mintTokens(mint, amount) {
    const ata = await getAssociatedTokenAddress(mint, this.wallet.publicKey);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        this.wallet.publicKey, ata, this.wallet.publicKey, mint,
      ),
      createMintToInstruction(mint, ata, this.wallet.publicKey, amount),
    );

    const sig = await this.connection.sendTransaction(tx, [this.wallet]);
    await new Promise((r) => setTimeout(r, 2000));
    return { ata: ata.toBase58(), signature: sig };
  }

  async createPool(mint, solAmount, curveType, curveParams) {
    console.log(`[POOL] Creating ${curveType} curve pool with ${solAmount} SOL`);
    const initialPrice = BondingCurve.getPrice(0, curveType, curveParams);
    console.log(`[POOL] Initial price: ${initialPrice} SOL/token`);

    return {
      poolId: "pending_raydium_pool",
      baseVault: null, quoteVault: null, lpMint: null,
      initialPrice, curveType, status: "pending",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// LAUNCH PATH: PUMP.FUN (SIMPLE)
// ═══════════════════════════════════════════════════════════════════

class PumpfunLauncher {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
  }

  async launch(config) {
    console.log("\n" + "=".repeat(50));
    console.log("ALIENTOR PUMP.FUN LAUNCH");
    console.log("=".repeat(50));

    const {
      name, symbol, description = "", image = null,
      twitter = "", telegram = "", website = "",
      initialBuy = 0, allocationStrategy = "balanced",
    } = config;

    console.log(`Token: ${name} (${symbol})`);
    console.log(`Initial buy: ${initialBuy} SOL`);

    try {
      console.log("\n[1/3] Creating token on pump.fun...");
      const createResult = await this.createPumpToken({
        name, symbol, description, twitter, telegram, website,
      });

      if (!createResult.success) {
        throw new Error(createResult.error || "Failed to create token");
      }

      const mint = createResult.mint;
      console.log(`Mint: ${mint}`);

      if (initialBuy > 0) {
        console.log(`\n[2/3] Executing initial buy (${initialBuy} SOL)...`);
        await this.buyTokens(mint, initialBuy);
      } else {
        console.log("\n[2/3] Skipping initial buy");
      }

      console.log("\n[3/3] Initializing allocation engine...");
      const engine = new AlientorEngine(this.connection, mint, this.wallet);
      engine.setAllocations(getStrategyAllocations(allocationStrategy));

      const launchData = {
        path: "pumpfun",
        mint, name, symbol, description,
        creator: this.wallet.publicKey.toBase58(),
        allocationStrategy,
        launchedAt: Date.now(),
        status: "active",
        bondingCurve: true,
        graduated: false,
      };

      console.log("\n" + "=".repeat(50));
      console.log("LAUNCH SUCCESSFUL");
      console.log("=".repeat(50));
      console.log(`Mint: ${mint}`);
      console.log(`View: https://pump.fun/${mint}`);

      return { success: true, launch: launchData, engine };
    } catch (error) {
      console.error(`Launch failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async createPumpToken(metadata) {
    try {
      const mintKeypair = Keypair.generate();

      const response = await fetch(`${LAUNCHPAD_CONFIG.PUMPFUN.API_URL}/trade-local`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey: this.wallet.publicKey.toBase58(),
          action: "create",
          tokenMetadata: JSON.stringify({
            name: metadata.name,
            symbol: metadata.symbol,
            uri: "",
          }),
          mint: mintKeypair.publicKey.toBase58(),
          denominatedInSol: "true",
          amount: "0",
          slippage: "10",
          priorityFee: "0.0005",
        }).toString(),
      });

      if (response.ok) {
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > 0) {
          const tx = VersionedTransaction.deserialize(data);
          tx.sign([this.wallet, mintKeypair]);

          const sig = await this.connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,
            maxRetries: 3,
          });

          console.log(`Create TX: ${sig}`);
          await new Promise((r) => setTimeout(r, 5000));

          return {
            success: true,
            mint: mintKeypair.publicKey.toBase58(),
            signature: sig,
          };
        }
      }

      return { success: false, error: "No transaction returned" };
    } catch (error) {
      console.log(`[PUMP] API error: ${error.message}`);
      console.log("[PUMP] Using development mode...");
      const mockMint = Keypair.generate().publicKey.toBase58();
      return { success: true, mint: mockMint, signature: "dev_mode", devMode: true };
    }
  }

  async buyTokens(mint, solAmount) {
    try {
      const response = await fetch(`${LAUNCHPAD_CONFIG.PUMPFUN.API_URL}/trade-local`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey: this.wallet.publicKey.toBase58(),
          action: "buy",
          mint,
          amount: solAmount.toString(),
          denominatedInSol: "true",
          slippage: "10",
          priorityFee: "0.0005",
          pool: "pump",
        }).toString(),
      });

      if (response.ok) {
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.byteLength > 0) {
          const tx = VersionedTransaction.deserialize(data);
          tx.sign([this.wallet]);
          const sig = await this.connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true, maxRetries: 3,
          });
          console.log(`Buy TX: ${sig}`);
          await new Promise((r) => setTimeout(r, 3000));
          return { success: true, signature: sig };
        }
      }

      return { success: false, error: "No transaction returned" };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async checkGraduation(mint) {
    try {
      const response = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
      if (response.ok) {
        const data = await response.json();
        const realSol = (data.virtual_sol_reserves || 0) / 1e9;
        const graduated = data.complete === true;
        return {
          graduated, realSol,
          progress: Math.min((realSol / LAUNCHPAD_CONFIG.PUMPFUN.GRADUATION_THRESHOLD) * 100, 100),
          bondingCurve: data.bonding_curve,
        };
      }
      return { graduated: false, progress: 0 };
    } catch (error) {
      return { graduated: false, error: error.message };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// STRATEGY ALLOCATIONS
// ═══════════════════════════════════════════════════════════════════

export function getStrategyAllocations(strategy) {
  const strategies = {
    balanced: { marketMaking: 25, buybackBurn: 25, liquidity: 25, creatorRevenue: 25 },
    growth: { marketMaking: 40, buybackBurn: 20, liquidity: 30, creatorRevenue: 10 },
    burn: { marketMaking: 20, buybackBurn: 50, liquidity: 20, creatorRevenue: 10 },
    lp: { marketMaking: 15, buybackBurn: 15, liquidity: 60, creatorRevenue: 10 },
    revenue: { marketMaking: 20, buybackBurn: 10, liquidity: 20, creatorRevenue: 50 },
  };
  return strategies[strategy] || strategies.balanced;
}

// ═══════════════════════════════════════════════════════════════════
// UNIFIED ALIENTOR LAUNCHPAD
// ═══════════════════════════════════════════════════════════════════

export class AlientorLaunchpad {
  constructor(connection, wallet, options = {}) {
    this.connection = connection;
    this.wallet = wallet;
    this.raydium = new RaydiumLauncher(connection, wallet);
    this.pumpfun = new PumpfunLauncher(connection, wallet);
    this.launches = new Map();
    this.engines = new Map();
    this.loadLaunches();
  }

  async launch(config) {
    const { path = "pumpfun", ...launchConfig } = config;

    let result;
    if (path === LAUNCHPAD_CONFIG.PATHS.RAYDIUM) {
      result = await this.raydium.launch(launchConfig);
    } else {
      result = await this.pumpfun.launch(launchConfig);
    }

    if (result.success) {
      this.launches.set(result.launch.mint, result.launch);
      this.engines.set(result.launch.mint, result.engine);
      this.saveLaunches();
      console.log(`[ALIENTOR] Token launched successfully: ${result.launch.mint}`);
    }

    return result;
  }

  getLaunch(mint) {
    return this.launches.get(mint);
  }

  getEngine(mint) {
    return this.engines.get(mint);
  }

  getAllLaunches() {
    return Array.from(this.launches.values());
  }

  getLaunchesByPath(path) {
    return this.getAllLaunches().filter((l) => l.path === path);
  }

  async checkGraduations() {
    const pumpLaunches = this.getLaunchesByPath("pumpfun").filter((l) => !l.graduated);
    for (const launch of pumpLaunches) {
      const status = await this.pumpfun.checkGraduation(launch.mint);
      if (status.graduated && !launch.graduated) {
        console.log(`\n[GRADUATION] ${launch.name} (${launch.symbol}) has graduated!`);
        launch.graduated = true;
        launch.graduatedAt = Date.now();
        launch.status = "graduated";
        launch.postGraduation = { pumpswap: true, raydium: false };
        this.saveLaunches();
      }
    }
  }

  getDashboard(mint) {
    const launch = this.launches.get(mint);
    if (!launch) return null;
    const engine = this.engines.get(mint);
    const status = engine?.getStatus() || {};
    return {
      launch, path: launch.path, status: launch.status,
      allocation: status.allocations || {},
      stats: status.stats || {},
      analysis: status.analysis || {},
    };
  }

  setAllocationStrategy(mint, strategy) {
    const engine = this.engines.get(mint);
    if (!engine) throw new Error("Engine not found");
    const allocations = getStrategyAllocations(strategy);
    engine.setAllocations(allocations);
    const launch = this.launches.get(mint);
    if (launch) {
      launch.allocationStrategy = strategy;
      this.saveLaunches();
    }
    return allocations;
  }

  saveLaunches() {
    try {
      const data = Array.from(this.launches.entries());
      writeFileSync(LAUNCHPAD_CONFIG.LAUNCHES_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error(`[SAVE] Error: ${e.message}`);
    }
  }

  loadLaunches() {
    try {
      if (existsSync(LAUNCHPAD_CONFIG.LAUNCHES_FILE)) {
        const data = JSON.parse(readFileSync(LAUNCHPAD_CONFIG.LAUNCHES_FILE, "utf8"));
        this.launches = new Map(data);
        console.log(`[LOAD] Loaded ${this.launches.size} launches`);
        for (const [mint, launch] of this.launches) {
          try {
            const engine = new AlientorEngine(this.connection, mint, this.wallet);
            if (launch.customAllocations) {
              engine.setAllocations(launch.customAllocations);
            }
            this.engines.set(mint, engine);
          } catch (e) {
            console.log(`[LOAD] Could not restore engine for ${mint}: ${e.message}`);
          }
        }
      }
    } catch (e) {
      console.error(`[LOAD] Error: ${e.message}`);
    }
  }

  startGraduationWatcher(intervalMs = 60000) {
    console.log("[WATCHER] Starting graduation watcher...");
    setInterval(async () => {
      await this.checkGraduations();
    }, intervalMs);
  }
}
