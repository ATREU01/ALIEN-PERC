/**
 * Xenoscope — Real-time Pump.fun WebSocket Hook
 * Connects to the PumpPortal stream for live token events
 * (creates, trades, migrations) on Solana mainnet.
 */
import { useEffect, useRef, useState } from "react";

export type PumpEvent = {
  txType: "create" | "buy" | "sell" | "migrate";
  mint?: string;
  signature?: string;
  traderPublicKey?: string;
  tokenBondingCurve?: string;
  solAmount?: number;
  tokenAmount?: number;
  initialBuy?: number;
  isBuy?: boolean;
  timestamp: number;
  name?: string;
  symbol?: string;
  marketCapSol?: number;
  vSolInBondingCurve?: number;
  vTokensInBondingCurve?: number;
  uri?: string;
};

const WS_URL = "wss://pumpportal.fun/api/data";
const MAX_EVENTS = 100;
const RECONNECT_DELAY_MS = 3000;

export function usePumpSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<PumpEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = () => {
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        setIsConnected(true);

        // Subscribe to new token creations and migrations
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: "subscribeNewToken" }));
          ws.send(JSON.stringify({ method: "subscribeMigration" }));
        }
      };

      // Track subscribed token mints for live trade updates
      const subscribedMints = new Set<string>();
      const MAX_TRADE_SUBS = 20;

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;

        try {
          const data = JSON.parse(event.data);

          if (data.txType) {
            // PumpPortal sends txType "buy"/"sell", not "trade"
            // Derive isBuy from txType for backward compatibility
            const newEvent: PumpEvent = {
              txType: data.txType,
              mint: data.mint,
              signature: data.signature,
              traderPublicKey: data.traderPublicKey,
              tokenBondingCurve: data.tokenBondingCurve || data.bondingCurveKey,
              solAmount: data.solAmount,
              tokenAmount: data.tokenAmount,
              initialBuy: data.initialBuy,
              isBuy: data.txType === "buy" || (data.txType === "create" && data.initialBuy > 0),
              timestamp: Date.now(),
              name: data.name,
              symbol: data.symbol,
              marketCapSol: data.marketCapSol,
              vSolInBondingCurve: data.vSolInBondingCurve,
              vTokensInBondingCurve: data.vTokensInBondingCurve,
              uri: data.uri,
            };

            // For new tokens, subscribe to their trades for live market cap updates
            if (data.txType === "create" && data.mint && ws.readyState === WebSocket.OPEN) {
              if (subscribedMints.size >= MAX_TRADE_SUBS) {
                const oldest = subscribedMints.values().next().value;
                if (oldest) {
                  ws.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: [oldest] }));
                  subscribedMints.delete(oldest);
                }
              }
              ws.send(JSON.stringify({ method: "subscribeTokenTrade", keys: [data.mint] }));
              subscribedMints.add(data.mint);
            }

            setEvents((prev) => {
              // For trade events on known tokens, update the existing entry's market cap
              if ((newEvent.txType === "buy" || newEvent.txType === "sell") && newEvent.mint) {
                const existingIdx = prev.findIndex((e) => e.mint === newEvent.mint);
                if (existingIdx !== -1) {
                  const updated = [...prev];
                  updated[existingIdx] = {
                    ...updated[existingIdx],
                    marketCapSol: newEvent.marketCapSol ?? updated[existingIdx].marketCapSol,
                    vSolInBondingCurve: newEvent.vSolInBondingCurve ?? updated[existingIdx].vSolInBondingCurve,
                    vTokensInBondingCurve: newEvent.vTokensInBondingCurve ?? updated[existingIdx].vTokensInBondingCurve,
                  };
                  if (
                    newEvent.signature &&
                    prev.some((e) => e.signature === newEvent.signature)
                  ) {
                    return updated;
                  }
                  return [newEvent, ...updated].slice(0, MAX_EVENTS);
                }
              }

              // Deduplicate by signature
              if (
                newEvent.signature &&
                prev.some((e) => e.signature === newEvent.signature)
              ) {
                return prev;
              }
              return [newEvent, ...prev].slice(0, MAX_EVENTS);
            });
          }
        } catch {
          // Silently ignore parse errors (keep-alive, unknown formats)
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setIsConnected(false);
        wsRef.current = null;

        if (!reconnectRef.current) {
          reconnectRef.current = setTimeout(() => {
            reconnectRef.current = null;
            connect();
          }, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    } catch {
      setIsConnected(false);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };
  }, []);

  return { isConnected, events };
}
