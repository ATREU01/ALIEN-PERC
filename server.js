import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = resolve(join(__dirname, "ui", "dist"));
const PORT = process.env.PORT || 3000;

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

If asked about prices, say you analyze protocol mechanics, not price predictions. Remind users this is experimental with no intrinsic value when appropriate.

Navigation: When your answer relates to a specific page, include a navigation tag at the end of your response. Use exactly this format: [NAV:trade], [NAV:earn], [NAV:register], [NAV:indexer], or [NAV:guide]. Only include one if it's directly relevant. Example: if someone asks how to open a position, explain and end with [NAV:trade].

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
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1024, system: systemPrompt, messages }),
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

// ─── Main server ───────────────────────────────────────────────────
createServer(async (req, res) => {
  const host = req.headers.host || "";
  if (host.startsWith("www.")) {
    res.writeHead(301, { Location: `https://alienator.org${req.url}` });
    return res.end();
  }

  // API routes
  if (req.url === "/api/chat" && req.method === "POST") return handleChat(req, res);
  if (req.url === "/api/health") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    return res.end(JSON.stringify({ status: "ok", ai: !!process.env.ANTHROPIC_API_KEY }));
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
  console.log(`ALIENATOR running on port ${PORT}`);
  console.log(`AI: ${process.env.ANTHROPIC_API_KEY ? "ONLINE" : "OFFLINE (set ANTHROPIC_API_KEY)"}`);
});
