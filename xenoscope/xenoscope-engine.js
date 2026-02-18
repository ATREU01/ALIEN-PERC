/**
 * ═══════════════════════════════════════════════════════════════════
 *  XENOSCOPE ENGINE — Alientor Signal Intelligence
 *  Server-side analytics engine for real-time blockchain monitoring
 *  Network: Solana MAINNET (Pump.fun / PumpSwap)
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── SOL Price Cache ──────────────────────────────────────────────
// Caches CoinGecko price server-side to reduce client CORS/rate issues

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const PRICE_CACHE_TTL_MS = 30_000; // 30 seconds

let cachedSolPrice = { price: 200, updatedAt: 0 };

async function fetchSolPrice() {
  try {
    const res = await fetch(COINGECKO_URL, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.solana?.usd) {
      cachedSolPrice = { price: data.solana.usd, updatedAt: Date.now() };
    }
  } catch {
    // Keep stale cache
  }
  return cachedSolPrice;
}

// Initial fetch + periodic refresh
fetchSolPrice();
setInterval(fetchSolPrice, PRICE_CACHE_TTL_MS);

export function getSolPrice() {
  return cachedSolPrice;
}

// ─── Session Analytics State ──────────────────────────────────────
// Tracks aggregate statistics for the current server session

const sessionStats = {
  startedAt: Date.now(),
  totalEventsProxied: 0,
  peakConnections: 0,
  currentConnections: 0,
  priceQueries: 0,
};

export function getSessionStats() {
  return {
    ...sessionStats,
    uptimeMs: Date.now() - sessionStats.startedAt,
    solPrice: cachedSolPrice.price,
    priceFreshness:
      cachedSolPrice.updatedAt > 0
        ? Date.now() - cachedSolPrice.updatedAt
        : null,
  };
}

export function incrementStat(key) {
  if (key in sessionStats && typeof sessionStats[key] === "number") {
    sessionStats[key]++;
    if (
      key === "currentConnections" &&
      sessionStats.currentConnections > sessionStats.peakConnections
    ) {
      sessionStats.peakConnections = sessionStats.currentConnections;
    }
  }
}

export function decrementStat(key) {
  if (key in sessionStats && typeof sessionStats[key] === "number") {
    sessionStats[key] = Math.max(0, sessionStats[key] - 1);
  }
}

// ─── Token Metadata Cache ─────────────────────────────────────────
// Server-side metadata resolution (avoids CORS on client)

const metadataCache = new Map();
const METADATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_METADATA_ENTRIES = 500;

export async function resolveTokenMetadata(uri) {
  if (!uri) return null;

  // Check cache
  const cached = metadataCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < METADATA_CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const res = await fetch(uri, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const metadata = {
      image: data.image || null,
      name: data.name || null,
      symbol: data.symbol || null,
      description: data.description || null,
    };

    // Evict oldest if full
    if (metadataCache.size >= MAX_METADATA_ENTRIES) {
      const oldest = metadataCache.keys().next().value;
      metadataCache.delete(oldest);
    }

    metadataCache.set(uri, { data: metadata, fetchedAt: Date.now() });
    return metadata;
  } catch {
    return null;
  }
}

// ─── Pump.fun Token Data Proxy ────────────────────────────────────
// Fetches token data from pump.fun frontend API (avoids CORS)

export async function fetchPumpTokenData(mint) {
  try {
    const res = await fetch(
      `https://frontend-api.pump.fun/coins/${mint}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── DexScreener Token Search ─────────────────────────────────────
// Search tokens via DexScreener API

export async function searchDexScreener(query) {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.pairs
      ? data.pairs
          .filter((p) => p.chainId === "solana")
          .slice(0, 10)
      : [];
  } catch {
    return null;
  }
}

// ─── Jupiter Price Lookup ─────────────────────────────────────────
export async function getJupiterPrice(mint) {
  try {
    const res = await fetch(
      `https://price.jup.ag/v6/price?ids=${mint}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data?.[mint] || null;
  } catch {
    return null;
  }
}

console.log("[XENOSCOPE] Engine initialized — signal intelligence active");
