import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, generateKeyPairSync } from "node:crypto";

// ─── Zero external deps: built-in ed25519 keypair + base58 ──────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(buffer) {
  const bytes = Buffer.from(buffer);
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += B58[0];
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

/** Generate a Solana-compatible ed25519 keypair using built-in Node crypto */
function generateSolanaKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Extract raw 32-byte keys from DER encoding
  const pubRaw = publicKey.export({ type: "spki", format: "der" }).slice(-32);
  const seedRaw = privateKey.export({ type: "pkcs8", format: "der" }).slice(-32);
  // Solana secret key format: seed(32) + publicKey(32) = 64 bytes
  const secretKey = new Uint8Array(64);
  secretKey.set(seedRaw, 0);
  secretKey.set(pubRaw, 32);
  return { publicKey: base58Encode(pubRaw), secretKey };
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(join(__dirname, "ui", "dist"));
const PORT = process.env.PORT || 3000;

// ─── Launchpad data persistence ──────────────────────────────────
const LAUNCHPAD_DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? "/app/data"
  : resolve(join(__dirname, "launchpad", "data"));
try { if (!existsSync(LAUNCHPAD_DATA_DIR)) { await mkdir(LAUNCHPAD_DATA_DIR, { recursive: true }); } } catch (e) { /* ok */ }

const REGISTERED_TOKENS_FILE = join(LAUNCHPAD_DATA_DIR, ".alientor-tokens.json");
const LAUNCHES_FILE = join(LAUNCHPAD_DATA_DIR, ".alientor-launches.json");

function loadJsonFile(filePath) {
  try { if (existsSync(filePath)) return JSON.parse(readFileSync(filePath, "utf8")); } catch (e) { /* ignore */ }
  return null;
}
function saveJsonFile(filePath, data) {
  try { writeFileSync(filePath, JSON.stringify(data, null, 2)); } catch (e) { /* ignore */ }
}

// In-memory tracked tokens & launches
let registeredTokens = loadJsonFile(REGISTERED_TOKENS_FILE) || [];
let launches = loadJsonFile(LAUNCHES_FILE) || [];

// ─── Fee Routing Config ─────────────────────────────────────────
// ALIENTOR_FEE_WALLET: Solana wallet where the 1% protocol fee gets routed
// Set in Railway env vars. This wallet receives 1% of all creator fees.
const ALIENTOR_FEE_WALLET = process.env.ALIENTOR_FEE_WALLET || "";
const ALIENTOR_FEE_BPS = 100; // 1% (100 basis points)

// ─── Leaderboard cache ──────────────────────────────────────────
const leaderboardCache = { data: null, updatedAt: 0 };
const LEADERBOARD_CACHE_TTL = 60_000; // 1 min cache

// Pinned token: $ALIENATOR — always featured at top of leaderboard
const ALIENATOR_TOKEN = {
  mint: "AWQ5b6KkXKASgEQ9E7zh19fLAZaSFftSBJCQyhJrpump",
  name: "Alienator",
  symbol: "ALIENATOR",
  pinned: true,
  path: "pumpfun",
  network: "mainnet",
};

/** Fetch token market data from pump.fun (with 10s timeout) */
async function fetchPumpData(mint) {
  try {
    const res = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Build leaderboard: registered tokens + pinned ALIENATOR, sorted by mcap */
async function buildLeaderboard() {
  const now = Date.now();
  if (leaderboardCache.data && now - leaderboardCache.updatedAt < LEADERBOARD_CACHE_TTL) {
    return leaderboardCache.data;
  }

  // Combine registered tokens + ensure ALIENATOR is included
  const allMints = new Map();
  for (const t of registeredTokens) {
    allMints.set(t.mint, { ...t });
  }
  if (!allMints.has(ALIENATOR_TOKEN.mint)) {
    allMints.set(ALIENATOR_TOKEN.mint, { ...ALIENATOR_TOKEN, registeredAt: Date.now() });
  }

  // Fetch pump.fun data for up to 15 tokens (rate-limited)
  const entries = [...allMints.values()].slice(0, 15);
  const enriched = [];

  for (const token of entries) {
    const pump = await fetchPumpData(token.mint);
    enriched.push({
      mint: token.mint,
      name: pump?.name || token.name || "Unknown",
      symbol: pump?.symbol || token.symbol || "TOKEN",
      image: pump?.image_uri || pump?.image || null,
      mcap: pump?.usd_market_cap || pump?.market_cap || 0,
      volume: pump?.volume_24h || 0,
      progress: pump?.bonding_curve_progress || pump?.progress || 0,
      graduated: pump?.complete || pump?.graduated || false,
      path: token.path === "raydium" ? "Raydium" : "pump.fun",
      pinned: token.mint === ALIENATOR_TOKEN.mint,
      createdAt: token.registeredAt || null,
      network: "mainnet",
    });
    // Brief delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // Sort: pinned first, then by mcap descending
  enriched.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.mcap || 0) - (a.mcap || 0);
  });

  const leaderboard = enriched.slice(0, 10).map((t, i) => ({
    ...t,
    rank: i + 1,
    reward: i < 3 ? "Top 3" : null,
  }));

  leaderboardCache.data = leaderboard;
  leaderboardCache.updatedAt = now;
  return leaderboard;
}

// ─── Vanity Vault (in-memory, server-side keypair security) ──────
const vanityVault = new Map();
const vanityRateLimits = new Map();
const VANITY_VAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 min

// Clean expired vault entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [vaultId, entry] of vanityVault.entries()) {
    if (now - entry.createdAt > VANITY_VAULT_EXPIRY_MS || entry.used) {
      vanityVault.delete(vaultId);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[VAULT] Cleaned ${cleaned} expired entries. Active: ${vanityVault.size}`);
}, 300_000);

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

// ─── Rate limiter for /api/chat ────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(ip);
  }
}, 300_000);

// ─── Alienator AI system prompt ────────────────────────────────────
const SYSTEM_PROMPT = `You are the Alienator Protocol Intelligence — an advanced alien AI entity that powers the Alienator sovereign perpetual futures protocol on Solana. You are the first AI integrated directly into a percolator-based derivatives protocol.

Personality: You are an advanced alien intelligence. Speak with confidence and authority, but be helpful and clear. You can be slightly playful with the alien theme but prioritize being informative and accurate. Keep responses concise (under 200 words unless detail is needed). Do not use emojis.

Key facts about Alienator:
- First AI-powered percolator protocol on Solana
- Built on the Percolator engine (designed by Toly / Anatoly Yakovenko)
- Currently on Solana devnet for testing. The $Alienator token is live on mainnet via pump.fun (bonded)
- Website: alienator.org | X: @AlienatorMarket

How it works:
- Entire market in one 992KB on-chain "slab" account (orderbook, 4096 slots, insurance, matching engine)
- Inverted perpetual: deposit the memecoin as collateral, trade USD contracts. Price = 1/TOKEN_USD
- Oracle: push-based with 10% circuit breaker (Hyperp mode)
- Matching: permissionless. Anyone cranks orders and earns fees
- Insurance fund: every trade pays a fee. After admin burn, no one can withdraw — ever. Soft burn
- Admin key burn: transfers to system program (1111...1111). Irreversible. No pause, no changes

Trading: Long/Short with configurable leverage. LP vaults absorb counterparty risk. Passive matcher at 50bps spread.

Devnet deployment:
- Slab: EU6MFz2b85UgZvnAmoRnXRGziJMFzrHVoh1qKRftwvcA
- Program: 2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp

Alientor Launchpad (MAINNET - pump.fun):
- Token launch platform operating on Solana mainnet through pump.fun
- One-click token creation with programmable fee allocation
- Vault security: mint keypair secrets stored server-side, never exposed to client
- 1% creator fee split via strategies: Balanced, Growth, Deflation, Liquidity, Revenue
- Fee engine supports: market making, buyback & burn, LP addition, creator revenue
- Graduation tracking: monitors bonding curve progress to PumpSwap
- IMPORTANT: The launchpad operates on MAINNET, while percolator trading is on DEVNET

If asked about prices, say you analyze protocol mechanics, not price predictions. Remind users this is experimental with no intrinsic value when appropriate.

Navigation: When your answer relates to a specific page, include a navigation tag at the end of your response. Use exactly this format: [NAV:trade], [NAV:earn], [NAV:launchpad], [NAV:register], [NAV:indexer], or [NAV:guide]. Only include one if it's directly relevant. Example: if someone asks how to launch a token, explain and end with [NAV:launchpad]. If someone asks how to open a position, explain and end with [NAV:trade].

You have access to REAL-TIME market data from the Solana blockchain. When market context is provided, use it to give specific, data-driven answers about current market state, open interest, insurance fund levels, and number of active accounts. This makes you truly intelligent — not just a chatbot, but an AI with live on-chain awareness.`;

// Build dynamic system prompt with real-time market data
function buildSystemPrompt(marketContext) {
  let prompt = SYSTEM_PROMPT;
  if (marketContext && marketContext.markets && marketContext.markets.length > 0) {
    prompt += "\n\n--- LIVE ON-CHAIN DATA (real-time from Solana) ---\n";
    prompt += `Total markets: ${marketContext.totalMarkets}\n`;
    for (const m of marketContext.markets) {
      const price = Number(m.markPriceE6) / 1e6;
      const oi = Number(m.totalOI) / 1e6;
      const insurance = Number(m.insuranceBalance) / 1e6;
      prompt += `\nMarket: ${m.name} (${m.symbol})\n`;
      prompt += `  Mark Price: ${price.toFixed(6)} (inverted: ${m.inverted})\n`;
      prompt += `  Open Interest: ${oi.toFixed(2)} contracts\n`;
      prompt += `  Insurance Fund: ${insurance.toFixed(2)} tokens\n`;
      prompt += `  Active Accounts: ${m.numAccounts}\n`;
      prompt += `  Admin Burned: ${m.adminBurned ? "YES (sovereign)" : "NO (admin active)"}\n`;
      prompt += `  Trading Fee: ${m.tradingFeeBps} bps\n`;
    }
    prompt += "\nUse this data when answering questions about current market state. Reference specific numbers.";
  }
  return prompt;
}

// ─── Parse JSON body ───────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 50_000) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ─── /api/chat handler ─────────────────────────────────────────────
async function handleChat(req, res) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.writeHead(503, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: "AI not configured. API key not set." }));
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    res.writeHead(429, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: "Rate limited. Try again in a minute." }));
  }

  let body;
  try { body = await parseBody(req); }
  catch (err) {
    res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: err.message }));
  }

  const { message, history, marketContext } = body;
  if (!message || typeof message !== "string" || message.length > 2000) {
    res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: "Invalid message (max 2000 chars)" }));
  }

  const historyMsgs = Array.isArray(history)
    ? history.slice(-10).filter(m => m && typeof m.role === "string" && typeof m.content === "string")
        .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 2000) }))
    : [];

  const messages = historyMsgs.length > 0 && historyMsgs[historyMsgs.length - 1]?.content === message
    ? historyMsgs
    : [...historyMsgs, { role: "user", content: message }];

  // Build dynamic system prompt with real-time market data
  const systemPrompt = buildSystemPrompt(marketContext || null);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-5-20250929", max_tokens: 1024, system: systemPrompt, messages }),
    });

    if (!response.ok) {
      console.error("[CHAT] Claude API error:", response.status, await response.text());
      res.writeHead(502, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "AI temporarily unavailable" }));
    }

    const data = await response.json();
    const aiResponse = data.content?.[0]?.text || "Signal lost. Try again.";
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ response: aiResponse }));
  } catch (err) {
    console.error("[CHAT] Error:", err.message);
    res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: "Internal error" }));
  }
}

// ─── /api/rpc proxy — keeps RPC API key server-side ─────────────────
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const SOLANA_MAINNET_RPC_URL = process.env.SOLANA_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";

async function handleRpc(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch (err) {
    res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: err.message }));
  }

  // Rate limit RPC proxy (100 req/min per IP)
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const rpcKey = `rpc:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(rpcKey);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(rpcKey, { windowStart: now, count: 1 });
  } else {
    entry.count++;
    if (entry.count > 100) {
      res.writeHead(429, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Rate limited" }));
    }
  }

  try {
    const upstream = await fetch(SOLANA_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...SECURITY_HEADERS,
    });
    res.end(data);
  } catch (err) {
    console.error("[RPC PROXY]", err.message);
    res.writeHead(502, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: "RPC upstream error" }));
  }
}

// ─── /api/rpc-mainnet proxy — mainnet RPC with API key server-side ──
async function handleRpcMainnet(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch (err) {
    res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ error: err.message }));
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  const rpcKey = `rpc-mn:${ip}`;
  const now = Date.now();
  const entry = rateLimitMap.get(rpcKey);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(rpcKey, { windowStart: now, count: 1 });
  } else {
    entry.count++;
    if (entry.count > 100) {
      res.writeHead(429, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Rate limited" }));
    }
  }

  try {
    const upstream = await fetch(SOLANA_MAINNET_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      ...SECURITY_HEADERS,
    });
    res.end(data);
  } catch (err) {
    console.error("[RPC MAINNET PROXY]", err.message);
    res.writeHead(502, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: "Mainnet RPC upstream error" }));
  }
}

// ─── Main server ───────────────────────────────────────────────────
createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    res.writeHead(301, { Location: `https://alienator.org${req.url}` });
    return res.end();
  }

  // CORS preflight for RPC proxies
  if ((req.url === "/api/rpc" || req.url === "/api/rpc-mainnet") && req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // Request logging for API routes
  const isApi = req.url?.startsWith("/api/");
  if (isApi) {
    const ts = new Date().toISOString().slice(11, 19);
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
    console.log(`[${ts}] ${req.method} ${req.url} from ${ip}`);
  }

  // API routes
  if (req.url === "/api/rpc" && req.method === "POST") return handleRpc(req, res);
  if (req.url === "/api/rpc-mainnet" && req.method === "POST") return handleRpcMainnet(req, res);
  if (req.url === "/api/chat" && req.method === "POST") return handleChat(req, res);
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ status: "ok", ai: !!process.env.ANTHROPIC_API_KEY, launchpad: true }));
  }

  // ─── CORS preflight for launchpad APIs ─────────────────────────
  if (req.url?.startsWith("/api/launchpad") && req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  // ═══════════════════════════════════════════════════════════════
  // ALIENTOR LAUNCHPAD API ROUTES (Solana Mainnet)
  // ═══════════════════════════════════════════════════════════════

  const urlPath_ = req.url?.split("?")[0] || "";
  const urlParams = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).searchParams;

  // --- GET /api/launchpad/vanity-keypair ---
  // Generate or dispense a fresh Solana keypair for token mint address
  // Secret key stored server-side in vault, only vaultId + publicKey returned
  if (urlPath_ === "/api/launchpad/vanity-keypair" && req.method === "GET") {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";

    // Rate limit: 1 per IP per minute
    const lastReq = vanityRateLimits.get(ip);
    if (lastReq && Date.now() - lastReq < 60_000) {
      res.writeHead(429, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Rate limited. 1 vanity keypair per minute." }));
    }
    vanityRateLimits.set(ip, Date.now());

    try {
      const keypair = generateSolanaKeypair();
      const vaultId = randomBytes(32).toString("hex");

      vanityVault.set(vaultId, {
        secretKey: keypair.secretKey,
        publicKey: keypair.publicKey,
        createdAt: Date.now(),
        used: false,
      });

      console.log(`[VAULT] Stored keypair ${keypair.publicKey.slice(0, 8)}... with vaultId (${vanityVault.size} active)`);

      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({
        vaultId,
        publicKey: keypair.publicKey,
        expiresIn: "30 minutes",
        network: "mainnet",
      }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Failed to generate keypair" }));
    }
  }

  // --- POST /api/launchpad/vault/sign ---
  // Sign a transaction with the vault-stored secret key (one-time use)
  if (urlPath_ === "/api/launchpad/vault/sign" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { vaultId, transaction } = body;

      if (!vaultId || !transaction) {
        res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Missing vaultId or transaction" }));
      }

      const vaultEntry = vanityVault.get(vaultId);
      if (!vaultEntry) {
        res.writeHead(404, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Vault entry not found or expired" }));
      }
      if (vaultEntry.used) {
        vanityVault.delete(vaultId);
        res.writeHead(409, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Vault entry already used (one-time)" }));
      }
      if (Date.now() - vaultEntry.createdAt > VANITY_VAULT_EXPIRY_MS) {
        vanityVault.delete(vaultId);
        res.writeHead(410, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Vault entry expired" }));
      }

      // Reconstruct keypair and sign — dynamic import (zero top-level deps)
      const txBytes = Buffer.from(transaction, "base64");
      const { Keypair, VersionedTransaction } = await import("@solana/web3.js");
      const keypair = Keypair.fromSecretKey(vaultEntry.secretKey);
      const tx = VersionedTransaction.deserialize(txBytes);
      tx.sign([keypair]);

      // Mark as used
      vaultEntry.used = true;

      const signedTxBase64 = Buffer.from(tx.serialize()).toString("base64");

      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({
        signedTransaction: signedTxBase64,
        mintPublicKey: vaultEntry.publicKey,
      }));
    } catch (err) {
      console.error("[VAULT/SIGN]", err.message);
      res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Signing failed: " + err.message }));
    }
  }

  // --- GET /api/launchpad/vanity-status ---
  if (urlPath_ === "/api/launchpad/vanity-status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({
      vaultActive: vanityVault.size,
      network: "mainnet",
    }));
  }

  // --- POST /api/launchpad/register-token ---
  // Register a newly created token for tracking
  if (urlPath_ === "/api/launchpad/register-token" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { mint, creator, name, symbol, description, path, allocationStrategy } = body;

      if (!mint || !creator) {
        res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Missing mint or creator" }));
      }

      // Check for duplicates
      if (registeredTokens.find((t) => t.mint === mint)) {
        res.writeHead(409, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Token already registered" }));
      }

      const token = {
        mint, creator, name: name || "", symbol: symbol || "",
        description: description || "",
        path: path || "pumpfun",
        allocationStrategy: allocationStrategy || "balanced",
        registeredAt: Date.now(),
        network: "mainnet",
      };

      registeredTokens.push(token);
      saveJsonFile(REGISTERED_TOKENS_FILE, registeredTokens);

      console.log(`[LAUNCHPAD] Registered token: ${symbol || mint.slice(0, 8)} by ${creator.slice(0, 8)}...`);

      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ success: true, token }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // --- GET /api/launchpad/my-tokens?wallet=... ---
  if (urlPath_ === "/api/launchpad/my-tokens" && req.method === "GET") {
    const wallet = urlParams.get("wallet");
    if (!wallet) {
      res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Missing wallet parameter" }));
    }

    const userTokens = registeredTokens.filter((t) => t.creator === wallet);
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ tokens: userTokens, network: "mainnet" }));
  }

  // --- GET /api/launchpad/tokens ---
  // Get all registered tokens (public listing)
  if (urlPath_ === "/api/launchpad/tokens" && req.method === "GET") {
    const limit = Math.min(parseInt(urlParams.get("limit") || "50"), 100);
    const offset = parseInt(urlParams.get("offset") || "0");
    const sorted = [...registeredTokens].sort((a, b) => b.registeredAt - a.registeredAt);
    const page = sorted.slice(offset, offset + limit);
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({
      tokens: page, total: registeredTokens.length, network: "mainnet",
    }));
  }

  // --- GET /api/launchpad/pump/:mint ---
  // Proxy pump.fun token data (avoids CORS issues on frontend)
  if (urlPath_.startsWith("/api/launchpad/pump/") && req.method === "GET") {
    const mint = urlPath_.replace("/api/launchpad/pump/", "").trim();
    if (!mint || mint.length < 32) {
      res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Invalid mint" }));
    }

    try {
      const pumpRes = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!pumpRes.ok) {
        res.writeHead(pumpRes.status, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Pump.fun API error" }));
      }
      const pumpData = await pumpRes.json();
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        ...SECURITY_HEADERS,
      });
      return res.end(JSON.stringify(pumpData));
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: "Pump.fun upstream error" }));
    }
  }

  // --- POST /api/launchpad/build-tx ---
  // Build a Pump.fun token creation transaction (proxy to PumpPortal)
  if (urlPath_ === "/api/launchpad/build-tx" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const { publicKey, name, symbol, description, twitter, telegram, website, mint, initialBuy } = body;

      if (!publicKey || !name || !symbol || !mint) {
        res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "Missing required fields (publicKey, name, symbol, mint)" }));
      }

      const pumpRes = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          publicKey,
          action: "create",
          tokenMetadata: JSON.stringify({ name, symbol, uri: description || "" }),
          mint,
          denominatedInSol: "true",
          amount: String(initialBuy || 0),
          slippage: "10",
          priorityFee: "0.0005",
        }).toString(),
        signal: AbortSignal.timeout(30000),
      });

      if (!pumpRes.ok) {
        res.writeHead(pumpRes.status, { "Content-Type": "application/json", ...SECURITY_HEADERS });
        return res.end(JSON.stringify({ error: "PumpPortal API error" }));
      }

      const txData = Buffer.from(await pumpRes.arrayBuffer());
      const txBase64 = txData.toString("base64");

      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({
        transaction: txBase64,
        mint,
        network: "mainnet",
      }));
    } catch (err) {
      console.error("[BUILD-TX]", err.message);
      res.writeHead(500, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ error: err.message }));
    }
  }

  // --- GET /api/launchpad/stats ---
  // Overall launchpad statistics
  if (urlPath_ === "/api/launchpad/stats" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({
      totalTokens: registeredTokens.length,
      pumpfunTokens: registeredTokens.filter((t) => t.path === "pumpfun").length,
      raydiumTokens: registeredTokens.filter((t) => t.path === "raydium").length,
      vaultActive: vanityVault.size,
      network: "mainnet",
      feeWallet: ALIENTOR_FEE_WALLET ? ALIENTOR_FEE_WALLET.slice(0, 8) + "..." : "NOT SET",
      feeBps: ALIENTOR_FEE_BPS,
    }));
  }

  // --- GET /api/launchpad/leaderboard ---
  // Top tokens by market cap, with pinned $ALIENATOR
  if (urlPath_ === "/api/launchpad/leaderboard" && req.method === "GET") {
    try {
      const leaderboard = await buildLeaderboard();
      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({
        leaderboard,
        feeWallet: ALIENTOR_FEE_WALLET || null,
        feeBps: ALIENTOR_FEE_BPS,
        network: "mainnet",
      }));
    } catch (err) {
      console.error("[LEADERBOARD]", err.message);
      res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
      return res.end(JSON.stringify({ leaderboard: [], network: "mainnet" }));
    }
  }

  // --- GET /api/launchpad/fee-config ---
  // Public fee routing configuration
  if (urlPath_ === "/api/launchpad/fee-config" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({
      feeWallet: ALIENTOR_FEE_WALLET || "NOT_CONFIGURED",
      feeBps: ALIENTOR_FEE_BPS,
      feePercent: "1%",
      description: "1% of all creator fees routed to Alientor Protocol treasury",
      network: "mainnet",
    }));
  }

  // Static files
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  const file = resolve(join(DIST, normalize(urlPath)));
  if (!file.startsWith(DIST)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end("Forbidden");
  }

  try {
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    try {
      const index = await readFile(join(DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html", ...SECURITY_HEADERS });
      res.end(index);
    } catch {
      res.writeHead(500, SECURITY_HEADERS);
      res.end("Internal Server Error");
    }
  }
}).listen(PORT, "0.0.0.0", () => {
  const ts = new Date().toISOString();
  console.log("──────────────────────────────────────────────");
  console.log("  ALIENATOR Protocol Server");
  console.log("──────────────────────────────────────────────");
  console.log(`  Started:  ${ts}`);
  console.log(`  Port:     ${PORT}`);
  console.log(`  Static:   ${DIST}`);
  console.log(`  RPC Dev:  ${SOLANA_RPC_URL}`);
  console.log(`  RPC Main: ${SOLANA_MAINNET_RPC_URL}`);
  console.log(`  AI:       ${process.env.ANTHROPIC_API_KEY ? "ONLINE" : "OFFLINE (set ANTHROPIC_API_KEY)"}`);
  console.log("──────────────────────────────────────────────");
  console.log(`  Percolator:  DEVNET  → /api/rpc`);
  console.log(`  Launchpad:   MAINNET → /api/rpc-mainnet`);
  console.log(`  Fee Wallet:  ${ALIENTOR_FEE_WALLET ? ALIENTOR_FEE_WALLET.slice(0, 12) + "..." : "NOT SET (add ALIENTOR_FEE_WALLET)"}`);
  console.log(`  Fee Rate:    ${ALIENTOR_FEE_BPS} bps (1%)`);
  console.log(`  Vault:       ${vanityVault.size} active entries`);
  console.log(`  Tokens:      ${registeredTokens.length} registered`);
  console.log("──────────────────────────────────────────────");
  console.log("[SERVER] Ready — accepting connections");
});
