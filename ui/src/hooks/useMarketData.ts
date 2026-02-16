/**
 * Hook for fetching and subscribing to percolator market data.
 *
 * Discovery strategy (two-pronged):
 * 1. Try getProgramAccounts to discover ALL markets on-chain
 * 2. If that fails (RPC limitation) or returns nothing, fall back to
 *    loading KNOWN_MARKETS individually via getAccountInfo (works on every RPC)
 *
 * This guarantees markets always show up regardless of RPC tier.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  parseMarketState,
  parseAccount,
  type MarketState,
  type AccountData,
} from "../lib/percolator";
import {
  RPC_ENDPOINT,
  PERCOLATOR_PROGRAM_ID,
  MAX_ACCOUNTS,
  KNOWN_MARKETS,
} from "../lib/constants";

// ---------------------------------------------------------------------------
// Debug logging — visible in browser DevTools console
// ---------------------------------------------------------------------------
const DEBUG = true;
function dbg(tag: string, ...args: unknown[]) {
  if (DEBUG) console.log(`[PERC:${tag}]`, ...args);
}

// ---------------------------------------------------------------------------
// Shared connection — single instance, no duplicates
// ---------------------------------------------------------------------------
let _connection: Connection | null = null;
function getConnection(): Connection {
  if (!_connection) {
    dbg("RPC", "Creating connection to:", RPC_ENDPOINT);
    _connection = new Connection(RPC_ENDPOINT, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true, // we handle retries ourselves
    });
  }
  return _connection;
}

// ---------------------------------------------------------------------------
// Retry with exponential backoff (handles 429 rate limits)
// ---------------------------------------------------------------------------
async function fetchWithBackoff<T>(
  fn: () => Promise<T>,
  label = "rpc",
  maxRetries = 3,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) dbg(label, `retry attempt ${attempt}/${maxRetries}`);
      return await fn();
    } catch (e: unknown) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isRateLimit = msg.includes("429") || msg.includes("Too Many Requests");
      const isNetwork = msg.includes("fetch") || msg.includes("ECONNREFUSED");

      dbg(label, `error (attempt ${attempt}):`, msg, { isRateLimit, isNetwork });

      if ((isRateLimit || isNetwork) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        dbg(label, `backing off ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Global discovery cache — prevents N components each calling getProgramAccounts
// ---------------------------------------------------------------------------
interface DiscoveryCache {
  markets: Array<{ address: string; state: MarketState }>;
  timestamp: number;
  loading: boolean;
  error: string | null;
  promise: Promise<void> | null;
  listeners: Set<() => void>;
}

const CACHE_TTL_MS = 60_000; // 1 minute staleness threshold

const discoveryCache: DiscoveryCache = {
  markets: [],
  timestamp: 0,
  loading: false,
  error: null,
  promise: null,
  listeners: new Set(),
};

function notifyListeners() {
  discoveryCache.listeners.forEach((fn) => fn());
}

// ---------------------------------------------------------------------------
// Fallback: load known markets individually via getAccountInfo
// Works on every RPC tier (no getProgramAccounts needed)
// ---------------------------------------------------------------------------
async function loadKnownMarkets(): Promise<
  Array<{ address: string; state: MarketState }>
> {
  dbg("fallback", `Loading ${KNOWN_MARKETS.length} known markets individually`);
  if (KNOWN_MARKETS.length === 0) {
    dbg("fallback", "KNOWN_MARKETS is empty — nothing to load");
    return [];
  }

  const conn = getConnection();
  const results: Array<{ address: string; state: MarketState }> = [];

  // Fetch all known markets in parallel
  const fetches = KNOWN_MARKETS.map(async (market) => {
    dbg("fallback", `Fetching known market: ${market.slabAddress} (${market.name})`);
    try {
      const info = await fetchWithBackoff(
        () => conn.getAccountInfo(new PublicKey(market.slabAddress)),
        `getAccountInfo:${market.symbol}`,
      );
      if (!info) {
        dbg("fallback", `Account NOT FOUND: ${market.slabAddress} — wrong network?`);
        return null;
      }
      dbg("fallback", `Got account data: ${info.data.length} bytes, owner: ${info.owner.toBase58()}`);
      const data = Buffer.from(info.data);
      const state = parseMarketState(data);
      dbg("fallback", `Parsed OK: ${market.name}, ${state.numAccounts} accounts, mark=${state.markPriceE6}`);
      return {
        address: market.slabAddress,
        state,
      };
    } catch (e) {
      dbg("fallback", `FAILED to load ${market.slabAddress}:`, e instanceof Error ? e.message : e);
      return null;
    }
  });

  const settled = await Promise.all(fetches);
  for (const r of settled) {
    if (r) results.push(r);
  }
  dbg("fallback", `Loaded ${results.length}/${KNOWN_MARKETS.length} known markets`);
  return results;
}

// ---------------------------------------------------------------------------
// Main discovery: try getProgramAccounts, then fall back to known markets
// ---------------------------------------------------------------------------
async function runDiscovery(): Promise<void> {
  // Already in-flight — piggyback on existing request
  if (discoveryCache.promise) {
    dbg("discovery", "Already in-flight, piggyback on existing request");
    return discoveryCache.promise;
  }

  dbg("discovery", "=== STARTING MARKET DISCOVERY ===");
  dbg("discovery", "RPC endpoint:", RPC_ENDPOINT);
  dbg("discovery", "Program ID:", PERCOLATOR_PROGRAM_ID.toBase58());
  dbg("discovery", "Known markets:", KNOWN_MARKETS.length);

  discoveryCache.loading = true;
  discoveryCache.error = null;
  notifyListeners();

  discoveryCache.promise = (async () => {
    try {
      const conn = getConnection();
      let parsed: Array<{ address: string; state: MarketState }> = [];

      // Strategy 1: Try full on-chain scan via getProgramAccounts
      dbg("discovery", "Strategy 1: getProgramAccounts...");
      try {
        const accounts = await fetchWithBackoff(
          () =>
            conn.getProgramAccounts(PERCOLATOR_PROGRAM_ID, {
              filters: [
                {
                  memcmp: {
                    offset: 0,
                    bytes: "6Aptvk7gABj", // Base58 of PERCOLAT magic u64 LE
                  },
                },
              ],
              dataSlice: { offset: 0, length: 9200 }, // Header+Config+Engine only
            }),
          "getProgramAccounts",
        );

        dbg("discovery", `getProgramAccounts returned ${accounts.length} accounts`);

        parsed = accounts
          .map((a) => {
            try {
              const data = Buffer.from(a.account.data);
              const state = parseMarketState(data);
              dbg("discovery", `  Parsed: ${a.pubkey.toBase58()} — ${state.numAccounts} accounts`);
              return {
                address: a.pubkey.toBase58(),
                state,
              };
            } catch (e) {
              dbg("discovery", `  PARSE FAILED: ${a.pubkey.toBase58()}:`, e instanceof Error ? e.message : e);
              return null;
            }
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);

        dbg("discovery", `Strategy 1 result: ${parsed.length} valid markets`);
      } catch (e) {
        dbg("discovery", "Strategy 1 FAILED:", e instanceof Error ? e.message : e);
        // getProgramAccounts failed — that's OK, we have fallback
      }

      // Strategy 2: If scan returned nothing, load known markets individually
      if (parsed.length === 0) {
        dbg("discovery", "Strategy 2: falling back to known markets...");
        parsed = await loadKnownMarkets();
      } else {
        // Merge: add any known markets that weren't found in the scan
        const foundAddresses = new Set(parsed.map((m) => m.address));
        const missing = KNOWN_MARKETS.filter(
          (km) => !foundAddresses.has(km.slabAddress),
        );
        if (missing.length > 0) {
          dbg("discovery", `Merging ${missing.length} missing known markets`);
          const extras = await loadKnownMarkets();
          for (const e of extras) {
            if (!foundAddresses.has(e.address)) {
              parsed.push(e);
            }
          }
        }
      }

      discoveryCache.markets = parsed;
      discoveryCache.timestamp = Date.now();
      discoveryCache.error = parsed.length === 0 ? "No markets found on-chain" : null;
      dbg("discovery", `=== DISCOVERY COMPLETE: ${parsed.length} markets ===`);
      if (parsed.length === 0) {
        dbg("discovery", "NO MARKETS FOUND. Check: (1) RPC points to correct network, (2) program is deployed, (3) slab account exists");
      }
    } catch (e: unknown) {
      dbg("discovery", "OUTER CATCH — both strategies may have failed:", e instanceof Error ? e.message : e);
      // Both strategies failed — try known markets as last resort
      try {
        dbg("discovery", "Last resort: loading known markets...");
        const fallback = await loadKnownMarkets();
        if (fallback.length > 0) {
          discoveryCache.markets = fallback;
          discoveryCache.timestamp = Date.now();
          discoveryCache.error = null;
          dbg("discovery", `Last resort SUCCESS: ${fallback.length} markets`);
          return;
        }
      } catch (e2) {
        dbg("discovery", "Last resort ALSO FAILED:", e2 instanceof Error ? e2.message : e2);
      }
      discoveryCache.error =
        e instanceof Error ? e.message : "Failed to discover markets";
      dbg("discovery", "=== DISCOVERY FAILED ===", discoveryCache.error);
    } finally {
      discoveryCache.loading = false;
      discoveryCache.promise = null;
      notifyListeners();
    }
  })();

  return discoveryCache.promise;
}

// ---------------------------------------------------------------------------
// useMarketDiscovery — shared across all components via cache
// ---------------------------------------------------------------------------
export function useMarketDiscovery() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    discoveryCache.listeners.add(listener);

    // Only fetch if cache is stale or empty
    const isStale = Date.now() - discoveryCache.timestamp > CACHE_TTL_MS;
    if ((discoveryCache.markets.length === 0 && !discoveryCache.error) || isStale) {
      runDiscovery();
    }

    return () => {
      discoveryCache.listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(() => {
    discoveryCache.timestamp = 0; // force stale
    runDiscovery();
  }, []);

  return {
    markets: discoveryCache.markets,
    loading: discoveryCache.loading,
    error: discoveryCache.error,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// useMarketData — fetch single market with polling (no WebSocket)
// ---------------------------------------------------------------------------
export function useMarketData(slabAddress: string | null) {
  const [state, setState] = useState<MarketState | null>(null);
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [rawData, setRawData] = useState<Buffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!slabAddress) return;
    dbg("marketData", `Fetching market: ${slabAddress}`);
    setLoading(true);
    setError(null);

    try {
      const conn = getConnection();
      const info = await fetchWithBackoff(
        () => conn.getAccountInfo(new PublicKey(slabAddress)),
        "marketData",
      );
      if (!mountedRef.current) return;
      if (!info) throw new Error("Market account not found");

      dbg("marketData", `Got ${info.data.length} bytes, parsing...`);
      const data = Buffer.from(info.data);
      const parsed = parseMarketState(data);
      setState(parsed);
      setRawData(data);

      // Parse active accounts from bitmap
      const accts: AccountData[] = [];
      for (let i = 0; i < MAX_ACCOUNTS && accts.length < parsed.numAccounts + 20; i++) {
        const acct = parseAccount(data, i);
        if (acct) accts.push(acct);
      }
      setAccounts(accts);
      setLastUpdate(Date.now());
      dbg("marketData", `Loaded: ${accts.length} accounts, mark=${parsed.markPriceE6}`);
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      const msg = e instanceof Error ? e.message : "Failed to fetch market data";
      dbg("marketData", "ERROR:", msg);
      setError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [slabAddress]);

  useEffect(() => {
    mountedRef.current = true;
    if (!slabAddress) {
      setState(null);
      setAccounts([]);
      setRawData(null);
      return;
    }

    fetchData();

    // Poll every 15 seconds instead of WebSocket (works on all RPC tiers)
    const interval = setInterval(fetchData, 15_000);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [slabAddress, fetchData]);

  return { state, accounts, rawData, loading, error, lastUpdate, refetch: fetchData };
}

// Re-export types
export type { MarketState, AccountData };
