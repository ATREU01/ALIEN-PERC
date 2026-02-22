/**
 * MOLT BOT — Bonding Curve Management Agent
 *
 * Autonomous agent layer that sits between the Telegram bot and the
 * Alientor Protocol. Manages multiple bonding curves simultaneously,
 * tracks lifecycle phases, scores curve health, and routes actions
 * through the AlientorEngine.
 *
 * Lifecycle phases:
 *   PRE_BOND    → Token created, no meaningful volume yet
 *   BONDING     → Active bonding curve, accumulating SOL reserves
 *   GRADUATING  → Near graduation threshold (~85 SOL), high sensitivity
 *   GRADUATED   → Migrated to PumpSwap/Raydium, post-bond liquidity
 *   DORMANT     → No activity for extended period
 *
 * Part of the Alienator Protocol on Solana.
 */

import { BondingCurve } from "./alientor-launchpad.js";
import { MarketAnalyzer } from "./alientor-engine.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═══════════════════════════════════════════════════════════════════

const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? "/app/data"
  : join(__dirname, "data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ok */ }
  }
}
ensureDataDir();

const MOLT_STATE_FILE = join(DATA_DIR, ".molt-bot-state.json");

function loadMoltState() {
  try {
    if (existsSync(MOLT_STATE_FILE)) {
      return JSON.parse(readFileSync(MOLT_STATE_FILE, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

function saveMoltState(state) {
  try {
    writeFileSync(MOLT_STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const CURVE_PHASE = {
  PRE_BOND: "PRE_BOND",
  BONDING: "BONDING",
  GRADUATING: "GRADUATING",
  GRADUATED: "GRADUATED",
  DORMANT: "DORMANT",
};

const GRADUATION_THRESHOLD_SOL = 85;
const GRADUATING_ZONE_SOL = 70; // Start "graduating" phase at ~82%
const DORMANT_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours no activity
const MAX_TRACKED_CURVES = 50;
const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30 seconds

// Health score weights
const HEALTH_WEIGHTS = {
  volumeActivity: 0.20,
  priceStability: 0.15,
  curveProgress: 0.20,
  buyPressure: 0.15,
  holderGrowth: 0.10,
  liquidityDepth: 0.10,
  ageScore: 0.10,
};

// ═══════════════════════════════════════════════════════════════════
// TRACKED CURVE — Single curve state object
// ═══════════════════════════════════════════════════════════════════

class TrackedCurve {
  constructor(config) {
    this.mint = config.mint;
    this.name = config.name || "";
    this.symbol = config.symbol || "";
    this.curveType = config.curveType || "pumpfun"; // pumpfun | linear | exponential | sigmoid
    this.curveParams = config.curveParams || {};
    this.phase = CURVE_PHASE.PRE_BOND;
    this.addedAt = Date.now();
    this.lastActivityAt = Date.now();
    this.lastHealthCheck = 0;

    // Market state
    this.realSolReserves = 0;
    this.virtualSolReserves = 0;
    this.virtualTokenReserves = 0;
    this.mcap = 0;
    this.price = 0;
    this.volume24h = 0;
    this.holders = 0;
    this.graduated = false;

    // Computed scores
    this.healthScore = 0;
    this.riskLevel = "unknown"; // low | medium | high | critical
    this.recommendation = "WAIT";

    // History for trend analysis
    this.priceHistory = [];
    this.volumeHistory = [];
    this.phaseHistory = [{ phase: CURVE_PHASE.PRE_BOND, at: Date.now() }];

    // Analyzer instance (not serialized)
    this._analyzer = new MarketAnalyzer();

    // Alerts
    this.alerts = [];
    this.maxAlerts = 20;
  }

  addAlert(type, message) {
    this.alerts.unshift({ type, message, at: Date.now() });
    if (this.alerts.length > this.maxAlerts) this.alerts.pop();
  }

  toJSON() {
    return {
      mint: this.mint,
      name: this.name,
      symbol: this.symbol,
      curveType: this.curveType,
      curveParams: this.curveParams,
      phase: this.phase,
      addedAt: this.addedAt,
      lastActivityAt: this.lastActivityAt,
      lastHealthCheck: this.lastHealthCheck,
      realSolReserves: this.realSolReserves,
      virtualSolReserves: this.virtualSolReserves,
      virtualTokenReserves: this.virtualTokenReserves,
      mcap: this.mcap,
      price: this.price,
      volume24h: this.volume24h,
      holders: this.holders,
      graduated: this.graduated,
      healthScore: this.healthScore,
      riskLevel: this.riskLevel,
      recommendation: this.recommendation,
      priceHistory: this.priceHistory.slice(-50),
      volumeHistory: this.volumeHistory.slice(-50),
      phaseHistory: this.phaseHistory,
      alerts: this.alerts,
    };
  }

  static fromJSON(data) {
    const curve = new TrackedCurve({
      mint: data.mint,
      name: data.name,
      symbol: data.symbol,
      curveType: data.curveType,
      curveParams: data.curveParams,
    });
    Object.assign(curve, {
      phase: data.phase || CURVE_PHASE.PRE_BOND,
      addedAt: data.addedAt || Date.now(),
      lastActivityAt: data.lastActivityAt || Date.now(),
      lastHealthCheck: data.lastHealthCheck || 0,
      realSolReserves: data.realSolReserves || 0,
      virtualSolReserves: data.virtualSolReserves || 0,
      virtualTokenReserves: data.virtualTokenReserves || 0,
      mcap: data.mcap || 0,
      price: data.price || 0,
      volume24h: data.volume24h || 0,
      holders: data.holders || 0,
      graduated: data.graduated || false,
      healthScore: data.healthScore || 0,
      riskLevel: data.riskLevel || "unknown",
      recommendation: data.recommendation || "WAIT",
      priceHistory: data.priceHistory || [],
      volumeHistory: data.volumeHistory || [],
      phaseHistory: data.phaseHistory || [],
      alerts: data.alerts || [],
    });
    return curve;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MOLT BOT BONDING CURVE MANAGER
// ═══════════════════════════════════════════════════════════════════

export class MoltBotCurveManager {
  constructor() {
    /** @type {Map<string, TrackedCurve>} */
    this.curves = new Map();
    this._healthInterval = null;
    this._initialized = false;
    this._loadState();
  }

  // ─── LIFECYCLE ──────────────────────────────────────────────────

  _loadState() {
    const saved = loadMoltState();
    if (saved && Array.isArray(saved.curves)) {
      for (const curveData of saved.curves) {
        try {
          const curve = TrackedCurve.fromJSON(curveData);
          this.curves.set(curve.mint, curve);
        } catch { /* skip corrupted entries */ }
      }
      console.log(`[MOLT-BOT] Loaded ${this.curves.size} tracked curves`);
    }
    this._initialized = true;
  }

  _saveState() {
    saveMoltState({
      curves: Array.from(this.curves.values()).map((c) => c.toJSON()),
      savedAt: Date.now(),
      version: 1,
    });
  }

  startHealthLoop() {
    if (this._healthInterval) return;
    this._healthInterval = setInterval(() => {
      this._runHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);
    console.log("[MOLT-BOT] Health check loop started");
  }

  stopHealthLoop() {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = null;
    }
  }

  // ─── CURVE TRACKING ─────────────────────────────────────────────

  /**
   * Add a bonding curve to track.
   * @param {object} config - { mint, name, symbol, curveType, curveParams }
   * @returns {TrackedCurve}
   */
  trackCurve(config) {
    if (!config.mint) throw new Error("mint is required");
    if (this.curves.size >= MAX_TRACKED_CURVES) {
      throw new Error(`Maximum ${MAX_TRACKED_CURVES} tracked curves reached`);
    }
    if (this.curves.has(config.mint)) {
      return this.curves.get(config.mint);
    }

    const curve = new TrackedCurve(config);
    this.curves.set(config.mint, curve);
    this._saveState();
    console.log(`[MOLT-BOT] Now tracking: ${config.symbol || config.mint.slice(0, 8)}`);
    return curve;
  }

  /**
   * Remove a curve from tracking.
   */
  untrackCurve(mint) {
    const existed = this.curves.delete(mint);
    if (existed) this._saveState();
    return existed;
  }

  /**
   * Get a tracked curve by mint address.
   */
  getCurve(mint) {
    return this.curves.get(mint) || null;
  }

  /**
   * Get all tracked curves.
   */
  getAllCurves() {
    return Array.from(this.curves.values());
  }

  /**
   * Get curves filtered by phase.
   */
  getCurvesByPhase(phase) {
    return this.getAllCurves().filter((c) => c.phase === phase);
  }

  // ─── MARKET DATA INGESTION ──────────────────────────────────────

  /**
   * Feed market data from pump.fun API into a tracked curve.
   * Called by the server when it fetches pump data.
   */
  ingestPumpData(mint, pumpData) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    const now = Date.now();
    const prevPhase = curve.phase;

    // Update raw market state
    curve.realSolReserves = (pumpData.real_sol_reserves || 0) / 1e9;
    curve.virtualSolReserves = (pumpData.virtual_sol_reserves || 0) / 1e9;
    curve.virtualTokenReserves = (pumpData.virtual_token_reserves || 0) / 1e6;
    curve.mcap = pumpData.usd_market_cap || 0;
    curve.volume24h = pumpData.volume_24h || pumpData.volume || 0;
    curve.holders = pumpData.holder_count || 0;
    curve.graduated = pumpData.complete === true;
    curve.name = pumpData.name || curve.name;
    curve.symbol = pumpData.symbol || curve.symbol;

    // Calculate price from reserves
    if (curve.virtualSolReserves > 0 && curve.virtualTokenReserves > 0) {
      curve.price = curve.virtualSolReserves / curve.virtualTokenReserves;
    }

    // Record history
    if (curve.price > 0) {
      curve.priceHistory.push({ price: curve.price, at: now });
      if (curve.priceHistory.length > 100) curve.priceHistory.shift();
      curve._analyzer.addDataPoint({ price: curve.price, volume: curve.volume24h });
    }
    if (curve.volume24h > 0) {
      curve.volumeHistory.push({ volume: curve.volume24h, at: now });
      if (curve.volumeHistory.length > 100) curve.volumeHistory.shift();
    }

    curve.lastActivityAt = now;

    // Phase transition logic
    this._updatePhase(curve);

    if (curve.phase !== prevPhase) {
      curve.phaseHistory.push({ phase: curve.phase, at: now });
      curve.addAlert("phase_change", `Phase changed: ${prevPhase} -> ${curve.phase}`);
    }

    // Compute health
    this._computeHealth(curve);

    this._saveState();
    return curve;
  }

  /**
   * Feed DexScreener data for graduated tokens.
   */
  ingestDexData(mint, dexData) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    if (dexData.fdv) curve.mcap = dexData.fdv;
    if (dexData.priceUsd) curve.price = parseFloat(dexData.priceUsd);
    if (dexData.volume?.h24) curve.volume24h = parseFloat(dexData.volume.h24);
    if (dexData.liquidity?.usd) curve.liquidityUsd = dexData.liquidity.usd;

    const dexId = (dexData.dexId || "").toLowerCase();
    if (dexId === "raydium" || dexId === "pumpswap") {
      curve.graduated = true;
      if (curve.phase !== CURVE_PHASE.GRADUATED) {
        curve.phase = CURVE_PHASE.GRADUATED;
        curve.phaseHistory.push({ phase: CURVE_PHASE.GRADUATED, at: Date.now() });
        curve.addAlert("graduation", "Token graduated to " + dexData.dexId);
      }
    }

    curve.lastActivityAt = Date.now();
    this._computeHealth(curve);
    this._saveState();
    return curve;
  }

  /**
   * Feed a live WebSocket trade event from PumpPortal.
   */
  ingestTradeEvent(event) {
    if (!event.mint) return null;
    const curve = this.curves.get(event.mint);
    if (!curve) return null;

    curve.lastActivityAt = Date.now();

    if (event.marketCapSol) {
      curve.mcap = event.marketCapSol * 200; // rough USD estimate
    }
    if (event.vSolInBondingCurve) {
      curve.virtualSolReserves = event.vSolInBondingCurve;
      const initialVirtual = 30;
      curve.realSolReserves = Math.max(0, event.vSolInBondingCurve - initialVirtual);
    }
    if (event.vTokensInBondingCurve) {
      curve.virtualTokenReserves = event.vTokensInBondingCurve;
    }

    // Feed trade data to analyzer
    curve._analyzer.addDataPoint({
      price: curve.price || 0,
      isBuy: event.txType === "buy" || (event.txType === "create" && event.initialBuy > 0),
      amount: event.solAmount || 0,
    });

    this._updatePhase(curve);
    return curve;
  }

  // ─── PHASE DETECTION ────────────────────────────────────────────

  _updatePhase(curve) {
    if (curve.graduated) {
      curve.phase = CURVE_PHASE.GRADUATED;
      return;
    }

    const now = Date.now();
    const timeSinceActivity = now - curve.lastActivityAt;

    // Dormant check (24h no activity, not graduated)
    if (timeSinceActivity > DORMANT_TIMEOUT_MS && curve.phase !== CURVE_PHASE.PRE_BOND) {
      curve.phase = CURVE_PHASE.DORMANT;
      return;
    }

    // Calculate bonding progress
    const progress = curve.realSolReserves / GRADUATION_THRESHOLD_SOL;

    if (progress < 0.05) {
      curve.phase = CURVE_PHASE.PRE_BOND;
    } else if (curve.realSolReserves >= GRADUATING_ZONE_SOL) {
      curve.phase = CURVE_PHASE.GRADUATING;
    } else {
      curve.phase = CURVE_PHASE.BONDING;
    }
  }

  // ─── HEALTH SCORING ─────────────────────────────────────────────

  _computeHealth(curve) {
    const scores = {};

    // 1. Volume activity (0-100)
    if (curve.volume24h > 10000) scores.volumeActivity = 100;
    else if (curve.volume24h > 1000) scores.volumeActivity = 80;
    else if (curve.volume24h > 100) scores.volumeActivity = 60;
    else if (curve.volume24h > 10) scores.volumeActivity = 40;
    else if (curve.volume24h > 0) scores.volumeActivity = 20;
    else scores.volumeActivity = 0;

    // 2. Price stability (lower volatility = higher score)
    const prices = curve.priceHistory.slice(-20).map((p) => p.price);
    if (prices.length >= 5) {
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / prices.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
      scores.priceStability = Math.max(0, Math.min(100, 100 - cv * 200));
    } else {
      scores.priceStability = 50;
    }

    // 3. Curve progress toward graduation
    const progress = (curve.realSolReserves / GRADUATION_THRESHOLD_SOL) * 100;
    scores.curveProgress = Math.min(100, progress);

    // 4. Buy pressure from analyzer
    const analysis = curve._analyzer.getAnalysis();
    scores.buyPressure = analysis.buyScore || 50;

    // 5. Holder growth (more holders = healthier)
    if (curve.holders > 1000) scores.holderGrowth = 100;
    else if (curve.holders > 500) scores.holderGrowth = 80;
    else if (curve.holders > 100) scores.holderGrowth = 60;
    else if (curve.holders > 20) scores.holderGrowth = 40;
    else scores.holderGrowth = 20;

    // 6. Liquidity depth
    if (curve.realSolReserves > 50) scores.liquidityDepth = 100;
    else if (curve.realSolReserves > 20) scores.liquidityDepth = 80;
    else if (curve.realSolReserves > 5) scores.liquidityDepth = 60;
    else if (curve.realSolReserves > 1) scores.liquidityDepth = 40;
    else scores.liquidityDepth = 10;

    // 7. Age score (tokens that survive longer are healthier)
    const ageHours = (Date.now() - curve.addedAt) / (1000 * 60 * 60);
    if (ageHours > 168) scores.ageScore = 100;      // 1 week+
    else if (ageHours > 72) scores.ageScore = 80;    // 3 days+
    else if (ageHours > 24) scores.ageScore = 60;    // 1 day+
    else if (ageHours > 6) scores.ageScore = 40;     // 6h+
    else scores.ageScore = 20;

    // Weighted composite
    let total = 0;
    for (const [key, weight] of Object.entries(HEALTH_WEIGHTS)) {
      total += (scores[key] || 0) * weight;
    }
    curve.healthScore = Math.round(total);

    // Risk level
    if (curve.healthScore >= 75) curve.riskLevel = "low";
    else if (curve.healthScore >= 50) curve.riskLevel = "medium";
    else if (curve.healthScore >= 25) curve.riskLevel = "high";
    else curve.riskLevel = "critical";

    // Recommendation from analyzer
    const rec = analysis.recommendation;
    curve.recommendation = rec ? rec.action : "WAIT";

    curve.lastHealthCheck = Date.now();
  }

  async _runHealthChecks() {
    for (const curve of this.curves.values()) {
      try {
        this._updatePhase(curve);
        this._computeHealth(curve);

        // Generate alerts for notable conditions
        if (curve.phase === CURVE_PHASE.GRADUATING && curve.realSolReserves >= 80) {
          curve.addAlert("near_graduation",
            `Near graduation: ${curve.realSolReserves.toFixed(1)} / ${GRADUATION_THRESHOLD_SOL} SOL`);
        }
        if (curve.riskLevel === "critical") {
          curve.addAlert("critical_risk", `Health score critical: ${curve.healthScore}`);
        }
      } catch { /* skip failed checks */ }
    }
    this._saveState();
  }

  // ─── BONDING CURVE MATH ─────────────────────────────────────────

  /**
   * Simulate a buy on a curve. Uses the BondingCurve class for
   * custom curves, or pump.fun's native AMM math for pump tokens.
   */
  simulateBuy(mint, solAmount) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    if (curve.curveType === "pumpfun") {
      // Pump.fun uses constant-product AMM: x * y = k
      if (curve.virtualSolReserves <= 0 || curve.virtualTokenReserves <= 0) {
        return { tokens: 0, avgPrice: 0, impact: 0 };
      }
      const k = curve.virtualSolReserves * curve.virtualTokenReserves;
      const newSol = curve.virtualSolReserves + solAmount;
      const newTokens = k / newSol;
      const tokensOut = curve.virtualTokenReserves - newTokens;
      const avgPrice = solAmount / tokensOut;
      const spotPrice = curve.virtualSolReserves / curve.virtualTokenReserves;
      const priceImpact = ((avgPrice - spotPrice) / spotPrice) * 100;
      return { tokens: tokensOut, avgPrice, impact: priceImpact, newReserves: newSol };
    }

    // Custom curve types (linear, exponential, sigmoid)
    const supply = curve.virtualTokenReserves || 0;
    return BondingCurve.calculateBuy(solAmount, supply, curve.curveType, curve.curveParams);
  }

  /**
   * Simulate a sell on a curve.
   */
  simulateSell(mint, tokenAmount) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    if (curve.curveType === "pumpfun") {
      if (curve.virtualSolReserves <= 0 || curve.virtualTokenReserves <= 0) {
        return { sol: 0, avgPrice: 0, impact: 0 };
      }
      const k = curve.virtualSolReserves * curve.virtualTokenReserves;
      const newTokens = curve.virtualTokenReserves + tokenAmount;
      const newSol = k / newTokens;
      const solOut = curve.virtualSolReserves - newSol;
      const avgPrice = solOut / tokenAmount;
      const spotPrice = curve.virtualSolReserves / curve.virtualTokenReserves;
      const priceImpact = ((spotPrice - avgPrice) / spotPrice) * 100;
      return { sol: solOut, avgPrice, impact: priceImpact };
    }

    const supply = curve.virtualTokenReserves || 0;
    return BondingCurve.calculateSell(tokenAmount, supply, curve.curveType, curve.curveParams);
  }

  /**
   * Get the current spot price for a curve.
   */
  getSpotPrice(mint) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    if (curve.curveType === "pumpfun") {
      if (curve.virtualSolReserves <= 0 || curve.virtualTokenReserves <= 0) return 0;
      return curve.virtualSolReserves / curve.virtualTokenReserves;
    }

    const supply = curve.virtualTokenReserves || 0;
    return BondingCurve.getPrice(supply, curve.curveType, curve.curveParams);
  }

  /**
   * Get graduation progress as a percentage (0-100).
   */
  getGraduationProgress(mint) {
    const curve = this.curves.get(mint);
    if (!curve) return 0;
    if (curve.graduated) return 100;
    return Math.min(100, (curve.realSolReserves / GRADUATION_THRESHOLD_SOL) * 100);
  }

  // ─── AGGREGATE ANALYTICS ────────────────────────────────────────

  /**
   * Get a summary of all tracked curves for the Telegram bot dashboard.
   */
  getDashboard() {
    const all = this.getAllCurves();
    const byPhase = {};
    for (const phase of Object.values(CURVE_PHASE)) {
      byPhase[phase] = all.filter((c) => c.phase === phase).length;
    }

    const avgHealth = all.length > 0
      ? Math.round(all.reduce((s, c) => s + c.healthScore, 0) / all.length)
      : 0;

    const totalMcap = all.reduce((s, c) => s + (c.mcap || 0), 0);
    const totalVolume = all.reduce((s, c) => s + (c.volume24h || 0), 0);

    const graduating = all
      .filter((c) => c.phase === CURVE_PHASE.GRADUATING)
      .map((c) => ({
        mint: c.mint, symbol: c.symbol,
        progress: this.getGraduationProgress(c.mint),
        solRemaining: GRADUATION_THRESHOLD_SOL - c.realSolReserves,
      }));

    const criticalAlerts = all
      .filter((c) => c.riskLevel === "critical")
      .map((c) => ({
        mint: c.mint, symbol: c.symbol,
        healthScore: c.healthScore, phase: c.phase,
      }));

    return {
      totalCurves: all.length,
      byPhase,
      avgHealth,
      totalMcap,
      totalVolume,
      graduating,
      criticalAlerts,
      curves: all.map((c) => ({
        mint: c.mint,
        symbol: c.symbol,
        name: c.name,
        phase: c.phase,
        healthScore: c.healthScore,
        riskLevel: c.riskLevel,
        recommendation: c.recommendation,
        mcap: c.mcap,
        price: c.price,
        volume24h: c.volume24h,
        graduated: c.graduated,
        progress: this.getGraduationProgress(c.mint),
      })),
    };
  }

  /**
   * Get detailed analysis for a single curve (for Telegram deep-dive).
   */
  getCurveAnalysis(mint) {
    const curve = this.curves.get(mint);
    if (!curve) return null;

    const analysis = curve._analyzer.getAnalysis();
    const spotPrice = this.getSpotPrice(mint);
    const progress = this.getGraduationProgress(mint);

    // Simulate trades at different sizes
    const simBuy1 = this.simulateBuy(mint, 1);
    const simBuy5 = this.simulateBuy(mint, 5);
    const simBuy10 = this.simulateBuy(mint, 10);

    return {
      mint: curve.mint,
      name: curve.name,
      symbol: curve.symbol,
      curveType: curve.curveType,
      phase: curve.phase,
      healthScore: curve.healthScore,
      riskLevel: curve.riskLevel,
      recommendation: curve.recommendation,

      // Market state
      spotPrice,
      mcap: curve.mcap,
      volume24h: curve.volume24h,
      holders: curve.holders,

      // Bonding curve state
      realSolReserves: curve.realSolReserves,
      virtualSolReserves: curve.virtualSolReserves,
      virtualTokenReserves: curve.virtualTokenReserves,
      graduationProgress: progress,
      solToGraduation: Math.max(0, GRADUATION_THRESHOLD_SOL - curve.realSolReserves),
      graduated: curve.graduated,

      // Analyzer metrics
      metrics: analysis.metrics,
      buyScore: analysis.buyScore,
      sellScore: analysis.sellScore,
      confidence: analysis.confidence,

      // Trade simulations
      simulations: {
        buy1Sol: simBuy1,
        buy5Sol: simBuy5,
        buy10Sol: simBuy10,
      },

      // History
      priceHistory: curve.priceHistory.slice(-30),
      alerts: curve.alerts.slice(0, 10),
      phaseHistory: curve.phaseHistory,

      // Timestamps
      addedAt: curve.addedAt,
      lastActivityAt: curve.lastActivityAt,
      lastHealthCheck: curve.lastHealthCheck,
    };
  }

  /**
   * Get the best opportunities across all tracked curves.
   * Returns curves sorted by a composite opportunity score.
   */
  getOpportunities() {
    return this.getAllCurves()
      .filter((c) => c.phase !== CURVE_PHASE.DORMANT)
      .map((c) => {
        const analysis = c._analyzer.getAnalysis();
        // Opportunity score: healthy curves with bullish signals
        let score = c.healthScore * 0.4;
        score += (analysis.buyScore || 0) * 0.3;
        // Bonus for graduating (about to unlock PumpSwap liquidity)
        if (c.phase === CURVE_PHASE.GRADUATING) score += 15;
        // Bonus for early-stage with growing volume
        if (c.phase === CURVE_PHASE.BONDING && c.volume24h > 100) score += 10;
        return {
          mint: c.mint,
          symbol: c.symbol,
          name: c.name,
          phase: c.phase,
          opportunityScore: Math.round(score),
          healthScore: c.healthScore,
          buyScore: Math.round(analysis.buyScore || 0),
          recommendation: c.recommendation,
          mcap: c.mcap,
          progress: this.getGraduationProgress(c.mint),
        };
      })
      .sort((a, b) => b.opportunityScore - a.opportunityScore);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════

let _instance = null;

/**
 * Get the singleton MoltBotCurveManager instance.
 */
export function getMoltBotManager() {
  if (!_instance) {
    _instance = new MoltBotCurveManager();
  }
  return _instance;
}
