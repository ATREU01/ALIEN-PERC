import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";

// ═══════════════════════════════════════════════════════════════════
// ALIENTOR LAUNCHPAD - Solana Mainnet Token Launch Platform
// Built on pump.fun | Vanity addresses | Programmable fee allocation
// Sub-tabs: Launch | TEK Dashboard | Leaderboard | My Tokens
// ═══════════════════════════════════════════════════════════════════

type LaunchStep = 1 | 2 | 3 | 4;
type LaunchPath = "pumpfun" | "raydium";
type Strategy = "balanced" | "growth" | "burn" | "lp" | "revenue";
type SubTab = "launch" | "dashboard" | "leaderboard" | "mytokens" | "moltbot";

interface VaultKeypair {
  vaultId: string;
  publicKey: string;
}

interface LaunchedToken {
  mint: string;
  name: string;
  symbol: string;
  creator: string;
  path: string;
  registeredAt: number;
}

interface LeaderboardEntry {
  rank: number;
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  mcap: number;
  volume: number;
  progress: number;
  graduated: boolean;
  path: string;
  pinned: boolean;
  reward: string | null;
  holders: number;
}

interface TekTokenData {
  mint: string;
  name: string;
  symbol: string;
  allocationStrategy: string;
  registeredAt: number;
  market: {
    mcap: number;
    price: number;
    progress: number;
    graduated: boolean;
    volume24h: number;
    image: string | null;
    liquidity?: number;
    priceChange?: { m5: number; h1: number; h6: number; h24: number };
  } | null;
  analysis: {
    allocations: Record<string, number>;
    strategy: string;
  } | null;
}

function formatMcap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  if (n > 0) return `$${n.toFixed(0)}`;
  return "$0";
}

function formatSol(n: number): string {
  if (n === 0) return "0";
  if (n < 0.001) return n.toExponential(2);
  return n.toFixed(6);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const ALLOC_LABELS: Record<string, string> = {
  marketMaking: "Market Making",
  buybackBurn: "Buyback & Burn",
  liquidity: "Liquidity",
  creatorRevenue: "Creator Revenue",
};

const ALLOC_COLORS: Record<string, string> = {
  marketMaking: "var(--cyan)",
  buybackBurn: "var(--red)",
  liquidity: "var(--purple)",
  creatorRevenue: "var(--alien-green)",
};

const STRATEGIES: Record<Strategy, { label: string; desc: string; allocations: Record<string, number> }> = {
  balanced: {
    label: "Balanced",
    desc: "Equal split across all strategies",
    allocations: { marketMaking: 25, buybackBurn: 25, liquidity: 25, creatorRevenue: 25 },
  },
  growth: {
    label: "Growth",
    desc: "Aggressive market making & LP for volume",
    allocations: { marketMaking: 40, buybackBurn: 20, liquidity: 30, creatorRevenue: 10 },
  },
  burn: {
    label: "Deflation",
    desc: "Maximum buyback & burn for price support",
    allocations: { marketMaking: 20, buybackBurn: 50, liquidity: 20, creatorRevenue: 10 },
  },
  lp: {
    label: "Liquidity",
    desc: "Deep liquidity pool for low slippage",
    allocations: { marketMaking: 15, buybackBurn: 15, liquidity: 60, creatorRevenue: 10 },
  },
  revenue: {
    label: "Revenue",
    desc: "Maximize creator revenue extraction",
    allocations: { marketMaking: 20, buybackBurn: 10, liquidity: 20, creatorRevenue: 50 },
  },
};

// ═══════════════════════════════════════════════════════════════════
//  TEK DASHBOARD — Alien TEK Fee Engine Monitor
// ═══════════════════════════════════════════════════════════════════

function TekDashboard({ publicKey, connected }: { publicKey: any; connected: boolean }) {
  const [tekTokens, setTekTokens] = useState<TekTokenData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedToken, setSelectedToken] = useState<TekTokenData | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/launchpad/tek-dashboard?wallet=${publicKey.toBase58()}`);
      if (res.ok) {
        const data = await res.json();
        setTekTokens(data.tokens || []);
        if (data.tokens?.length > 0 && !selectedToken) {
          setSelectedToken(data.tokens[0]);
        }
        setLastRefresh(Date.now());
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [publicKey, selectedToken]);

  useEffect(() => {
    if (connected && publicKey) loadDashboard();
  }, [connected, publicKey, loadDashboard]);

  if (!connected) {
    return (
      <div className="tek-dash-empty">
        <div className="tek-dash-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Connect Wallet</h3>
        <p className="text-muted" style={{ fontSize: "0.85rem" }}>
          Connect your wallet to view the Alien TEK dashboard for your launched tokens.
        </p>
      </div>
    );
  }

  if (loading && tekTokens.length === 0) {
    return (
      <div className="tek-dash-empty">
        <div className="tek-dash-loading-spinner" />
        <p className="text-muted" style={{ marginTop: "1rem" }}>Loading TEK Engine data...</p>
      </div>
    );
  }

  if (tekTokens.length === 0) {
    return (
      <div className="tek-dash-empty">
        <div className="tek-dash-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No Tokens Yet</h3>
        <p className="text-muted" style={{ fontSize: "0.85rem" }}>
          Launch a token with the Alien TEK fee engine to see your dashboard here.
        </p>
      </div>
    );
  }

  const active = selectedToken || tekTokens[0];
  const allocs = active.analysis?.allocations || {};
  const stratLabel =
    STRATEGIES[active.allocationStrategy as Strategy]?.label || active.allocationStrategy || "Custom";
  const priceChange = active.market?.priceChange;

  return (
    <div className="tek-dash">
      {/* Top bar: token selector + refresh */}
      <div className="tek-dash-topbar">
        <div className="tek-dash-token-selector">
          {tekTokens.map((t) => (
            <button
              key={t.mint}
              className={`tek-dash-token-pill ${active.mint === t.mint ? "active" : ""}`}
              onClick={() => setSelectedToken(t)}
            >
              {t.market?.image && (
                <img src={t.market.image} alt="" className="tek-dash-pill-img" />
              )}
              <span>${t.symbol || t.mint.slice(0, 6)}</span>
            </button>
          ))}
        </div>
        <button
          className="tek-dash-refresh"
          onClick={loadDashboard}
          disabled={loading}
          title="Refresh dashboard"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={loading ? "tek-spin" : ""}>
            <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {lastRefresh > 0 && (
            <span className="tek-dash-refresh-time">{timeAgo(lastRefresh)}</span>
          )}
        </button>
      </div>

      {/* Main stats row */}
      <div className="tek-dash-stats-row">
        <div className="tek-dash-stat-card">
          <span className="tek-dash-stat-label">Market Cap</span>
          <span className="tek-dash-stat-value text-alien">
            {active.market ? formatMcap(active.market.mcap) : "--"}
          </span>
        </div>
        <div className="tek-dash-stat-card">
          <span className="tek-dash-stat-label">Price (SOL)</span>
          <span className="tek-dash-stat-value text-cyan">
            {active.market ? formatSol(active.market.price) : "--"}
          </span>
        </div>
        <div className="tek-dash-stat-card">
          <span className="tek-dash-stat-label">24h Volume</span>
          <span className="tek-dash-stat-value text-purple">
            {active.market ? formatMcap(active.market.volume24h) : "--"}
          </span>
        </div>
        <div className="tek-dash-stat-card">
          <span className="tek-dash-stat-label">Status</span>
          <span className={`tek-dash-stat-value ${active.market?.graduated ? "text-green" : "text-yellow"}`}>
            {active.market?.graduated ? "Graduated" : "Bonding"}
          </span>
        </div>
      </div>

      {/* Price changes bar */}
      {priceChange && (
        <div className="tek-dash-price-changes">
          {(["m5", "h1", "h6", "h24"] as const).map((period) => {
            const val = priceChange[period];
            const label = period === "m5" ? "5m" : period === "h1" ? "1h" : period === "h6" ? "6h" : "24h";
            return (
              <div key={period} className="tek-dash-price-change">
                <span className="tek-dash-pc-label">{label}</span>
                <span className={`tek-dash-pc-value ${val >= 0 ? "text-green" : "text-red"}`}>
                  {val >= 0 ? "+" : ""}{val.toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Two-column layout: Allocation Engine + Token Info */}
      <div className="tek-dash-grid">
        {/* Left: TEK Allocation Engine */}
        <div className="tek-dash-panel">
          <div className="tek-dash-panel-header">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="2" style={{ marginRight: 6 }}>
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M9 12L11 14L15 10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Alien TEK Engine
            </h3>
            <span className="tek-dash-strategy-badge">{stratLabel}</span>
          </div>

          {/* Donut-style allocation visualization */}
          <div className="tek-dash-alloc-visual">
            <div className="tek-dash-donut">
              <svg viewBox="0 0 120 120" className="tek-dash-donut-svg">
                {(() => {
                  const entries = Object.entries(allocs);
                  let cumulative = 0;
                  return entries.map(([key, val]) => {
                    const pct = val as number;
                    const startAngle = (cumulative / 100) * 360;
                    cumulative += pct;
                    const endAngle = (cumulative / 100) * 360;
                    const startRad = ((startAngle - 90) * Math.PI) / 180;
                    const endRad = ((endAngle - 90) * Math.PI) / 180;
                    const r = 50;
                    const cx = 60, cy = 60;
                    const x1 = cx + r * Math.cos(startRad);
                    const y1 = cy + r * Math.sin(startRad);
                    const x2 = cx + r * Math.cos(endRad);
                    const y2 = cy + r * Math.sin(endRad);
                    const largeArc = pct > 50 ? 1 : 0;
                    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                    return (
                      <path
                        key={key}
                        d={d}
                        fill={ALLOC_COLORS[key] || "var(--text-muted)"}
                        opacity="0.75"
                        stroke="var(--bg-base)"
                        strokeWidth="1.5"
                      />
                    );
                  });
                })()}
                <circle cx="60" cy="60" r="28" fill="var(--bg-card)" />
                <text x="60" y="57" textAnchor="middle" fill="var(--text-primary)" fontSize="11" fontWeight="700">TEK</text>
                <text x="60" y="70" textAnchor="middle" fill="var(--text-muted)" fontSize="8">ENGINE</text>
              </svg>
            </div>

            <div className="tek-dash-alloc-legend">
              {Object.entries(allocs).map(([key, val]) => (
                <div key={key} className="tek-dash-alloc-item">
                  <span
                    className="tek-dash-alloc-dot"
                    style={{ background: ALLOC_COLORS[key] || "var(--text-muted)" }}
                  />
                  <span className="tek-dash-alloc-name">{ALLOC_LABELS[key] || key}</span>
                  <span className="tek-dash-alloc-pct">{val as number}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Allocation bars */}
          <div className="tek-dash-alloc-bars">
            {Object.entries(allocs).map(([key, val]) => (
              <div key={key} className="tek-dash-bar-row">
                <div className="tek-dash-bar-track">
                  <div
                    className="tek-dash-bar-fill"
                    style={{
                      width: `${val as number}%`,
                      background: ALLOC_COLORS[key] || "var(--text-muted)",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Token Details */}
        <div className="tek-dash-panel">
          <div className="tek-dash-panel-header">
            <h3>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2" style={{ marginRight: 6 }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" strokeLinecap="round" />
              </svg>
              Token Details
            </h3>
            <span className="badge-mainnet" style={{ fontSize: "0.65rem", padding: "2px 8px" }}>MAINNET</span>
          </div>

          <div className="tek-dash-details">
            <div className="tek-dash-detail-row">
              <span className="text-muted">Name</span>
              <span>{active.name || "--"}</span>
            </div>
            <div className="tek-dash-detail-row">
              <span className="text-muted">Symbol</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--alien-green)" }}>
                ${active.symbol || "???"}
              </span>
            </div>
            <div className="tek-dash-detail-row">
              <span className="text-muted">Mint</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
                {active.mint.slice(0, 8)}...{active.mint.slice(-8)}
              </span>
            </div>
            <div className="tek-dash-detail-row">
              <span className="text-muted">Launched</span>
              <span>{active.registeredAt ? timeAgo(active.registeredAt) : "--"}</span>
            </div>
            {active.market?.progress !== undefined && !active.market.graduated && (
              <div className="tek-dash-detail-row">
                <span className="text-muted">Bond Progress</span>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div className="tek-dash-progress-bar">
                    <div
                      className="tek-dash-progress-fill"
                      style={{ width: `${Math.min(100, active.market.progress)}%` }}
                    />
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                    {active.market.progress.toFixed(1)}%
                  </span>
                </div>
              </div>
            )}
            {active.market?.liquidity !== undefined && active.market.liquidity > 0 && (
              <div className="tek-dash-detail-row">
                <span className="text-muted">Liquidity</span>
                <span className="text-purple">{formatMcap(active.market.liquidity)}</span>
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="tek-dash-links">
            <a
              href={`https://pump.fun/coin/${active.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tek-dash-link tek-dash-link-pump"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              pump.fun
            </a>
            <a
              href={`https://dexscreener.com/solana/${active.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tek-dash-link tek-dash-link-dex"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              DexScreener
            </a>
            <a
              href={`https://solscan.io/token/${active.mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="tek-dash-link tek-dash-link-sol"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" strokeLinecap="round" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Solscan
            </a>
          </div>
        </div>
      </div>

      {/* Fee engine info footer */}
      <div className="tek-dash-footer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="2" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
        </svg>
        <span className="text-muted" style={{ fontSize: "0.8rem" }}>
          The Alien TEK engine routes 1% creator fees through your selected strategy.
          Market Making, Buyback & Burn, Liquidity, and Revenue allocations execute automatically
          based on real-time market conditions via the Alientor Protocol.
        </span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  MAIN LAUNCHPAD COMPONENT
// ═══════════════════════════════════════════════════════════════════

export function Launchpad() {
  const { publicKey, signTransaction, connected } = useWallet();
  const [activeTab, setActiveTab] = useState<SubTab>("launch");
  const [step, setStep] = useState<LaunchStep>(1);
  const [launchPath] = useState<LaunchPath>("pumpfun");

  // Token metadata
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenDesc, setTokenDesc] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [website, setWebsite] = useState("");

  // Launch config
  const [initialBuy, setInitialBuy] = useState("0");
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [useVanity, setUseVanity] = useState(false);

  // Vault state
  const [vaultKeypair, setVaultKeypair] = useState<VaultKeypair | null>(null);
  const [loadingVanity, setLoadingVanity] = useState(false);

  // Launch state
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState("");
  const [launchedMint, setLaunchedMint] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // My tokens
  const [myTokens, setMyTokens] = useState<LaunchedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);

  // Stats
  const [stats, setStats] = useState<{ totalTokens: number } | null>(null);

  // Leaderboard
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(true);

  const SUB_TABS: { key: SubTab; label: string; icon: JSX.Element }[] = [
    {
      key: "launch",
      label: "Launch",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      key: "dashboard",
      label: "TEK Dashboard",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      ),
    },
    {
      key: "leaderboard",
      label: "Leaderboard",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
      ),
    },
    {
      key: "mytokens",
      label: "My Tokens",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v12M6 12h12" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      key: "moltbot",
      label: "Molt Bot",
      icon: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
          <path d="M8 10h.01M16 10h.01" strokeLinecap="round" />
          <path d="M9 16c.85.63 1.885 1 3 1s2.15-.37 3-1" strokeLinecap="round" />
          <path d="M12 2v3M2 12h3M22 12h-3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  // Load stats + leaderboard on mount
  useEffect(() => {
    fetch("/api/launchpad/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});

    setLoadingLeaderboard(true);
    fetch("/api/launchpad/leaderboard")
      .then((r) => r.json())
      .then((data) => setLeaderboard(data.leaderboard || []))
      .catch(() => {})
      .finally(() => setLoadingLeaderboard(false));
  }, []);

  // Load user's tokens when wallet connects
  useEffect(() => {
    if (!publicKey) { setMyTokens([]); return; }
    setLoadingTokens(true);
    fetch(`/api/launchpad/my-tokens?wallet=${publicKey.toBase58()}`)
      .then((r) => r.json())
      .then((data) => setMyTokens(data.tokens || []))
      .catch(() => {})
      .finally(() => setLoadingTokens(false));
  }, [publicKey]);

  // Request vanity keypair from vault
  const requestVanityKeypair = useCallback(async () => {
    setLoadingVanity(true);
    try {
      const res = await fetch("/api/launchpad/vanity-keypair");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to get keypair");
      }
      const data = await res.json();
      setVaultKeypair(data);
    } catch (err: any) {
      setLaunchError(err.message);
    } finally {
      setLoadingVanity(false);
    }
  }, []);

  // Auto-request vanity keypair when enabled
  useEffect(() => {
    if (useVanity && !vaultKeypair && !loadingVanity) {
      requestVanityKeypair();
    }
  }, [useVanity, vaultKeypair, loadingVanity, requestVanityKeypair]);

  // Execute launch
  const handleLaunch = async () => {
    if (!publicKey || !signTransaction) return;
    setLaunching(true);
    setLaunchError(null);
    setLaunchedMint(null);

    try {
      let mintPublicKey: string;
      let mintVaultId: string | null = null;

      if (useVanity && vaultKeypair) {
        mintPublicKey = vaultKeypair.publicKey;
        mintVaultId = vaultKeypair.vaultId;
        setLaunchStatus("Using vault mint address...");
      } else {
        const mintKp = Keypair.generate();
        mintPublicKey = mintKp.publicKey.toBase58();
        setLaunchStatus("Generated mint address...");
      }

      setLaunchStatus("Building transaction on pump.fun...");
      const buildRes = await fetch("/api/launchpad/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: publicKey.toBase58(),
          name: tokenName,
          symbol: tokenSymbol,
          description: tokenDesc,
          twitter, telegram, website,
          mint: mintPublicKey,
          initialBuy: parseFloat(initialBuy) || 0,
        }),
      });

      if (!buildRes.ok) {
        const err = await buildRes.json();
        throw new Error(err.error || "Failed to build transaction");
      }

      const { transaction: txBase64 } = await buildRes.json();
      let txBytes = Buffer.from(txBase64, "base64");

      if (mintVaultId) {
        setLaunchStatus("Server signing with vault key...");
        const signRes = await fetch("/api/launchpad/vault/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vaultId: mintVaultId, transaction: txBase64 }),
        });

        if (!signRes.ok) {
          const err = await signRes.json();
          throw new Error(err.error || "Vault signing failed");
        }

        const { signedTransaction } = await signRes.json();
        txBytes = Buffer.from(signedTransaction, "base64");
      }

      setLaunchStatus("Sign with your wallet...");
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);

      setLaunchStatus("Broadcasting to Solana mainnet...");
      const mainnetRpc = `${window.location.origin}/api/rpc-mainnet`;
      const connection = new Connection(mainnetRpc, "confirmed");
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      setLaunchStatus("Confirming on-chain...");
      await new Promise((r) => setTimeout(r, 5000));

      setLaunchStatus("Registering token...");
      await fetch("/api/launchpad/register-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: mintPublicKey,
          creator: publicKey.toBase58(),
          name: tokenName,
          symbol: tokenSymbol,
          description: tokenDesc,
          path: launchPath,
          allocationStrategy: strategy,
        }),
      });

      setLaunchedMint(mintPublicKey);
      setLaunchStatus("Launch successful!");

      const tokensRes = await fetch(`/api/launchpad/my-tokens?wallet=${publicKey.toBase58()}`);
      const tokensData = await tokensRes.json();
      setMyTokens(tokensData.tokens || []);
    } catch (err: any) {
      setLaunchError(err.message || "Launch failed");
      setLaunchStatus("");
    } finally {
      setLaunching(false);
    }
  };

  const canProceedStep1 = tokenName.length >= 1 && tokenSymbol.length >= 1;
  const canProceedStep2 = true;
  const canProceedStep3 = true;
  const isBusy = launching;

  return (
    <div className="page">
      {/* ── Page Header ── */}
      <div className="lp-header">
        <div className="lp-header-left">
          <div className="lp-logo-block">
            <div className="lp-logo-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="2">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h1 className="lp-title">ALIENTOR LAUNCHPAD</h1>
              <p className="lp-subtitle">Programmable Fee Engine on Solana Mainnet</p>
            </div>
          </div>
        </div>
        <div className="lp-header-right">
          <div className="lp-stat-mini">
            <span className="text-alien">{stats?.totalTokens ?? "--"}</span>
            <span className="text-muted">Launched</span>
          </div>
          <div className="badge-mainnet">SOLANA MAINNET</div>
        </div>
      </div>

      {/* ── Sub-tab Navigation ── */}
      <div className="xeno-tabs lp-tabs">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`xeno-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      <div className="xeno-content">

        {/* ═══ LAUNCH TAB ═══ */}
        {activeTab === "launch" && (
          <>
            {/* Launchpad Stats Bar */}
            <div className="launchpad-stats-bar">
              <div className="launchpad-stat">
                <span className="launchpad-stat-value text-alien">
                  {stats?.totalTokens ?? "--"}
                </span>
                <span className="launchpad-stat-label">Tokens Launched</span>
              </div>
              <div className="launchpad-stat">
                <span className="launchpad-stat-value text-cyan">MAINNET</span>
                <span className="launchpad-stat-label">Network</span>
              </div>
              <div className="launchpad-stat">
                <span className="launchpad-stat-value text-purple">pump.fun</span>
                <span className="launchpad-stat-label">Launch Platform</span>
              </div>
              <div className="launchpad-stat">
                <span className="launchpad-stat-value text-alien">1%</span>
                <span className="launchpad-stat-label">Creator Fee</span>
              </div>
            </div>

            {/* Progress Steps */}
            <div className="register-steps" style={{ marginBottom: "2rem" }}>
              {[
                { n: 1, title: "Token Info", desc: "Name, symbol & socials" },
                { n: 2, title: "Strategy", desc: "Fee allocation" },
                { n: 3, title: "Mint Setup", desc: "Vanity address" },
                { n: 4, title: "Launch", desc: "Deploy on pump.fun" },
              ].map((s, i) => (
                <React.Fragment key={s.n}>
                  {i > 0 && <div className="step-line" />}
                  <div className={`register-step ${step >= s.n ? "active" : ""} ${step > s.n ? "completed" : ""}`}>
                    <div className="step-icon">{s.n}</div>
                    <div className="step-content">
                      <span className="step-title">{s.title}</span>
                      <span className="step-desc">{s.desc}</span>
                    </div>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* Step Content */}
            <div className="register-container">
              <div className="register-form">

                {/* STEP 1: Token Metadata */}
                {step === 1 && (
                  <>
                    <h3 style={{ marginBottom: "1rem" }}>Token Information</h3>
                    <div className="launchpad-network-badge">
                      <span className="pulse-dot" />
                      <span>Deploying to Solana Mainnet via pump.fun</span>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Token Name *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. Alien Signal"
                        value={tokenName}
                        onChange={(e) => setTokenName(e.target.value)}
                        maxLength={32}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Token Symbol *</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. SIGNAL"
                        value={tokenSymbol}
                        onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                        maxLength={10}
                        style={{ fontFamily: "var(--font-mono)" }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">Description</label>
                      <textarea
                        className="form-input"
                        placeholder="What is this token about?"
                        value={tokenDesc}
                        onChange={(e) => setTokenDesc(e.target.value)}
                        rows={3}
                        maxLength={500}
                        style={{ resize: "vertical", minHeight: "72px" }}
                      />
                    </div>

                    <div className="launchpad-socials-grid">
                      <div className="form-group">
                        <label className="form-label">Twitter / X</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="@handle"
                          value={twitter}
                          onChange={(e) => setTwitter(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Telegram</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="t.me/group"
                          value={telegram}
                          onChange={(e) => setTelegram(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Website</label>
                        <input
                          type="text"
                          className="form-input"
                          placeholder="https://..."
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* STEP 2: Fee Allocation Strategy */}
                {step === 2 && (
                  <>
                    <h3 style={{ marginBottom: "0.5rem" }}>Fee Allocation Strategy</h3>
                    <p className="text-muted" style={{ marginBottom: "1.25rem", fontSize: "0.85rem" }}>
                      Configure how the 1% pump.fun creator fee gets distributed automatically.
                      This powers the Alientor programmable fee engine on Solana mainnet.
                    </p>

                    <div className="launchpad-strategy-grid">
                      {(Object.entries(STRATEGIES) as [Strategy, typeof STRATEGIES["balanced"]][]).map(
                        ([key, s]) => (
                          <div
                            key={key}
                            className={`launchpad-strategy-card ${strategy === key ? "active" : ""}`}
                            onClick={() => setStrategy(key)}
                          >
                            <div className="launchpad-strategy-header">
                              <span className="launchpad-strategy-name">{s.label}</span>
                              {strategy === key && <span className="launchpad-strategy-check">&#10003;</span>}
                            </div>
                            <p className="launchpad-strategy-desc">{s.desc}</p>
                            <div className="launchpad-allocation-bars">
                              {Object.entries(s.allocations).map(([aKey, val]) => (
                                <div key={aKey} className="launchpad-alloc-row">
                                  <span className="launchpad-alloc-label">
                                    {aKey === "marketMaking"
                                      ? "Market Making"
                                      : aKey === "buybackBurn"
                                        ? "Buyback & Burn"
                                        : aKey === "liquidity"
                                          ? "Liquidity"
                                          : "Creator Revenue"}
                                  </span>
                                  <div className="launchpad-alloc-bar-track">
                                    <div
                                      className={`launchpad-alloc-bar-fill launchpad-alloc-${aKey}`}
                                      style={{ width: `${val}%` }}
                                    />
                                  </div>
                                  <span className="launchpad-alloc-pct">{val}%</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </>
                )}

                {/* STEP 3: Mint Setup */}
                {step === 3 && (
                  <>
                    <h3 style={{ marginBottom: "0.5rem" }}>Mint Address Setup</h3>
                    <p className="text-muted" style={{ marginBottom: "1.25rem", fontSize: "0.85rem" }}>
                      Choose how the token mint address is generated. Vanity addresses use server-side
                      vault security — the secret key never leaves the server.
                    </p>

                    <div className="form-group">
                      <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        <input
                          type="checkbox"
                          checked={useVanity}
                          onChange={(e) => {
                            setUseVanity(e.target.checked);
                            if (!e.target.checked) setVaultKeypair(null);
                          }}
                        />
                        Use Vault Mint Address (recommended)
                      </label>
                      <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                        Server generates and securely stores the mint keypair. Signs the
                        create transaction server-side. One-time use, 30-minute expiry.
                      </span>
                    </div>

                    {useVanity && vaultKeypair && (
                      <div className="glass-card" style={{ padding: "1rem", marginTop: "0.75rem" }}>
                        <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                          <span className="text-muted">Mint Address</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "var(--alien-green)" }}>
                            {vaultKeypair.publicKey.slice(0, 8)}...{vaultKeypair.publicKey.slice(-8)}
                          </span>
                        </div>
                        <div className="flex-between">
                          <span className="text-muted">Vault Status</span>
                          <span className="text-green" style={{ fontSize: "0.85rem" }}>Secured (server-side)</span>
                        </div>
                      </div>
                    )}

                    {useVanity && !vaultKeypair && !loadingVanity && (
                      <button
                        className="btn-secondary"
                        style={{ marginTop: "0.75rem" }}
                        onClick={requestVanityKeypair}
                      >
                        Request Mint Address
                      </button>
                    )}

                    {loadingVanity && (
                      <div className="text-muted" style={{ marginTop: "0.75rem", fontSize: "0.85rem" }}>
                        Generating secure keypair...
                      </div>
                    )}

                    <div className="form-group" style={{ marginTop: "1.25rem" }}>
                      <label className="form-label">
                        Initial Buy (SOL)
                        <span className="text-muted" style={{ fontWeight: 400, marginLeft: "0.5rem" }}>
                          Optional creator buy on launch
                        </span>
                      </label>
                      <input
                        type="number"
                        className="form-input"
                        placeholder="0"
                        value={initialBuy}
                        onChange={(e) => setInitialBuy(e.target.value)}
                        min="0"
                        step="0.1"
                        style={{ fontFamily: "var(--font-mono)", maxWidth: "200px" }}
                      />
                    </div>
                  </>
                )}

                {/* STEP 4: Review & Launch */}
                {step === 4 && (
                  <>
                    <h3 style={{ marginBottom: "1rem" }}>Review & Launch</h3>
                    <div className="launchpad-network-badge" style={{ marginBottom: "1rem" }}>
                      <span className="pulse-dot" />
                      <span>Deploying to Solana Mainnet via pump.fun</span>
                    </div>

                    <div className="glass-card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
                      <h4 className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                        TOKEN CONFIGURATION
                      </h4>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <span className="text-muted">Name</span>
                        <span>{tokenName}</span>
                      </div>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <span className="text-muted">Symbol</span>
                        <span style={{ fontFamily: "var(--font-mono)" }}>${tokenSymbol}</span>
                      </div>
                      {tokenDesc && (
                        <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                          <span className="text-muted">Description</span>
                          <span style={{ maxWidth: "60%", textAlign: "right", fontSize: "0.85rem" }}>
                            {tokenDesc.slice(0, 80)}{tokenDesc.length > 80 ? "..." : ""}
                          </span>
                        </div>
                      )}
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <span className="text-muted">Launch Platform</span>
                        <span className="text-cyan">pump.fun (Mainnet)</span>
                      </div>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <span className="text-muted">Fee Strategy</span>
                        <span className="text-purple">{STRATEGIES[strategy].label}</span>
                      </div>
                      <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                        <span className="text-muted">Initial Buy</span>
                        <span style={{ fontFamily: "var(--font-mono)" }}>
                          {parseFloat(initialBuy) > 0 ? `${initialBuy} SOL` : "None"}
                        </span>
                      </div>
                      {useVanity && vaultKeypair && (
                        <div className="flex-between">
                          <span className="text-muted">Mint Address</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", color: "var(--alien-green)" }}>
                            {vaultKeypair.publicKey.slice(0, 6)}...{vaultKeypair.publicKey.slice(-6)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Allocation preview */}
                    <div className="glass-card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
                      <h4 className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                        FEE ALLOCATION ({STRATEGIES[strategy].label.toUpperCase()})
                      </h4>
                      {Object.entries(STRATEGIES[strategy].allocations).map(([key, val]) => (
                        <div key={key} className="flex-between" style={{ marginBottom: "0.4rem" }}>
                          <span className="text-muted">
                            {key === "marketMaking"
                              ? "Market Making"
                              : key === "buybackBurn"
                                ? "Buyback & Burn"
                                : key === "liquidity"
                                  ? "Liquidity Pool"
                                  : "Creator Revenue"}
                          </span>
                          <span style={{ fontFamily: "var(--font-mono)" }}>{val}%</span>
                        </div>
                      ))}
                      <div
                        className="flex-between"
                        style={{ borderTop: "1px solid var(--border)", paddingTop: "0.5rem", marginTop: "0.5rem" }}
                      >
                        <span className="text-muted">Alientor Protocol Fee</span>
                        <span className="text-muted" style={{ fontFamily: "var(--font-mono)" }}>1% of creator fees</span>
                      </div>
                    </div>

                    {/* Launch result */}
                    {launchedMint && (
                      <div className="glass-card" style={{ padding: "1rem", marginBottom: "1rem", borderColor: "var(--alien-green)" }}>
                        <div className="text-green" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                          Token Launched Successfully on Mainnet!
                        </div>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: "0.82rem", marginBottom: "0.5rem", wordBreak: "break-all" }}>
                          {launchedMint}
                        </div>
                        <a
                          href={`https://pump.fun/coin/${launchedMint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan"
                          style={{ fontSize: "0.85rem" }}
                        >
                          View on pump.fun
                        </a>
                        {" // "}
                        <a
                          href={`https://solscan.io/token/${launchedMint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan"
                          style={{ fontSize: "0.85rem" }}
                        >
                          View on Solscan
                        </a>
                      </div>
                    )}

                    {launchError && (
                      <div className="text-red" style={{ marginBottom: "1rem", fontSize: "0.85rem" }}>
                        {launchError}
                      </div>
                    )}
                  </>
                )}

                {/* Navigation Buttons */}
                <div className="flex-between" style={{ marginTop: "1.5rem" }}>
                  {step > 1 ? (
                    <button
                      className="btn-secondary"
                      onClick={() => setStep((s) => (s - 1) as LaunchStep)}
                      disabled={isBusy}
                    >
                      Back
                    </button>
                  ) : (
                    <div />
                  )}

                  {step < 4 ? (
                    <button
                      className="btn-primary"
                      disabled={
                        (step === 1 && !canProceedStep1) ||
                        (step === 2 && !canProceedStep2) ||
                        (step === 3 && !canProceedStep3)
                      }
                      onClick={() => setStep((s) => (s + 1) as LaunchStep)}
                    >
                      Continue
                    </button>
                  ) : connected ? (
                    <button
                      className="btn-primary btn-lg"
                      disabled={isBusy || !!launchedMint}
                      onClick={handleLaunch}
                    >
                      {isBusy
                        ? launchStatus || "Launching..."
                        : launchedMint
                          ? "Launched!"
                          : "Launch on Mainnet"}
                    </button>
                  ) : (
                    <button className="btn-primary" disabled>
                      Connect Wallet to Launch
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* How It Works */}
            <section className="section" style={{ marginTop: "3rem" }}>
              <h2 className="section-title" style={{ fontSize: "1.25rem" }}>How the Alientor Launchpad Works</h2>
              <div className="features-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                <div className="feature-card">
                  <div className="feature-icon" style={{ background: "rgba(0, 230, 138, 0.06)", borderColor: "rgba(0, 230, 138, 0.15)" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="14" r="12" stroke="#00e68a" strokeWidth="1.5" opacity="0.3" />
                      <path d="M10 14 L14 18 L18 10" stroke="#00e68a" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3 className="feature-title">One-Click Mint</h3>
                  <p className="feature-desc">
                    Launch your token on pump.fun via the Alientor Protocol. Token creation, metadata,
                    and fee engine initialization in a single flow on Solana mainnet.
                  </p>
                </div>
                <div className="feature-card">
                  <div className="feature-icon" style={{ background: "rgba(155, 109, 255, 0.06)", borderColor: "rgba(155, 109, 255, 0.15)" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <rect x="4" y="4" width="20" height="20" rx="4" stroke="#9b6dff" strokeWidth="1.5" opacity="0.3" />
                      <path d="M9 14 L19 14 M14 9 L14 19" stroke="#9b6dff" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3 className="feature-title">Programmable Fees</h3>
                  <p className="feature-desc">
                    1% creator fee from every trade gets routed through the Alientor engine.
                    Choose your allocation: market making, buyback & burn, LP, or revenue.
                  </p>
                </div>
                <div className="feature-card">
                  <div className="feature-icon" style={{ background: "rgba(0, 200, 255, 0.06)", borderColor: "rgba(0, 200, 255, 0.15)" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <circle cx="14" cy="14" r="12" stroke="#00c8ff" strokeWidth="1.5" opacity="0.3" />
                      <path d="M14 6 L14 22 M8 12 L14 6 L20 12" stroke="#00c8ff" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3 className="feature-title">Vault Security</h3>
                  <p className="feature-desc">
                    Mint keypair secret keys stored server-side in a cryptographic vault.
                    One-time use, 30-minute expiry. Never exposed to the client.
                  </p>
                </div>
                <div className="feature-card">
                  <div className="feature-icon" style={{ background: "rgba(0, 230, 138, 0.06)", borderColor: "rgba(0, 230, 138, 0.15)" }}>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                      <ellipse cx="14" cy="12" rx="8" ry="9" stroke="#00e68a" strokeWidth="1.5" fill="none" opacity="0.3" />
                      <ellipse cx="11" cy="10" rx="2" ry="2.5" fill="#00e68a" opacity="0.5" />
                      <ellipse cx="17" cy="10" rx="2" ry="2.5" fill="#00e68a" opacity="0.5" />
                    </svg>
                  </div>
                  <h3 className="feature-title">Graduation Tracking</h3>
                  <p className="feature-desc">
                    Monitor bonding curve progress. When your token graduates to PumpSwap,
                    the fee engine adapts automatically for post-bond liquidity operations.
                  </p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ═══ TEK DASHBOARD TAB ═══ */}
        {activeTab === "dashboard" && (
          <TekDashboard publicKey={publicKey} connected={connected} />
        )}

        {/* ═══ LEADERBOARD TAB ═══ */}
        {activeTab === "leaderboard" && (
          <section className="leaderboard-section">
            <div className="leaderboard-header">
              <h2 className="leaderboard-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ marginRight: 8 }}>
                  <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="var(--cyan)" opacity="0.8" />
                </svg>
                Leaderboard
              </h2>
              <span className="badge-mainnet" style={{ fontSize: "0.7rem" }}>LIVE</span>
            </div>

            {loadingLeaderboard ? (
              <div className="leaderboard-loading">Loading leaderboard...</div>
            ) : leaderboard.length === 0 ? (
              <div className="leaderboard-empty">
                <span>No tokens yet. Launch the first one.</span>
              </div>
            ) : (
              <div className="leaderboard-table">
                <div className="leaderboard-table-head">
                  <span className="lb-col-rank">#</span>
                  <span className="lb-col-token">Token</span>
                  <span className="lb-col-mcap">Market Cap</span>
                  <span className="lb-col-progress">Progress</span>
                  <span className="lb-col-status">Status</span>
                  <span className="lb-col-links">Links</span>
                </div>
                {leaderboard.map((entry) => (
                  <div
                    key={entry.mint}
                    className={`leaderboard-row ${entry.pinned ? "leaderboard-row-pinned" : ""} ${entry.rank <= 3 ? "leaderboard-row-top" : ""}`}
                  >
                    <span className={`lb-col-rank lb-rank lb-rank-${entry.rank <= 3 ? entry.rank : "default"}`}>
                      {entry.rank}
                    </span>
                    <div className="lb-col-token lb-token-info">
                      <div
                        className="lb-token-avatar"
                        style={entry.image ? { backgroundImage: `url(${entry.image})`, backgroundSize: "cover" } : {}}
                      >
                        {!entry.image && (entry.symbol?.charAt(0) || "?")}
                      </div>
                      <div className="lb-token-text">
                        <span className="lb-token-name">
                          {entry.name}
                          {entry.pinned && <span className="lb-pin-badge">FEATURED</span>}
                        </span>
                        <span className="lb-token-symbol">${entry.symbol}</span>
                      </div>
                    </div>
                    <span className="lb-col-mcap lb-mcap">{formatMcap(entry.mcap)}</span>
                    <div className="lb-col-progress lb-progress-cell">
                      <div className="lb-progress-bar">
                        <div
                          className="lb-progress-fill"
                          style={{ width: `${Math.min(100, entry.progress || 0)}%` }}
                        />
                      </div>
                      <span className="lb-progress-pct">{(entry.progress || 0).toFixed(0)}%</span>
                    </div>
                    <span className={`lb-col-status lb-status ${entry.graduated ? "lb-graduated" : "lb-bonding"}`}>
                      {entry.graduated ? "Graduated" : "Bonding"}
                    </span>
                    <div className="lb-col-links lb-links">
                      <a
                        href={`https://pump.fun/coin/${entry.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lb-link text-cyan"
                      >
                        pump.fun
                      </a>
                      <a
                        href={`https://dexscreener.com/solana/${entry.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="lb-link text-purple"
                      >
                        DexScreener
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            <div className="leaderboard-warnings">
              <div className="leaderboard-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <path d="M12 2L2 22h20L12 2z" stroke="var(--yellow)" strokeWidth="2" fill="none" />
                  <path d="M12 10v4M12 18h.01" stroke="var(--yellow)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span>
                  <strong>Risk Warning:</strong> Tokens launched on pump.fun are highly speculative. Market cap and
                  volume data may be delayed. Always DYOR (Do Your Own Research) before trading. Past performance
                  does not guarantee future results.
                </span>
              </div>
              <div className="leaderboard-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <circle cx="12" cy="12" r="10" stroke="var(--cyan)" strokeWidth="2" fill="none" />
                  <path d="M12 8v4M12 16h.01" stroke="var(--cyan)" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <span>
                  <strong>Fee Disclosure:</strong> The Alientor Protocol collects 1% of creator fees for protocol
                  treasury operations including buyback, burns, and development. All transactions occur on
                  Solana mainnet and are irreversible.
                </span>
              </div>
              <div className="leaderboard-warning">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, marginTop: 2 }}>
                  <rect x="3" y="11" width="18" height="10" rx="2" stroke="var(--alien-green)" strokeWidth="2" fill="none" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="var(--alien-green)" strokeWidth="2" fill="none" />
                </svg>
                <span>
                  <strong>Not Financial Advice:</strong> The Alienator Protocol and its launchpad are experimental
                  software. Tokens have no intrinsic value. You may lose your entire investment. Only invest
                  what you can afford to lose.
                </span>
              </div>
            </div>
          </section>
        )}

        {/* ═══ MOLT BOT TAB ═══ */}
        {activeTab === "moltbot" && (
          <section className="molt-bot-coming-soon">
            <div className="molt-bot-gate">
              {/* Molt Bot visual */}
              <div className="molt-bot-icon-wrapper">
                <svg width="72" height="72" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.9 }}>
                  <circle cx="12" cy="12" r="10" stroke="var(--alien-green)" strokeWidth="1.5" fill="none" opacity="0.3" />
                  <circle cx="12" cy="12" r="6" stroke="var(--alien-green)" strokeWidth="1" fill="none" opacity="0.15" />
                  <circle cx="9" cy="10" r="1.5" fill="var(--alien-green)" opacity="0.8" />
                  <circle cx="15" cy="10" r="1.5" fill="var(--alien-green)" opacity="0.8" />
                  <path d="M9 14.5c.85.63 1.885 1 3 1s2.15-.37 3-1" stroke="var(--alien-green)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <path d="M12 2v4" stroke="var(--cyan)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
                  <path d="M4 8l2.5 1.5" stroke="var(--cyan)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                  <path d="M20 8l-2.5 1.5" stroke="var(--cyan)" strokeWidth="1" strokeLinecap="round" opacity="0.4" />
                </svg>
                <div className="molt-bot-pulse-ring" />
                <div className="molt-bot-pulse-ring molt-bot-pulse-ring-2" />
              </div>

              <h2 style={{ color: "var(--alien-green)", marginBottom: "0.5rem", fontSize: "1.5rem" }}>
                MOLT BOT
              </h2>
              <p className="text-muted" style={{ fontSize: "1rem", marginBottom: "1.5rem", maxWidth: 480 }}>
                Autonomous Bonding Curve Management Agent
              </p>

              {/* Coming Soon badge */}
              <div className="molt-bot-badge">
                <span className="molt-bot-badge-dot" />
                COMING SOON
              </div>

              {/* Feature preview cards */}
              <div className="molt-bot-features">
                <div className="molt-bot-feature">
                  <div className="molt-bot-feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="1.5">
                      <path d="M3 3v18h18" strokeLinecap="round" />
                      <path d="M7 16l4-8 4 4 5-10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h4>Multi-Curve Tracking</h4>
                  <p>Monitor up to 50 bonding curves simultaneously with real-time health scoring and phase detection.</p>
                </div>
                <div className="molt-bot-feature">
                  <div className="molt-bot-feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h4>Lifecycle Phases</h4>
                  <p>Automatic phase detection: Pre-Bond, Bonding, Graduating, Graduated, and Dormant with per-phase strategies.</p>
                </div>
                <div className="molt-bot-feature">
                  <div className="molt-bot-feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="1.5">
                      <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <h4>Health Scoring</h4>
                  <p>7-factor health analysis: volume, stability, progress, buy pressure, holders, liquidity depth, and age.</p>
                </div>
                <div className="molt-bot-feature">
                  <div className="molt-bot-feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" strokeWidth="1.5">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" strokeLinecap="round" />
                      <path d="M7 8h2M7 11h4" strokeLinecap="round" opacity="0.6" />
                    </svg>
                  </div>
                  <h4>Telegram Integration</h4>
                  <p>Full command interface via your Telegram bot. Track, analyze, simulate trades, and get alerts on the go.</p>
                </div>
              </div>

              {/* Architecture preview */}
              <div className="molt-bot-arch">
                <h4 className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.8rem", letterSpacing: "0.1em" }}>
                  ARCHITECTURE
                </h4>
                <div className="molt-bot-arch-flow">
                  <div className="molt-bot-arch-node">
                    <span className="molt-bot-arch-label">Telegram Bot</span>
                    <span className="molt-bot-arch-sub">Commands & Alerts</span>
                  </div>
                  <div className="molt-bot-arch-arrow">
                    <svg width="24" height="12" viewBox="0 0 24 12">
                      <path d="M0 6h20M16 2l4 4-4 4" stroke="var(--alien-green)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="molt-bot-arch-node molt-bot-arch-node-active">
                    <span className="molt-bot-arch-label">Molt Bot Agent</span>
                    <span className="molt-bot-arch-sub">Curve Manager</span>
                  </div>
                  <div className="molt-bot-arch-arrow">
                    <svg width="24" height="12" viewBox="0 0 24 12">
                      <path d="M0 6h20M16 2l4 4-4 4" stroke="var(--alien-green)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="molt-bot-arch-node">
                    <span className="molt-bot-arch-label">Alientor Engine</span>
                    <span className="molt-bot-arch-sub">Fee Routing</span>
                  </div>
                </div>
                <div className="molt-bot-arch-flow" style={{ marginTop: "0.75rem" }}>
                  <div className="molt-bot-arch-node molt-bot-arch-node-dim">
                    <span className="molt-bot-arch-label">Pump.fun</span>
                    <span className="molt-bot-arch-sub">Bonding Curves</span>
                  </div>
                  <div className="molt-bot-arch-arrow">
                    <svg width="24" height="12" viewBox="0 0 24 12">
                      <path d="M0 6h20M16 2l4 4-4 4" stroke="var(--cyan)" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5" />
                    </svg>
                  </div>
                  <div className="molt-bot-arch-node molt-bot-arch-node-dim">
                    <span className="molt-bot-arch-label">PumpSwap</span>
                    <span className="molt-bot-arch-sub">Post-Graduation</span>
                  </div>
                  <div className="molt-bot-arch-arrow">
                    <svg width="24" height="12" viewBox="0 0 24 12">
                      <path d="M0 6h20M16 2l4 4-4 4" stroke="var(--cyan)" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.5" />
                    </svg>
                  </div>
                  <div className="molt-bot-arch-node molt-bot-arch-node-dim">
                    <span className="molt-bot-arch-label">Percolator</span>
                    <span className="molt-bot-arch-sub">Derivatives</span>
                  </div>
                </div>
              </div>

              <div className="molt-bot-footer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                </svg>
                <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                  The Molt Bot agent is currently in development. It will connect your existing Telegram bot
                  to the Alientor bonding curve management system for autonomous multi-curve operations.
                </span>
              </div>
            </div>
          </section>
        )}

        {/* ═══ MY TOKENS TAB ═══ */}
        {activeTab === "mytokens" && (
          <section>
            <h2 className="section-title" style={{ fontSize: "1.25rem" }}>My Launched Tokens</h2>
            {!connected ? (
              <div className="tek-dash-empty">
                <div className="tek-dash-empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <rect x="3" y="11" width="18" height="10" rx="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>Connect Wallet</h3>
                <p className="text-muted" style={{ fontSize: "0.85rem" }}>
                  Connect your wallet to view your launched tokens.
                </p>
              </div>
            ) : loadingTokens ? (
              <p className="text-muted">Loading...</p>
            ) : myTokens.length === 0 ? (
              <div className="tek-dash-empty">
                <div className="tek-dash-empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                  </svg>
                </div>
                <h3 style={{ color: "var(--text-secondary)", marginBottom: "0.5rem" }}>No Tokens Yet</h3>
                <p className="text-muted" style={{ fontSize: "0.85rem" }}>
                  Launch your first token to see it here.
                </p>
              </div>
            ) : (
              <div className="launchpad-tokens-grid">
                {myTokens.map((token) => (
                  <div key={token.mint} className="launchpad-token-card">
                    <div className="launchpad-token-header">
                      <span className="launchpad-token-symbol">${token.symbol || "???"}</span>
                      <span className="badge-mainnet" style={{ fontSize: "0.65rem", padding: "2px 8px" }}>MAINNET</span>
                    </div>
                    <div className="launchpad-token-name">{token.name || token.mint.slice(0, 12)}</div>
                    <div className="launchpad-token-mint" title={token.mint}>
                      {token.mint.slice(0, 8)}...{token.mint.slice(-8)}
                    </div>
                    <div className="launchpad-token-actions">
                      <a
                        href={`https://pump.fun/coin/${token.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan"
                        style={{ fontSize: "0.8rem" }}
                      >
                        pump.fun
                      </a>
                      <a
                        href={`https://dexscreener.com/solana/${token.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-purple"
                        style={{ fontSize: "0.8rem" }}
                      >
                        DexScreener
                      </a>
                      <a
                        href={`https://solscan.io/token/${token.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted"
                        style={{ fontSize: "0.8rem" }}
                      >
                        Solscan
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
