/**
 * Formatting utilities for the ALIEN Percolator UI
 */

const PRICE_E6 = 1_000_000n;
const TOKEN_DECIMALS = 9; // SPL default

/**
 * Format a price stored as u64 with 1e6 precision
 */
export function formatPriceE6(price: bigint, decimals = 2): string {
  const whole = price / PRICE_E6;
  const frac = price % PRICE_E6;
  const fracStr = frac.toString().padStart(6, "0").slice(0, decimals);
  return `${whole.toLocaleString()}.${fracStr}`;
}

/**
 * Format a token amount (assumes 9 decimal places by default)
 */
export function formatTokenAmount(
  amount: bigint,
  decimals = TOKEN_DECIMALS,
  display = 2
): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const frac = amount % divisor;
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .slice(0, display);
  return `${whole.toLocaleString()}.${fracStr}`;
}

/**
 * Format basis points as percentage
 */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Format SOL amount
 */
export function formatSol(lamports: bigint): string {
  return formatTokenAmount(lamports, 9, 4);
}

/**
 * Compact number formatting (1.2K, 3.4M, etc.)
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(2);
}

/**
 * Truncate a Solana address for display
 */
export function truncateAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format a percentage change with + or - prefix
 */
export function formatChange(pct: number): string {
  const prefix = pct >= 0 ? "+" : "";
  return `${prefix}${pct.toFixed(2)}%`;
}

/**
 * Format USD value
 */
export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Format a bigint as a human-readable number (divides by 1e6)
 */
export function formatBigintE6(val: bigint): string {
  const num = Number(val) / 1_000_000;
  return formatCompact(num);
}

/**
 * Time ago string
 */
export function timeAgo(slot: bigint, currentSlot: bigint): string {
  const diff = Number(currentSlot - slot);
  const seconds = diff * 0.4; // ~400ms per slot
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
