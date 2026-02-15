/**
 * Hook for fetching and subscribing to percolator market data
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  parseMarketState,
  parseAccount,
  type MarketState,
  type AccountData,
} from "../lib/percolator";
import { RPC_ENDPOINT, MAX_ACCOUNTS } from "../lib/constants";

// Shared connection singleton
let _connection: Connection | null = null;
function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(RPC_ENDPOINT, "confirmed");
  }
  return _connection;
}

export interface MarketInfo {
  state: MarketState;
  accounts: AccountData[];
  rawData: Buffer;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
}

/**
 * Fetch and parse a single market's on-chain data
 */
export function useMarketData(slabAddress: string | null) {
  const [state, setState] = useState<MarketState | null>(null);
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [rawData, setRawData] = useState<Buffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const subRef = useRef<number | null>(null);

  const fetchData = useCallback(async () => {
    if (!slabAddress) return;
    setLoading(true);
    setError(null);

    try {
      const conn = getConnection();
      const info = await conn.getAccountInfo(new PublicKey(slabAddress));
      if (!info) throw new Error("Market account not found");

      const data = Buffer.from(info.data);
      const parsed = parseMarketState(data);
      setState(parsed);
      setRawData(data);

      // Parse all active accounts
      const accts: AccountData[] = [];
      for (let i = 0; i < MAX_ACCOUNTS && i < parsed.numAccounts + 100; i++) {
        const acct = parseAccount(data, i);
        if (acct) accts.push(acct);
      }
      setAccounts(accts);
      setLastUpdate(Date.now());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch market data");
    } finally {
      setLoading(false);
    }
  }, [slabAddress]);

  // Subscribe to account changes for live updates
  useEffect(() => {
    if (!slabAddress) return;

    fetchData();

    const conn = getConnection();
    try {
      subRef.current = conn.onAccountChange(
        new PublicKey(slabAddress),
        (accountInfo) => {
          try {
            const data = Buffer.from(accountInfo.data);
            const parsed = parseMarketState(data);
            setState(parsed);
            setRawData(data);

            const accts: AccountData[] = [];
            for (
              let i = 0;
              i < MAX_ACCOUNTS && i < parsed.numAccounts + 100;
              i++
            ) {
              const acct = parseAccount(data, i);
              if (acct) accts.push(acct);
            }
            setAccounts(accts);
            setLastUpdate(Date.now());
          } catch {
            // Parse error on update — ignore, stale data is fine
          }
        },
        "confirmed"
      );
    } catch {
      // Subscription failed — polling fallback
      const interval = setInterval(fetchData, 5000);
      return () => clearInterval(interval);
    }

    return () => {
      if (subRef.current !== null) {
        conn.removeAccountChangeListener(subRef.current);
        subRef.current = null;
      }
    };
  }, [slabAddress, fetchData]);

  return { state, accounts, rawData, loading, error, lastUpdate, refetch: fetchData };
}

/**
 * Discover all percolator markets on-chain via getProgramAccounts
 */
export function useMarketDiscovery() {
  const [markets, setMarkets] = useState<
    Array<{ address: string; state: MarketState }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const discover = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const conn = getConnection();
      const programId = new PublicKey(
        "2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp"
      );

      // Fetch all accounts owned by the percolator program
      // Filter by magic bytes to only get slab accounts
      const accounts = await conn.getProgramAccounts(programId, {
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: "6Aptvk7gABj", // Base58 of PERCOLAT magic u64 LE
            },
          },
        ],
      });

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

      setMarkets(parsed);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to discover markets"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    discover();
  }, [discover]);

  return { markets, loading, error, refresh: discover };
}
