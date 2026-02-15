/**
 * Hook for fetching and subscribing to percolator market data.
 *
 * Fixes applied:
 * - Shared discovery cache (one getProgramAccounts call, not per-component)
 * - Exponential backoff on 429 / network errors
 * - Polling instead of WebSocket (free RPC tiers don't support WS well)
 * - Uses wallet adapter connection (no duplicate connections)
 * - Graceful degradation when getProgramAccounts is blocked
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  parseMarketState,
  parseAccount,
  type MarketState,
  type AccountData,
} from "../lib/percolator";
import { RPC_ENDPOINT, PERCOLATOR_PROGRAM_ID, MAX_ACCOUNTS } from "../lib/constants";

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

async function runDiscovery(): Promise<void> {
  // Already in-flight — piggyback on existing request
  if (discoveryCache.promise) return discoveryCache.promise;

  discoveryCache.loading = true;
  discoveryCache.error = null;
  notifyListeners();

  discoveryCache.promise = (async () => {
    try {
      const conn = getConnection();
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
          dataSlice: { offset: 0, length: 9200 }, // Header+Config+Engine only — skip 4096 accounts
        }),
      );

      const parsed = accounts
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

      discoveryCache.markets = parsed;
      discoveryCache.timestamp = Date.now();
      discoveryCache.error = null;
    } catch (e: unknown) {
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
