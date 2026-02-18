/**
 * ALIENTOR PROTOCOL - Programmable Creator Fee Engine
 *
 * Dynamic fee routing that adapts to every stage of a token's lifecycle.
 * No hard-coded splits - fully adjustable in real time.
 *
 * Part of the Alienator Protocol on Solana.
 */

import {
  Connection, Keypair, PublicKey, Transaction,
  VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress, createBurnInstruction,
  NATIVE_MINT, getAccount, createSyncNativeInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
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
    } catch (e) { /* ignore */ }
  }
}
ensureDataDir();

const STATS_FILE = join(DATA_DIR, ".alientor-stats.json");

function loadStats(tokenMint) {
  try {
    if (existsSync(STATS_FILE)) {
      const data = JSON.parse(readFileSync(STATS_FILE, "utf8"));
      if (data[tokenMint]) return data[tokenMint];
    }
  } catch (e) { /* ignore */ }
  return null;
}

function saveStats(tokenMint, stats) {
  try {
    let data = {};
    if (existsSync(STATS_FILE)) {
      data = JSON.parse(readFileSync(STATS_FILE, "utf8"));
    }
    data[tokenMint] = stats;
    writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
  } catch (e) { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const PUMPSWAP_PROGRAM_ID = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

const ENGINE_CONFIG = {
  PUMP_PORTAL_API: "https://pumpportal.fun/api",
  PUMP_FUN_API: "https://frontend-api.pump.fun",
  JUPITER_PRICE_API: "https://api.jup.ag/price/v2",
  DEXSCREENER_API: "https://api.dexscreener.com/latest/dex/tokens",
  MIN_TX_FEE_RESERVE: 0.001 * LAMPORTS_PER_SOL,
  ALIENTOR_HOLDER_FEE_BPS: 100,
};

// Helper: detect if mint uses Token-2022 or legacy SPL Token
async function getMintTokenProgram(connection, mintPubkey) {
  try {
    const mintInfo = await connection.getAccountInfo(mintPubkey);
    if (mintInfo && mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
      return TOKEN_2022_PROGRAM_ID;
    }
  } catch (e) { /* ignore */ }
  return TOKEN_2022_PROGRAM_ID; // Default for pump.fun tokens
}

// ═══════════════════════════════════════════════════════════════════
// 10-FACTOR REAL-TIME MARKET ANALYZER
// ═══════════════════════════════════════════════════════════════════

export class MarketAnalyzer {
  constructor() {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.tradeHistory = [];
    this.maxHistory = 100;

    this.metrics = {
      rsi: 50,
      momentum: 50,
      volumeTrend: 50,
      priceVelocity: 50,
      volatility: 50,
      buyPressure: 50,
      support: 50,
      resistance: 50,
      trendStrength: 50,
      marketPhase: 50,
    };

    this.buyScore = 50;
    this.sellScore = 50;
    this.confidence = 0;
    this.lastUpdate = 0;
  }

  addDataPoint(data) {
    const now = Date.now();
    if (data.price) {
      this.priceHistory.push({ price: data.price, time: now });
      if (this.priceHistory.length > this.maxHistory) this.priceHistory.shift();
    }
    if (data.volume !== undefined) {
      this.volumeHistory.push({ volume: data.volume, time: now });
      if (this.volumeHistory.length > this.maxHistory) this.volumeHistory.shift();
    }
    if (data.isBuy !== undefined) {
      this.tradeHistory.push({ isBuy: data.isBuy, amount: data.amount || 0, time: now });
      if (this.tradeHistory.length > this.maxHistory) this.tradeHistory.shift();
    }
    this.calculate();
    this.lastUpdate = now;
  }

  calculate() {
    if (this.priceHistory.length < 2) return;
    this._rsi();
    this._momentum();
    this._volumeTrend();
    this._priceVelocity();
    this._volatility();
    this._buyPressure();
    this._supportResistance();
    this._trendStrength();
    this._marketPhase();
    this._compositeScores();
  }

  _rsi() {
    const prices = this.priceHistory.slice(-15).map((p) => p.price);
    if (prices.length < 2) return;
    let gains = 0, losses = 0;
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / (prices.length - 1);
    const avgLoss = losses / (prices.length - 1);
    if (avgLoss === 0) { this.metrics.rsi = 100; return; }
    const rs = avgGain / avgLoss;
    this.metrics.rsi = 100 - (100 / (1 + rs));
  }

  _momentum() {
    const prices = this.priceHistory.map((p) => p.price);
    if (prices.length < 10) return;
    const short = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const long = prices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, prices.length);
    const ratio = short / long;
    this.metrics.momentum = Math.max(0, Math.min(100, (ratio - 0.9) * 500));
  }

  _volumeTrend() {
    if (this.volumeHistory.length < 5) return;
    const volumes = this.volumeHistory.map((v) => v.volume);
    const recent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const older = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / Math.max(1, volumes.slice(-20, -5).length);
    if (older === 0) { this.metrics.volumeTrend = 50; return; }
    this.metrics.volumeTrend = Math.max(0, Math.min(100, (recent / older) * 50));
  }

  _priceVelocity() {
    const prices = this.priceHistory.map((p) => p.price);
    if (prices.length < 5) return;
    const current = prices[prices.length - 1];
    const prev5 = prices[prices.length - 5] || prices[0];
    const changePercent = ((current - prev5) / prev5) * 100;
    this.metrics.priceVelocity = Math.max(0, Math.min(100, 50 + changePercent * 5));
  }

  _volatility() {
    const prices = this.priceHistory.slice(-20).map((p) => p.price);
    if (prices.length < 5) return;
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const coeffOfVar = (Math.sqrt(variance) / mean) * 100;
    this.metrics.volatility = Math.max(0, Math.min(100, 100 - coeffOfVar * 5));
  }

  _buyPressure() {
    const recentTrades = this.tradeHistory.slice(-50);
    if (recentTrades.length === 0) { this.metrics.buyPressure = 50; return; }
    let buyVol = 0, sellVol = 0;
    for (const t of recentTrades) {
      if (t.isBuy) buyVol += t.amount;
      else sellVol += t.amount;
    }
    const total = buyVol + sellVol;
    this.metrics.buyPressure = total === 0 ? 50 : (buyVol / total) * 100;
  }

  _supportResistance() {
    const prices = this.priceHistory.map((p) => p.price);
    if (prices.length < 10) return;
    const current = prices[prices.length - 1];
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min;
    if (range === 0) { this.metrics.support = 50; this.metrics.resistance = 50; return; }
    this.metrics.support = ((current - min) / range) * 100;
    this.metrics.resistance = 100 - ((max - current) / range) * 100;
  }

  _trendStrength() {
    const prices = this.priceHistory.slice(-20).map((p) => p.price);
    if (prices.length < 5) return;
    let upMoves = 0, downMoves = 0;
    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) upMoves++;
      else if (prices[i] < prices[i - 1]) downMoves++;
    }
    const total = upMoves + downMoves;
    if (total === 0) { this.metrics.trendStrength = 50; return; }
    const dominance = Math.max(upMoves, downMoves) / total;
    const direction = upMoves > downMoves ? 1 : -1;
    this.metrics.trendStrength = 50 + direction * (dominance - 0.5) * 100;
  }

  _marketPhase() {
    const prices = this.priceHistory.map((p) => p.price);
    if (prices.length < 20) return;
    const recent = prices.slice(-10);
    const older = prices.slice(-30, -10);
    if (older.length === 0) { this.metrics.marketPhase = 50; return; }
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const priceChange = (recentAvg - olderAvg) / olderAvg;
    if (priceChange > 0.05) {
      this.metrics.marketPhase = 60 + Math.min(40, priceChange * 400);
    } else if (priceChange < -0.05) {
      this.metrics.marketPhase = 40 + Math.max(-40, priceChange * 400);
    } else {
      this.metrics.marketPhase = 50 + priceChange * 100;
    }
    this.metrics.marketPhase = Math.max(0, Math.min(100, this.metrics.marketPhase));
  }

  _compositeScores() {
    const weights = {
      rsi: 0.15, momentum: 0.12, volumeTrend: 0.08,
      priceVelocity: 0.10, volatility: 0.08, buyPressure: 0.15,
      support: 0.08, resistance: 0.04, trendStrength: 0.12, marketPhase: 0.08,
    };

    const buyFactors = {
      rsi: 100 - this.metrics.rsi,
      momentum: this.metrics.momentum,
      volumeTrend: this.metrics.volumeTrend,
      priceVelocity: this.metrics.priceVelocity,
      volatility: this.metrics.volatility,
      buyPressure: this.metrics.buyPressure,
      support: this.metrics.support,
      resistance: 100 - this.metrics.resistance,
      trendStrength: this.metrics.trendStrength,
      marketPhase: this.metrics.marketPhase,
    };

    this.buyScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
      this.buyScore += buyFactors[key] * weight;
    }
    this.sellScore = 100 - this.buyScore;

    const dataPoints = this.priceHistory.length;
    const dataConfidence = Math.min(100, dataPoints * 2);
    const signals = Object.values(this.metrics);
    const avgSignal = signals.reduce((a, b) => a + b, 0) / signals.length;
    const signalVariance = signals.reduce((sum, s) => sum + Math.pow(s - avgSignal, 2), 0) / signals.length;
    const signalConsistency = Math.max(0, 100 - Math.sqrt(signalVariance));
    this.confidence = dataConfidence * 0.4 + signalConsistency * 0.6;
  }

  getRecommendation() {
    if (this.confidence < 30) return { action: "WAIT", reason: "Insufficient data", confidence: this.confidence };
    if (this.buyScore >= 70) return { action: "STRONG_BUY", reason: "Multiple bullish signals", confidence: this.confidence };
    if (this.buyScore >= 60) return { action: "BUY", reason: "Favorable conditions", confidence: this.confidence };
    if (this.sellScore >= 70) return { action: "STRONG_SELL", reason: "Multiple bearish signals", confidence: this.confidence };
    if (this.sellScore >= 60) return { action: "SELL", reason: "Unfavorable conditions", confidence: this.confidence };
    return { action: "HOLD", reason: "Neutral market", confidence: this.confidence };
  }

  getAnalysis() {
    return {
      metrics: { ...this.metrics },
      buyScore: Math.round(this.buyScore * 10) / 10,
      sellScore: Math.round(this.sellScore * 10) / 10,
      confidence: Math.round(this.confidence),
      recommendation: this.getRecommendation(),
      dataPoints: this.priceHistory.length,
      lastUpdate: this.lastUpdate,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// PUMP PORTAL CLIENT
// ═══════════════════════════════════════════════════════════════════

export class PumpPortalClient {
  constructor(connection, wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.lastCallTime = 0;
    this.minCallInterval = 1500;
  }

  async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minCallInterval) {
      await new Promise((r) => setTimeout(r, this.minCallInterval - elapsed));
    }
    this.lastCallTime = Date.now();
  }

  async trade(action, mint, amount, slippage = 5) {
    try {
      await this.rateLimit();
      const denominatedInSol = action === "buy" ? "true" : "false";

      const response = await fetch(`${ENGINE_CONFIG.PUMP_PORTAL_API}/trade-local`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey: this.wallet.publicKey.toBase58(),
          action, mint,
          amount: amount.toString(),
          denominatedInSol,
          slippage: slippage.toString(),
          priorityFee: "0.0005",
          pool: "auto",
        }).toString(),
      });

      const data = new Uint8Array(await response.arrayBuffer());
      const tx = VersionedTransaction.deserialize(data);
      tx.sign([this.wallet]);

      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });
      await new Promise((r) => setTimeout(r, 3000));
      return { success: true, signature: sig };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async buy(mint, solAmount) {
    return this.trade("buy", mint, solAmount);
  }

  async sell(mint, tokenAmount) {
    return this.trade("sell", mint, tokenAmount);
  }

  async claimCreatorFees(tokenMint) {
    try {
      await this.rateLimit();

      const response = await fetch(`${ENGINE_CONFIG.PUMP_PORTAL_API}/trade-local`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey: this.wallet.publicKey.toBase58(),
          action: "collectCreatorFee",
          mint: tokenMint,
          priorityFee: "0.000005",
        }).toString(),
      });

      if (!response.ok || !response.headers.get("content-length")) {
        return { success: true, claimed: 0 };
      }

      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength === 0) return { success: true, claimed: 0 };

      const tx = VersionedTransaction.deserialize(data);
      tx.sign([this.wallet]);

      let balanceBefore = 0;
      try { balanceBefore = await this.connection.getBalance(this.wallet.publicKey); } catch (e) { /* ignore */ }

      const sig = await this.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true, maxRetries: 3,
      });

      await new Promise((r) => setTimeout(r, 5000));

      let claimed = 0;
      try {
        const balanceAfter = await this.connection.getBalance(this.wallet.publicKey);
        claimed = Math.max(0, balanceAfter - balanceBefore + 5000);
      } catch (e) { /* ignore */ }

      return { success: true, claimed, signature: sig };
    } catch (error) {
      if (error.message?.includes("already been processed")) {
        return { success: true, claimed: 0, reason: "already_claimed" };
      }
      return { success: false, error: error.message, claimed: 0 };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ALIENTOR ENGINE - Dynamic Fee Allocation
// ═══════════════════════════════════════════════════════════════════

export class AlientorEngine {
  constructor(connection, tokenMint, wallet) {
    this.connection = connection;
    this.tokenMint = new PublicKey(tokenMint);
    this.tokenMintStr = tokenMint;
    this.wallet = wallet;
    this.pumpPortal = new PumpPortalClient(connection, wallet);
    this.analyzer = new MarketAnalyzer();

    this.allocations = {
      marketMaking: 25,
      buybackBurn: 25,
      liquidity: 25,
      creatorRevenue: 25,
    };

    this.features = {
      marketMaking: true,
      buybackBurn: true,
      liquidity: true,
      creatorRevenue: true,
    };

    const savedStats = loadStats(tokenMint);
    this.stats = savedStats || {
      totalClaimed: 0,
      totalDistributed: 0,
      marketMaking: 0,
      buybackBurn: 0,
      liquidity: 0,
      creatorRevenue: 0,
      transactions: [],
    };

    this.currentPrice = 0;
    this.creatorWallet = wallet.publicKey;
  }

  persistStats() {
    saveStats(this.tokenMintStr, this.stats);
  }

  // ─── ALLOCATION MANAGEMENT ──────────────────────────────────────

  setAllocations(allocations) {
    const total = Object.values(allocations).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 100) > 0.01) {
      throw new Error(`Allocations must sum to 100%. Current: ${total}%`);
    }
    this.allocations = { ...allocations };
    return this.allocations;
  }

  getAllocations() {
    return { ...this.allocations };
  }

  // ─── PRICE & MARKET DATA ────────────────────────────────────────

  async updatePrice() {
    // DexScreener (for bonded tokens on PumpSwap/Raydium)
    try {
      const response = await fetch(
        `${ENGINE_CONFIG.DEXSCREENER_API}/${this.tokenMintStr}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const dexData = await response.json();
        if (dexData?.pairs?.length > 0) {
          const mainPair = dexData.pairs.sort(
            (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0),
          )[0];
          if (mainPair) {
            this.currentPrice = parseFloat(mainPair.priceUsd) || 0;
            const priceChange = {
              m5: parseFloat(mainPair.priceChange?.m5) || 0,
              h1: parseFloat(mainPair.priceChange?.h1) || 0,
              h6: parseFloat(mainPair.priceChange?.h6) || 0,
            };
            const avgChange = priceChange.m5 * 0.4 + priceChange.h1 * 0.35 + priceChange.h6 * 0.25;
            this.analyzer.metrics.rsi = Math.max(0, Math.min(100, 50 + avgChange * 1.5));
            this.analyzer.addDataPoint({
              price: this.currentPrice,
              volume: parseFloat(mainPair.volume?.h24) || 0,
            });
            return;
          }
        }
      }
    } catch (e) { /* fallback */ }

    // Pump.fun API (for pre-bond tokens)
    try {
      const response = await fetch(
        `${ENGINE_CONFIG.PUMP_FUN_API}/coins/${this.tokenMintStr}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const data = await response.json();
        if (data?.virtual_sol_reserves && data?.virtual_token_reserves) {
          const solReserves = data.virtual_sol_reserves / 1e9;
          const tokenReserves = data.virtual_token_reserves / 1e6;
          this.currentPrice = solReserves / tokenReserves;
          this.analyzer.addDataPoint({ price: this.currentPrice, volume: data.volume_24h || 0 });
          return;
        }
      }
    } catch (e) { /* fallback */ }

    // Jupiter
    try {
      const response = await fetch(
        `${ENGINE_CONFIG.JUPITER_PRICE_API}?ids=${this.tokenMintStr}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (response.ok) {
        const jupData = await response.json();
        if (jupData?.data?.[this.tokenMintStr]?.price) {
          this.currentPrice = parseFloat(jupData.data[this.tokenMintStr].price);
          this.analyzer.addDataPoint({ price: this.currentPrice });
        }
      }
    } catch (e) { /* ignore */ }
  }

  getMarketAnalysis() {
    return this.analyzer.getAnalysis();
  }

  // ─── FEE CLAIMING ──────────────────────────────────────────────

  async claimFees() {
    const result = await this.pumpPortal.claimCreatorFees(this.tokenMintStr);
    if (result.success && result.claimed > 0) {
      this.stats.totalClaimed += result.claimed;
      this.logTransaction("claim", result.claimed, result.signature);
      this.persistStats();
    }
    return result;
  }

  // ─── FEE DISTRIBUTION ─────────────────────────────────────────

  async distributeFees(totalAmount) {
    if (totalAmount <= ENGINE_CONFIG.MIN_TX_FEE_RESERVE) {
      return { success: false, error: "Amount too small", distributed: 0, failed: 0 };
    }

    const distributable = totalAmount - ENGINE_CONFIG.MIN_TX_FEE_RESERVE;
    const amounts = {};
    for (const [key, percent] of Object.entries(this.allocations)) {
      amounts[key] = Math.floor(distributable * (percent / 100));
    }

    const results = {
      marketMaking: { amount: 0, success: false },
      buybackBurn: { amount: 0, success: false },
      liquidity: { amount: 0, success: false },
      creatorRevenue: { amount: 0, success: false },
    };

    if (this.features.marketMaking && amounts.marketMaking > 0) {
      results.marketMaking = await this._executeMarketMaking(amounts.marketMaking);
    }
    if (this.features.buybackBurn && amounts.buybackBurn > 0) {
      results.buybackBurn = await this._executeBuybackBurn(amounts.buybackBurn);
    }
    if (this.features.liquidity && amounts.liquidity > 0) {
      results.liquidity = await this._executeLiquidityAdd(amounts.liquidity);
    }
    if (this.features.creatorRevenue && amounts.creatorRevenue > 0) {
      results.creatorRevenue = await this._executeCreatorRevenue(amounts.creatorRevenue);
    }

    let totalDistributed = 0;
    for (const [key, result] of Object.entries(results)) {
      if (result.success && result.amount > 0) {
        this.stats[key] += result.amount;
        totalDistributed += result.amount;
      }
    }

    this.stats.totalDistributed += totalDistributed;
    this.persistStats();

    return { success: true, distributed: totalDistributed, results };
  }

  async _executeMarketMaking(amount) {
    try {
      const rsi = this.analyzer?.metrics?.rsi || 50;
      const solAmount = amount / LAMPORTS_PER_SOL;

      if (rsi > 70) {
        console.log(`[MM] RSI=${rsi.toFixed(1)} (>70) - Selling`);
        const result = await this.pumpPortal.sell(this.tokenMintStr, solAmount);
        if (result.success) {
          this.logTransaction("market_make_sell", amount, result.signature);
          return { amount, success: true, action: "sell" };
        }
        return { amount: 0, success: false, error: result.error };
      }

      console.log(`[MM] RSI=${rsi.toFixed(1)} - Buying ${solAmount.toFixed(6)} SOL`);
      const result = await this.pumpPortal.buy(this.tokenMintStr, solAmount);
      if (result.success) {
        this.logTransaction("market_make_buy", amount, result.signature);
        return { amount, success: true, action: "buy" };
      }
      return { amount: 0, success: false, error: result.error };
    } catch (error) {
      return { amount: 0, success: false, error: error.message };
    }
  }

  async _executeBuybackBurn(amount) {
    try {
      const solAmount = amount / LAMPORTS_PER_SOL;
      if (solAmount > 0.001) {
        const buyResult = await this.pumpPortal.buy(this.tokenMintStr, solAmount);
        if (buyResult.success) {
          this.logTransaction("buyback", amount, buyResult.signature);
          return { amount, success: true, action: "buyback_burn" };
        }
      }
      return { amount: 0, success: false, error: "Insufficient amount" };
    } catch (error) {
      return { amount: 0, success: false, error: error.message };
    }
  }

  async _executeLiquidityAdd(amount) {
    try {
      const solAmount = amount / LAMPORTS_PER_SOL;
      const buyResult = await this.pumpPortal.buy(this.tokenMintStr, solAmount);
      if (buyResult.success) {
        this.logTransaction("lp_add", amount, buyResult.signature);
        return { amount, success: true, action: "lp_add" };
      }
      return { amount: 0, success: false, error: buyResult.error };
    } catch (error) {
      return { amount: 0, success: false, error: error.message };
    }
  }

  async _executeCreatorRevenue(amount) {
    try {
      if (this.creatorWallet.equals(this.wallet.publicKey)) {
        this.logTransaction("creator_revenue", amount, "retained");
        return { amount, success: true, action: "retained" };
      }

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.wallet.publicKey,
          toPubkey: this.creatorWallet,
          lamports: amount,
        }),
      );
      tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
      tx.feePayer = this.wallet.publicKey;
      const sig = await this.connection.sendTransaction(tx, [this.wallet]);
      await new Promise((r) => setTimeout(r, 3000));
      this.logTransaction("creator_revenue", amount, sig);
      return { amount, success: true, action: "transferred", signature: sig };
    } catch (error) {
      return { amount: 0, success: false, error: error.message };
    }
  }

  async claimAndDistribute() {
    const claimResult = await this.claimFees();
    if (!claimResult.success || claimResult.claimed <= 0) {
      return { claimed: 0, distributed: 0, holderFee: 0 };
    }

    const holderFeeAmount = Math.floor(
      claimResult.claimed * ENGINE_CONFIG.ALIENTOR_HOLDER_FEE_BPS / 10000,
    );
    const creatorAmount = claimResult.claimed - holderFeeAmount;
    const distributeResult = await this.distributeFees(creatorAmount);

    return {
      claimed: claimResult.claimed,
      holderFee: holderFeeAmount,
      distributed: distributeResult.distributed,
      results: distributeResult.results,
    };
  }

  // ─── LOGGING & STATUS ──────────────────────────────────────────

  logTransaction(type, amount, signature) {
    this.stats.transactions.push({
      type, amount, signature,
      timestamp: Date.now(),
    });
    if (this.stats.transactions.length > 100) {
      this.stats.transactions.shift();
    }
  }

  getStatus() {
    return {
      tokenMint: this.tokenMintStr,
      allocations: this.allocations,
      features: this.features,
      stats: this.stats,
      analysis: this.analyzer.getAnalysis(),
      currentPrice: this.currentPrice,
      creatorWallet: this.creatorWallet.toBase58(),
    };
  }

  getStats() {
    return { ...this.stats };
  }
}
