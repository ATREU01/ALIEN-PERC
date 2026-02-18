/**
 * Xenoscope — SOL/USD Price Hook
 * Fetches live SOL price from CoinGecko with 60s refresh.
 * Falls back to server-side cache at /api/xenoscope/sol-price.
 */
import { useState, useEffect } from "react";

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const REFRESH_INTERVAL_MS = 60_000;
const DEFAULT_PRICE = 200;

export function useSolPrice(): number {
  const [price, setPrice] = useState<number>(DEFAULT_PRICE);

  useEffect(() => {
    let cancelled = false;

    const fetchPrice = async () => {
      try {
        // Try CoinGecko first
        const res = await fetch(COINGECKO_URL);
        const data = await res.json();
        if (!cancelled && data.solana?.usd) {
          setPrice(data.solana.usd);
          return;
        }
      } catch {
        // CoinGecko failed — try server cache
      }

      try {
        const res = await fetch("/api/xenoscope/sol-price");
        const data = await res.json();
        if (!cancelled && data.price) {
          setPrice(data.price);
        }
      } catch {
        // Both failed — keep last known price
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return price;
}

/** Format as compact USD (e.g., $1.2M) */
export function formatCompactUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Format as full USD (e.g., $1,234.56) */
export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}
