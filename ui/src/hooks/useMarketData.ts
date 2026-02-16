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
// Shared connection — single instance, no duplicates
// ---------------------------------------------------------------------------
let _connection: Connection | null = null;
function getConnection(): Connection {
  if (!_connection) {
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
  maxRetries = 3,
  baseDelayMs = 2000,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const isRateLimit = msg.includes("429") || msg.includes("Too Many Requests");
      const isNetwork = msg.includes("fetch") || msg.includes("ECONNREFUSED");

      if ((isRateLimit || isNetwork) && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt);
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
  if (KNOWN_MARKETS.length === 0) return [];

  const conn = getConnection();
  const results: Array<{ address: string; state: MarketState }> = [];

  // Fetch all known markets in parallel
  const fetches = KNOWN_MARKETS.map(async (market) => {
    try {
      const info = await fetchWithBackoff(() =>
        conn.getAccountInfo(new PublicKey(market.slabAddress)),
      );
      if (!info) return null;
      const data = Buffer.from(info.data);
      return {
        address: market.slabAddress,
        state: parseMarketState(data),
      };
    } catch {
      return null;
    }
  });

  const settled = await Promise.all(fetches);
  for (const r of settled) {
    if (r) results.push(r);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main discovery: try getProgramAccounts, then fall back to known markets
// ---------------------------------------------------------------------------
async function runDiscovery(): Promise<void> {
  // Already in-flight — piggyback on existing request
  if (discoveryCache.promise) return discoveryCache.promise;

  discoveryCache.loading = true;
  discoveryCache.error = null;
  notifyListeners();

  discoveryCache.promise = (async () => {
    try {
      const conn = getConnection();
      let parsed: Array<{ address: string; state: MarketState }> = [];

      // Strategy 1: Try full on-chain scan via getProgramAccounts
      try {
        const accounts = await fetchWithBackoff(() =>
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
        );

        parsed = accounts
          .map((a) => {
            try {
              const data = Buffer.from(a.account.data);
              return {
                address: a.pubkey.toBase58(),
                state: parseMarketState(data),
              };
            } catch {
              return null;
            }
          })
          .filter((m): m is NonNullable<typeof m> => m !== null);
      } catch {
        // getProgramAccounts failed — that's OK, we have fallback
      }

      // Strategy 2: If scan returned nothing, load known markets individually
      if (parsed.length === 0) {
        parsed = await loadKnownMarkets();
      } else {
        // Merge: add any known markets that weren't found in the scan
        const foundAddresses = new Set(parsed.map((m) => m.address));
        const missing = KNOWN_MARKETS.filter(
          (km) => !foundAddresses.has(km.slabAddress),
        );
        if (missing.length > 0) {
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
    } catch (e: unknown) {
      // Both strategies failed — try known markets as last resort
      try {
        const fallback = await loadKnownMarkets();
        if (fallback.length > 0) {
          discoveryCache.markets = fallback;
          discoveryCache.timestamp = Date.now();
          discoveryCache.error = null;
          return;
        }
      } catch {
        // Nothing worked
      }
      discoveryCache.error =
        e instanceof Error ? e.message : "Failed to discover markets";
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
    setLoading(true);
    setError(null);

    try {
      const conn = getConnection();
      const info = await fetchWithBackoff(() =>
        conn.getAccountInfo(new PublicKey(slabAddress)),
      );
      if (!mountedRef.current) return;
      if (!info) throw new Error("Market account not found");

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
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to fetch market data");
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
