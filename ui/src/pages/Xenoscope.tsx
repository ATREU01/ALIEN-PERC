/**
 * ═══════════════════════════════════════════════════════════════════
 *  XENOSCOPE — Alientor Signal Intelligence Array
 *  Real-time blockchain monitoring, scanning, analytics & trading
 *  intelligence on Solana MAINNET via Pump.fun WebSocket stream.
 *
 *  Sub-tabs: Overview | Scanner | Live Feed | Analytics | Trades
 *  Network: Solana MAINNET (pump.fun / PumpSwap)
 * ═══════════════════════════════════════════════════════════════════
 */
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { usePumpSocket, PumpEvent } from "../hooks/usePumpSocket";
import { useSolPrice, formatCompactUSD, formatUSD } from "../hooks/useSolPrice";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

// ─── Types ────────────────────────────────────────────────────────
type SubTab = "overview" | "scanner" | "feed" | "analytics" | "trades";
type ScanFilter = "alpha" | "risk" | "safe";
type FeedFilter = "all" | "creates" | "trades" | "migrations";
type SortField = "time" | "amount" | "token";
type SortOrder = "asc" | "desc";

// ─── Helpers ──────────────────────────────────────────────────────
function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function shortAddr(addr?: string): string {
  if (!addr || addr.length < 8) return addr || "---";
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

// ─── Token Avatar ─────────────────────────────────────────────────
// Uses SERVER-SIDE proxy for metadata to avoid CORS / Mixed Content.
// Client never fetches from random metadata hosts directly.
const _imgCache = new Map<string, string | null>(); // uri → imageUrl or null (failed)
const _inflight = new Map<string, Promise<string | null>>(); // dedup concurrent requests

function resolveTokenImage(uri: string): Promise<string | null> {
  // Check cache
  if (_imgCache.has(uri)) return Promise.resolve(_imgCache.get(uri)!);
  // Dedup inflight
  if (_inflight.has(uri)) return _inflight.get(uri)!;

  const p = (async (): Promise<string | null> => {
    try {
      // Only direct HTTPS images bypass the proxy (safe)
      if (/^https:\/\/.+\.(jpeg|jpg|gif|png|webp|svg)(\?.*)?$/i.test(uri)) {
        _imgCache.set(uri, uri);
        return uri;
      }
      // Use our server-side proxy — no CORS, no Mixed Content
      const res = await fetch(`/api/xenoscope/metadata?uri=${encodeURIComponent(uri)}`);
      if (!res.ok) { _imgCache.set(uri, null); return null; }
      const data = await res.json();
      const img = data?.image || null;
      // Only use HTTPS images
      if (img && img.startsWith("https://")) {
        _imgCache.set(uri, img);
        return img;
      }
      // Try cf-ipfs for ipfs:// images
      if (img && img.startsWith("ipfs://")) {
        const httpsImg = img.replace("ipfs://", "https://cf-ipfs.com/ipfs/");
        _imgCache.set(uri, httpsImg);
        return httpsImg;
      }
      _imgCache.set(uri, null);
      return null;
    } catch {
      _imgCache.set(uri, null);
      return null;
    } finally {
      _inflight.delete(uri);
    }
  })();

  _inflight.set(uri, p);
  return p;
}

function TokenAvatar({ uri, alt, size = 40 }: { uri?: string; alt: string; size?: number }) {
  const [imageUrl, setImageUrl] = useState<string | null>(uri ? (_imgCache.get(uri) ?? null) : null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    // If already cached (hit or miss), use it
    if (_imgCache.has(uri)) {
      if (!cancelled) setImageUrl(_imgCache.get(uri)!);
      return;
    }
    resolveTokenImage(uri).then((img) => {
      if (!cancelled) setImageUrl(img);
    });
    return () => { cancelled = true; };
  }, [uri]);

  if (error || !uri || !imageUrl) {
    return (
      <div className="xeno-avatar-fallback" style={{ width: size, height: size }}>
        <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      </div>
    );
  }

  return (
    <div className="xeno-avatar" style={{ width: size, height: size }}>
      <img src={imageUrl} alt={alt} onError={() => { setError(true); _imgCache.set(uri!, null); }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export function Xenoscope() {
  const [activeTab, setActiveTab] = useState<SubTab>("overview");
  const { isConnected, events } = usePumpSocket();
  const solPrice = useSolPrice();

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "scanner", label: "Scanner" },
    { key: "feed", label: "Live Feed" },
    { key: "analytics", label: "Analytics" },
    { key: "trades", label: "Trades" },
  ];

  return (
    <div className="page xeno-page">
      {/* ── Page Header ── */}
      <div className="xeno-header">
        <div className="xeno-header-left">
          <div className="xeno-logo-block">
            <div className="xeno-logo-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" strokeDasharray="2 2" />
                <circle cx="12" cy="12" r="2" fill="var(--purple)" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
              </svg>
            </div>
            <div>
              <h1 className="xeno-title">XENOSCOPE</h1>
              <p className="xeno-subtitle">Alientor Signal Intelligence Array</p>
            </div>
          </div>
        </div>
        <div className="xeno-header-right">
          <div className={`xeno-connection-badge ${isConnected ? "online" : "offline"}`}>
            <span className="xeno-connection-dot" />
            <span>{isConnected ? "MAINNET LIVE" : "RECONNECTING"}</span>
          </div>
          <div className="badge-mainnet">SOLANA MAINNET</div>
        </div>
      </div>

      {/* ── Sub-tab Navigation ── */}
      <div className="xeno-tabs">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`xeno-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="xeno-content">
        {activeTab === "overview" && (
          <XenoOverview events={events} solPrice={solPrice} isConnected={isConnected} />
        )}
        {activeTab === "scanner" && (
          <XenoScanner events={events} solPrice={solPrice} />
        )}
        {activeTab === "feed" && (
          <XenoFeed events={events} solPrice={solPrice} isConnected={isConnected} />
        )}
        {activeTab === "analytics" && (
          <XenoAnalytics events={events} solPrice={solPrice} />
        )}
        {activeTab === "trades" && (
          <XenoTrades events={events} solPrice={solPrice} />
        )}
      </div>

      {/* ── Feature Cards ── */}
      <div className="xeno-features-section">
        <h2 className="section-title">How Xenoscope Works</h2>
        <div className="xeno-features-grid">
          <div className="xeno-feature-card">
            <div className="xeno-feature-icon" style={{ background: "rgba(155, 109, 255, 0.1)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <h3>Real-Time Signal Feed</h3>
            <p>Direct WebSocket connection to Pump.fun on Solana mainnet. Token creations, trades, and migrations stream in real-time with zero delay.</p>
          </div>
          <div className="xeno-feature-card">
            <div className="xeno-feature-icon" style={{ background: "rgba(0, 200, 255, 0.1)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h3>Alpha Scanner</h3>
            <p>Three intelligence strategies — Alpha Radar (momentum), New Launches (freshest tokens), and Early Alpha (near graduation). Filter signals, not noise.</p>
          </div>
          <div className="xeno-feature-card">
            <div className="xeno-feature-icon" style={{ background: "rgba(0, 214, 143, 0.1)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6" />
              </svg>
            </div>
            <h3>Spectral Analytics</h3>
            <p>Volume velocity charts, transaction type distribution, buy/sell ratio analysis, and top-token leaderboards. All computed from live data.</p>
          </div>
          <div className="xeno-feature-card">
            <div className="xeno-feature-icon" style={{ background: "rgba(239, 68, 102, 0.1)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
                <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
            </div>
            <h3>Trade Intercepts</h3>
            <p>Every buy and sell across the network — sortable, searchable, with direct links to Solscan for on-chain verification. Copy any CA instantly.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SUB-TAB: OVERVIEW (Dashboard)
// ═══════════════════════════════════════════════════════════════════
function XenoOverview({
  events,
  solPrice,
  isConnected,
}: {
  events: PumpEvent[];
  solPrice: number;
  isConnected: boolean;
}) {
  const totalVolumeSol = events.reduce((acc, e) => acc + (e.solAmount || 0), 0);
  const activeTraders = new Set(events.map((e) => e.traderPublicKey)).size;
  const tokensCreated = events.filter((e) => e.txType === "create").length;
  const migrations = events.filter((e) => e.txType === "migrate");

  // Volume chart data (time-bucketed)
  const chartData = useMemo(() => {
    const buckets: { time: string; value: number }[] = [];
    const now = Date.now();
    for (let i = 6; i >= 0; i--) {
      const cutoff = now - i * 60_000;
      const prev = now - (i + 1) * 60_000;
      const vol = events
        .filter((e) => e.timestamp >= prev && e.timestamp < cutoff)
        .reduce((acc, e) => acc + (e.solAmount || 0), 0);
      buckets.push({ time: `${i}m`, value: vol * solPrice });
    }
    return buckets;
  }, [events, solPrice]);

  return (
    <div className="xeno-overview">
      {/* THE POINT */}
      <div className="xeno-tab-explainer">
        <h3>Mission Control</h3>
        <p>Your real-time dashboard — session volume, active traders, new token launches, and network status at a glance. The volume chart shows USD flow over the last 7 minutes, and the sidebar streams every event as it happens on Pump.fun.</p>
      </div>

      {/* Stats Row */}
      <div className="xeno-stats-row">
        <StatCard
          title="Session Volume"
          value={formatCompactUSD(totalVolumeSol * solPrice)}
          sub={`${totalVolumeSol.toFixed(2)} SOL`}
          color="var(--alien-green)"
        />
        <StatCard
          title="Active Traders"
          value={activeTraders.toString()}
          sub="Unique wallets"
          color="var(--cyan)"
        />
        <StatCard
          title="Tokens Created"
          value={tokensCreated.toString()}
          sub="New launches"
          color="var(--purple)"
        />
        <StatCard
          title="Network Status"
          value={isConnected ? "ONLINE" : "OFFLINE"}
          sub={isConnected ? "Pump.fun WS stable" : "Reconnecting..."}
          color={isConnected ? "var(--green)" : "var(--red)"}
        />
      </div>

      {/* Main Grid */}
      <div className="xeno-overview-grid">
        {/* Chart */}
        <div className="xeno-chart-panel glass-card">
          <div className="xeno-panel-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span>Volume Velocity</span>
          </div>
          <div className="xeno-chart-container">
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="xenoVolGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--alien-green)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--alien-green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-card)",
                    borderColor: "var(--border)",
                    borderRadius: "12px",
                    fontFamily: "var(--font-mono)",
                  }}
                  itemStyle={{ color: "var(--alien-green)", fontWeight: "bold" }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="var(--alien-green)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#xenoVolGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Feed Sidebar */}
        <div className="xeno-feed-sidebar glass-card">
          <div className="xeno-panel-header">
            <span className={`xeno-live-dot ${isConnected ? "on" : ""}`} />
            <span>Live Feed</span>
          </div>
          <div className="xeno-feed-list">
            {events.length > 0 ? (
              events.slice(0, 30).map((e, i) => (
                <FeedItem key={`${e.signature}-${i}`} event={e} solPrice={solPrice} />
              ))
            ) : (
              <div className="xeno-empty">
                <div className="xeno-spinner" />
                <span>Connecting to Pump.fun...</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Migrations Table */}
      <div className="glass-card xeno-migrations-panel">
        <div className="xeno-panel-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2">
            <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
          </svg>
          <span>Recent Migrations</span>
        </div>
        <div className="xeno-table-wrap">
          <table className="xeno-table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Market Cap</th>
                <th>Liquidity</th>
                <th>Time</th>
                <th style={{ textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {migrations.length > 0 ? (
                migrations.map((m, i) => (
                  <tr key={i}>
                    <td>
                      <div className="xeno-token-cell">
                        <span className="xeno-token-name">{m.name || shortAddr(m.mint)}</span>
                        <span className="xeno-token-addr">{shortAddr(m.mint)}</span>
                      </div>
                    </td>
                    <td className="mono">
                      {m.marketCapSol ? formatCompactUSD(m.marketCapSol * solPrice) : "---"}
                    </td>
                    <td className="mono" style={{ color: "var(--alien-green)" }}>
                      {m.vSolInBondingCurve ? formatCompactUSD(m.vSolInBondingCurve * solPrice) : "---"}
                    </td>
                    <td className="muted">{timeAgo(m.timestamp)}</td>
                    <td style={{ textAlign: "right" }}>
                      <a
                        href={`https://pump.fun/${m.mint}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="xeno-link-btn"
                      >
                        View
                      </a>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="xeno-table-empty">Waiting for migration events...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SUB-TAB: SCANNER
// ═══════════════════════════════════════════════════════════════════
function XenoScanner({
  events,
  solPrice,
}: {
  events: PumpEvent[];
  solPrice: number;
}) {
  const [source, setSource] = useState<"pump" | "bags">("pump");
  const [activeFilter, setActiveFilter] = useState<ScanFilter>("alpha");
  const [searchQuery, setSearchQuery] = useState("");

  const MOCK_BAGS = [
    { name: "PEPE 2.0", symbol: "PEPE2", price: "$0.000004", mcap: "$4.2M", time: "2m ago", uri: "" },
    { name: "WIF HAT", symbol: "WIF", price: "$2.45", mcap: "$2.4B", time: "5m ago", uri: "" },
    { name: "BONK", symbol: "BONK", price: "$0.000023", mcap: "$1.5B", time: "8m ago", uri: "" },
    { name: "POPCAT", symbol: "POPCAT", price: "$0.45", mcap: "$450M", time: "12m ago", uri: "" },
  ];

  const scannedTokens = useMemo(() => {
    let filtered: PumpEvent[] = [];

    switch (activeFilter) {
      case "alpha":
        // Alpha Radar: any buy trade (real buy activity = signal)
        filtered = events.filter(
          (e) =>
            (e.txType === "trade" && e.isBuy) ||
            (e.txType === "migrate")
        );
        break;
      case "risk":
        // High Risk: brand-new launches and very early tokens
        filtered = events.filter(
          (e) =>
            e.txType === "create" ||
            (e.txType === "trade" && e.isBuy && (e.solAmount || 0) < 0.5)
        );
        break;
      case "safe":
        // Early Alpha: tokens with bonding curve activity (approaching graduation)
        // or larger buy events (established momentum)
        filtered = events.filter(
          (e) =>
            (e.vSolInBondingCurve && e.vSolInBondingCurve > 0) ||
            (e.txType === "trade" && e.isBuy && (e.solAmount || 0) > 0.5) ||
            e.txType === "migrate"
        );
        break;
    }

    // Deduplicate by mint
    const unique = Array.from(
      new Map(filtered.map((item) => [item.mint || item.signature, item])).values()
    );

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return unique
        .filter(
          (t) =>
            t.name?.toLowerCase().includes(q) ||
            t.symbol?.toLowerCase().includes(q) ||
            t.mint?.toLowerCase().includes(q)
        )
        .slice(0, 20);
    }

    return unique.slice(0, 20);
  }, [events, activeFilter, searchQuery]);

  const filterLabel = (f: ScanFilter) =>
    f === "alpha" ? "Alpha Radar" : f === "risk" ? "New Launches" : "Early Alpha";

  const filterColor = (f: ScanFilter) =>
    f === "alpha" ? "var(--cyan)" : f === "risk" ? "var(--red)" : "var(--green)";

  return (
    <div className="xeno-scanner">
      {/* THE POINT */}
      <div className="xeno-tab-explainer">
        <h3>Find Signals in the Noise</h3>
        <p>Thousands of tokens launch every hour on Pump.fun. The Scanner filters them into three strategies: <strong>Alpha Radar</strong> finds tokens with real buy activity, <strong>New Launches</strong> catches brand-new tokens before anyone else, and <strong>Early Alpha</strong> highlights tokens approaching bonding curve graduation. Copy any CA with one click.</p>
      </div>

      {/* Header */}
      <div className="xeno-scanner-header">
        <div>
          <h2 className="xeno-section-title">Alpha Scanner</h2>
          <p className="xeno-section-sub">Real-time opportunity detector</p>
        </div>
        <div className="xeno-source-toggle">
          <button
            className={`xeno-toggle-btn ${source === "pump" ? "active" : ""}`}
            onClick={() => setSource("pump")}
          >
            Pump.fun
          </button>
          <button
            className={`xeno-toggle-btn ${source === "bags" ? "active" : ""}`}
            onClick={() => setSource("bags")}
          >
            Bags
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="xeno-filter-bar">
        <span className="xeno-filter-label">Strategy:</span>
        {(["alpha", "risk", "safe"] as ScanFilter[]).map((f) => (
          <button
            key={f}
            className={`xeno-filter-chip ${activeFilter === f ? "active" : ""}`}
            style={activeFilter === f ? { borderColor: filterColor(f), color: filterColor(f) } : {}}
            onClick={() => setActiveFilter(f)}
          >
            {filterLabel(f)}
          </button>
        ))}
        <div className="xeno-search-input">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search token or CA..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Token Cards Grid */}
      <div className="xeno-token-grid">
        {source === "pump" ? (
          scannedTokens.length > 0 ? (
            scannedTokens.map((token, i) => (
              <ScannerCard
                key={`${token.signature}-${i}`}
                name={token.name || "Unknown Token"}
                symbol={token.symbol || "???"}
                price={token.solAmount ? formatCompactUSD(token.solAmount * solPrice) : "---"}
                mcap={token.marketCapSol ? formatCompactUSD(token.marketCapSol * solPrice) : "---"}
                time={timeAgo(token.timestamp)}
                type={activeFilter === "risk" ? "New Launch" : activeFilter === "safe" ? "Early Alpha" : "Alpha"}
                uri={token.uri}
                isHot={token.txType === "trade" && (token.solAmount || 0) > 5}
                mint={token.mint}
              />
            ))
          ) : (
            <div className="xeno-empty-grid">
              <div className="xeno-spinner" />
              <p>Scanning for {filterLabel(activeFilter).toLowerCase()} opportunities...</p>
            </div>
          )
        ) : (
          MOCK_BAGS.map((token, i) => (
            <ScannerCard
              key={i}
              name={token.name}
              symbol={token.symbol}
              price={token.price}
              mcap={token.mcap}
              time={token.time}
              type="Trending"
              uri={token.uri}
              isHot={i < 2}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ScannerCard({
  name,
  symbol,
  price,
  mcap,
  time,
  type,
  uri,
  isHot,
  mint,
}: {
  name: string;
  symbol: string;
  price: string;
  mcap: string;
  time: string;
  type: string;
  uri?: string;
  isHot?: boolean;
  mint?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyCA = () => {
    if (mint) {
      navigator.clipboard.writeText(mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const typeClass =
    type === "New Launch"
      ? "xeno-badge-trending"
      : type === "Alpha"
        ? "xeno-badge-alpha"
        : type === "Early Alpha"
          ? "xeno-badge-alpha"
          : "xeno-badge-trending";

  const pumpUrl = mint ? `https://pump.fun/${mint}` : undefined;

  return (
    <a
      className={`xeno-scanner-card xeno-clickable-row ${isHot ? "hot" : ""}`}
      href={pumpUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { if (!pumpUrl) e.preventDefault(); }}
    >
      <div className="xeno-scanner-card-top">
        <div className="xeno-scanner-card-info">
          <TokenAvatar uri={uri} alt={name} size={44} />
          <div>
            <div className="xeno-scanner-card-name">{name}</div>
            <span className="xeno-scanner-card-symbol">{symbol}</span>
          </div>
        </div>
        <span className={`xeno-type-badge ${typeClass}`}>{type}</span>
      </div>
      <div className="xeno-scanner-card-metrics">
        <div className="xeno-metric-box">
          <span className="xeno-metric-label">Value</span>
          <span className="xeno-metric-value">{price}</span>
        </div>
        <div className="xeno-metric-box">
          <span className="xeno-metric-label">MCap</span>
          <span className="xeno-metric-value">{mcap}</span>
        </div>
      </div>
      <div className="xeno-scanner-card-bottom">
        <span className="xeno-scanner-card-time">{time}</span>
        {mint && (
          <button className="xeno-copy-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyCA(); }}>
            {copied ? "Copied!" : "Copy CA"}
          </button>
        )}
      </div>
      {isHot && <div className="xeno-hot-bar" />}
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SUB-TAB: LIVE FEED
// ═══════════════════════════════════════════════════════════════════
function XenoFeed({
  events,
  solPrice,
  isConnected,
}: {
  events: PumpEvent[];
  solPrice: number;
  isConnected: boolean;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  const [isPaused, setIsPaused] = useState(false);

  const filteredEvents = events.filter((e) => {
    if (filter === "all") return true;
    if (filter === "creates") return e.txType === "create";
    if (filter === "trades") return e.txType === "trade";
    if (filter === "migrations") return e.txType === "migrate";
    return true;
  });

  const displayEvents = isPaused ? filteredEvents.slice(0, 50) : filteredEvents;

  const counts = useMemo(
    () => ({
      creates: events.filter((e) => e.txType === "create").length,
      buys: events.filter((e) => e.txType === "trade" && e.isBuy).length,
      sells: events.filter((e) => e.txType === "trade" && !e.isBuy).length,
      migrations: events.filter((e) => e.txType === "migrate").length,
    }),
    [events]
  );

  return (
    <div className="xeno-feed-page">
      {/* THE POINT */}
      <div className="xeno-tab-explainer">
        <h3>The Raw Firehose</h3>
        <p>Every single event on Pump.fun streams here in real-time — new token creations, buy/sell trades, and bonding curve migrations. Filter by event type, pause the feed to inspect something, and use the stats bar to gauge current market tempo. This is the unfiltered signal.</p>
      </div>

      {/* Header */}
      <div className="xeno-feed-header">
        <div>
          <h2 className="xeno-section-title">
            <span className={`xeno-live-dot ${isConnected ? "on" : ""}`} />
            Live Feed
          </h2>
          <p className="xeno-section-sub">Real-time Pump.fun activity stream</p>
        </div>
        <div className="xeno-feed-controls">
          <button
            className={`xeno-control-btn ${isPaused ? "active" : ""}`}
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--alien-green)"><polygon points="5 3 19 12 5 21" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="xeno-filter-bar">
        <span className="xeno-filter-label">Filter:</span>
        {([
          { key: "all", label: "All Events" },
          { key: "creates", label: "New Tokens" },
          { key: "trades", label: "Trades" },
          { key: "migrations", label: "Migrations" },
        ] as { key: FeedFilter; label: string }[]).map((f) => (
          <button
            key={f.key}
            className={`xeno-filter-chip ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <span className="xeno-filter-count">{filteredEvents.length} events</span>
      </div>

      {/* Stats Bar */}
      <div className="xeno-feed-stats">
        <div className="xeno-feed-stat">
          <span className="xeno-feed-stat-label">Creates</span>
          <span className="xeno-feed-stat-value">{counts.creates}</span>
        </div>
        <div className="xeno-feed-stat">
          <span className="xeno-feed-stat-label">Buys</span>
          <span className="xeno-feed-stat-value" style={{ color: "var(--green)" }}>{counts.buys}</span>
        </div>
        <div className="xeno-feed-stat">
          <span className="xeno-feed-stat-label">Sells</span>
          <span className="xeno-feed-stat-value" style={{ color: "var(--red)" }}>{counts.sells}</span>
        </div>
        <div className="xeno-feed-stat">
          <span className="xeno-feed-stat-label">Migrations</span>
          <span className="xeno-feed-stat-value" style={{ color: "var(--purple)" }}>{counts.migrations}</span>
        </div>
      </div>

      {/* Feed List */}
      <div className="glass-card xeno-feed-list-panel">
        {displayEvents.length > 0 ? (
          displayEvents.map((event, i) => (
            <FeedRow key={`${event.signature}-${i}`} event={event} solPrice={solPrice} />
          ))
        ) : (
          <div className="xeno-empty">
            <div className="xeno-spinner" />
            <span>Waiting for events...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FeedRow({ event, solPrice }: { event: PumpEvent; solPrice: number }) {
  const getTypeInfo = () => {
    if (event.txType === "create") return { label: "NEW", cls: "xeno-badge-alpha" };
    if (event.txType === "migrate") return { label: "MIGRATE", cls: "xeno-badge-trending" };
    if (event.txType === "trade" && event.isBuy) return { label: "BUY", cls: "xeno-badge-safe" };
    return { label: "SELL", cls: "xeno-badge-risk" };
  };
  const { label, cls } = getTypeInfo();

  const pumpUrl = event.mint ? `https://pump.fun/${event.mint}` : undefined;

  return (
    <a
      className="xeno-feed-row xeno-clickable-row"
      href={pumpUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { if (!pumpUrl) e.preventDefault(); }}
    >
      <TokenAvatar uri={event.uri} alt={event.name || "Token"} size={36} />
      <div className="xeno-feed-row-info">
        <span className="xeno-feed-row-name">
          {event.name || event.symbol || shortAddr(event.mint)}
        </span>
        <span className="xeno-feed-row-addr">{shortAddr(event.mint)}</span>
      </div>
      <span className={`xeno-type-badge ${cls}`}>{label}</span>
      {event.solAmount ? (
        <div className="xeno-feed-row-amount">
          <span>{formatCompactUSD(event.solAmount * solPrice)}</span>
          <span className="muted">{event.solAmount.toFixed(2)} SOL</span>
        </div>
      ) : (
        <div className="xeno-feed-row-amount" />
      )}
      <span className="xeno-feed-row-time">{timeAgo(event.timestamp)}</span>
    </a>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SUB-TAB: ANALYTICS
// ═══════════════════════════════════════════════════════════════════
function XenoAnalytics({
  events,
  solPrice,
}: {
  events: PumpEvent[];
  solPrice: number;
}) {
  const totalVolume = events.reduce((acc, e) => acc + (e.solAmount || 0), 0);
  const buyVolume = events.filter((e) => e.isBuy).reduce((acc, e) => acc + (e.solAmount || 0), 0);
  const sellVolume = events
    .filter((e) => !e.isBuy && e.txType === "trade")
    .reduce((acc, e) => acc + (e.solAmount || 0), 0);
  const uniqueTraders = new Set(events.map((e) => e.traderPublicKey)).size;
  const uniqueTokens = new Set(events.map((e) => e.mint)).size;
  const creates = events.filter((e) => e.txType === "create").length;
  const migrations = events.filter((e) => e.txType === "migrate").length;

  // Volume over time
  const volumeData = useMemo(() => {
    const now = Date.now();
    return [
      { time: "5m ago", volume: events.filter((e) => e.timestamp >= now - 300_000 && e.timestamp < now - 240_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
      { time: "4m ago", volume: events.filter((e) => e.timestamp >= now - 240_000 && e.timestamp < now - 180_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
      { time: "3m ago", volume: events.filter((e) => e.timestamp >= now - 180_000 && e.timestamp < now - 120_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
      { time: "2m ago", volume: events.filter((e) => e.timestamp >= now - 120_000 && e.timestamp < now - 60_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
      { time: "1m ago", volume: events.filter((e) => e.timestamp >= now - 60_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
      { time: "Now", volume: events.filter((e) => e.timestamp >= now - 30_000).reduce((a, e) => a + (e.solAmount || 0), 0) * solPrice },
    ];
  }, [events, solPrice]);

  // Tx distribution
  const txTypeData = [
    { name: "Buys", value: events.filter((e) => e.isBuy).length, color: "#00d68f" },
    { name: "Sells", value: events.filter((e) => !e.isBuy && e.txType === "trade").length, color: "#ef4466" },
    { name: "Creates", value: creates, color: "#00c8ff" },
    { name: "Migrations", value: migrations, color: "#9b6dff" },
  ];

  // Top tokens
  const topTokens = useMemo(() => {
    const vols: Record<string, { volume: number; name: string }> = {};
    events.forEach((e) => {
      if (e.mint && e.solAmount) {
        if (!vols[e.mint]) vols[e.mint] = { volume: 0, name: e.name || e.symbol || e.mint.slice(0, 6) };
        vols[e.mint].volume += e.solAmount;
      }
    });
    return Object.entries(vols)
      .map(([mint, data]) => ({ mint, ...data }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 5);
  }, [events]);

  return (
    <div className="xeno-analytics">
      {/* THE POINT */}
      <div className="xeno-tab-explainer">
        <h3>Read the Market</h3>
        <p>Understand what's actually happening — volume trends over time, buy vs. sell pressure, transaction type breakdown, and the top tokens by volume this session. If buys are outpacing sells, the market is heating up. Use this to time your entries and exits.</p>
      </div>

      <h2 className="xeno-section-title">Analytics</h2>
      <p className="xeno-section-sub">Market insights and statistics</p>

      {/* Metrics */}
      <div className="xeno-metrics-row">
        <MetricCard title="Total Volume" value={formatCompactUSD(totalVolume * solPrice)} sub={`${totalVolume.toFixed(2)} SOL`} color="var(--alien-green)" />
        <MetricCard
          title="Buy/Sell Ratio"
          value={sellVolume > 0 ? (buyVolume / sellVolume).toFixed(2) : "∞"}
          sub={buyVolume > sellVolume ? "Bullish" : "Bearish"}
          color={buyVolume > sellVolume ? "var(--green)" : "var(--red)"}
        />
        <MetricCard title="Active Traders" value={uniqueTraders.toString()} sub="Unique wallets" color="var(--cyan)" />
        <MetricCard title="Tokens Tracked" value={uniqueTokens.toString()} sub={`${creates} new launches`} color="var(--purple)" />
      </div>

      {/* Charts Row */}
      <div className="xeno-charts-row">
        {/* Volume Chart */}
        <div className="glass-card xeno-chart-card">
          <div className="xeno-panel-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--alien-green)" strokeWidth="2">
              <path d="M18 20V10M12 20V4M6 20v-6" />
            </svg>
            <span>Volume Over Time</span>
          </div>
          <div className="xeno-chart-container">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={volumeData}>
                <defs>
                  <linearGradient id="xenoAnalVol" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--alien-green)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--alien-green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                <Tooltip contentStyle={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border)", borderRadius: "12px" }} />
                <Area type="monotone" dataKey="volume" stroke="var(--alien-green)" strokeWidth={2} fill="url(#xenoAnalVol)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart */}
        <div className="glass-card xeno-chart-card">
          <div className="xeno-panel-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" strokeWidth="2">
              <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
              <path d="M22 12A10 10 0 0 0 12 2v10z" />
            </svg>
            <span>Transaction Types</span>
          </div>
          <div className="xeno-chart-container" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={txTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {txTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: "var(--bg-card)", borderColor: "var(--border)", borderRadius: "12px" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="xeno-pie-legend">
              {txTypeData.map((item) => (
                <div key={item.name} className="xeno-pie-legend-item">
                  <span className="xeno-pie-dot" style={{ background: item.color }} />
                  <span className="muted">{item.name}</span>
                  <span className="xeno-pie-val">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top Tokens */}
      <div className="glass-card xeno-top-tokens">
        <div className="xeno-panel-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--cyan)" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          <span>Top Tokens by Volume</span>
        </div>
        {topTokens.length > 0 ? (
          <div className="xeno-top-list">
            {topTokens.map((token, i) => (
              <div key={token.mint} className="xeno-top-item">
                <div className="xeno-top-rank">{i + 1}</div>
                <div className="xeno-top-info">
                  <span className="xeno-top-name">{token.name}</span>
                  <span className="xeno-top-addr">{shortAddr(token.mint)}</span>
                </div>
                <div className="xeno-top-vol">
                  <span style={{ color: "var(--alien-green)" }}>{formatCompactUSD(token.volume * solPrice)}</span>
                  <span className="muted">{token.volume.toFixed(2)} SOL</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="xeno-empty">
            <div className="xeno-spinner" />
            <span>Collecting data...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="xeno-metric-card glass-card">
      <div className="xeno-metric-card-header">
        <span className="xeno-metric-card-title">{title}</span>
        <span className="xeno-metric-card-dot" style={{ background: color }} />
      </div>
      <div className="xeno-metric-card-value">{value}</div>
      <div className="xeno-metric-card-sub">{sub}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  SUB-TAB: TRADES
// ═══════════════════════════════════════════════════════════════════
function XenoTrades({
  events,
  solPrice,
}: {
  events: PumpEvent[];
  solPrice: number;
}) {
  const [showBuys, setShowBuys] = useState(true);
  const [showSells, setShowSells] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("time");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const trades = events.filter((e) => e.txType === "trade");

  const filteredTrades = useMemo(() => {
    let result = trades.filter((t) => {
      if (!showBuys && t.isBuy) return false;
      if (!showSells && !t.isBuy) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          t.name?.toLowerCase().includes(q) ||
          t.symbol?.toLowerCase().includes(q) ||
          t.mint?.toLowerCase().includes(q)
        );
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "time": cmp = a.timestamp - b.timestamp; break;
        case "amount": cmp = (a.solAmount || 0) - (b.solAmount || 0); break;
        case "token": cmp = (a.name || "").localeCompare(b.name || ""); break;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return result;
  }, [trades, showBuys, showSells, searchQuery, sortField, sortOrder]);

  const totalBuyVol = trades.filter((t) => t.isBuy).reduce((a, t) => a + (t.solAmount || 0), 0);
  const totalSellVol = trades.filter((t) => !t.isBuy).reduce((a, t) => a + (t.solAmount || 0), 0);

  const copyHash = (sig: string) => {
    navigator.clipboard.writeText(sig);
    setCopiedHash(sig);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  return (
    <div className="xeno-trades">
      {/* THE POINT */}
      <div className="xeno-tab-explainer">
        <h3>On-Chain Receipts</h3>
        <p>Every buy and sell across Pump.fun, sortable by time, amount, or token. Search for any token or contract address, copy transaction hashes, and click through to Solscan for full on-chain verification. This is your audit trail.</p>
      </div>

      {/* Header */}
      <div className="xeno-trades-header">
        <div>
          <h2 className="xeno-section-title">Trades</h2>
          <p className="xeno-section-sub">Live trading activity on Pump.fun</p>
        </div>
        <div className="xeno-trades-volume-stats">
          <div className="xeno-vol-badge buy">
            <span>Buy Volume</span>
            <strong>{formatCompactUSD(totalBuyVol * solPrice)}</strong>
          </div>
          <div className="xeno-vol-badge sell">
            <span>Sell Volume</span>
            <strong>{formatCompactUSD(totalSellVol * solPrice)}</strong>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="xeno-filter-bar">
        <span className="xeno-filter-label">Show:</span>
        <button
          className={`xeno-filter-chip ${showBuys ? "active-buy" : ""}`}
          onClick={() => setShowBuys(!showBuys)}
        >
          Buys
        </button>
        <button
          className={`xeno-filter-chip ${showSells ? "active-sell" : ""}`}
          onClick={() => setShowSells(!showSells)}
        >
          Sells
        </button>
        <div className="xeno-search-input" style={{ marginLeft: "auto" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search token or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Trades Table */}
      <div className="glass-card xeno-trades-table-wrap">
        <div className="xeno-table-wrap">
          <table className="xeno-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="sortable" onClick={() => toggleSort("token")}>
                  Token {sortField === "token" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="sortable right" onClick={() => toggleSort("amount")}>
                  Amount {sortField === "amount" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="right">Price</th>
                <th className="sortable right" onClick={() => toggleSort("time")}>
                  Time {sortField === "time" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                </th>
                <th className="right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTrades.length > 0 ? (
                filteredTrades.slice(0, 50).map((trade, i) => (
                  <tr key={`${trade.signature}-${i}`}>
                    <td>
                      <span className={`xeno-type-badge ${trade.isBuy ? "xeno-badge-safe" : "xeno-badge-risk"}`}>
                        {trade.isBuy ? "BUY" : "SELL"}
                      </span>
                    </td>
                    <td>
                      <a
                        className="xeno-trade-token-cell xeno-clickable-row"
                        href={trade.mint ? `https://pump.fun/${trade.mint}` : undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <TokenAvatar uri={trade.uri} alt={trade.name || "Token"} size={32} />
                        <div>
                          <span className="xeno-trade-name">{trade.name || trade.symbol || "Unknown"}</span>
                          <span className="xeno-trade-addr">{shortAddr(trade.mint)}</span>
                        </div>
                      </a>
                    </td>
                    <td className="right">
                      <div className="xeno-trade-amount">
                        <span>{formatCompactUSD((trade.solAmount || 0) * solPrice)}</span>
                        <span className="muted">{(trade.solAmount || 0).toFixed(4)} SOL</span>
                      </div>
                    </td>
                    <td className="right mono muted">
                      {trade.marketCapSol ? formatCompactUSD(trade.marketCapSol * solPrice) : "---"}
                    </td>
                    <td className="right muted">{timeAgo(trade.timestamp)}</td>
                    <td className="right">
                      <div className="xeno-trade-actions">
                        <button
                          className="xeno-icon-btn"
                          onClick={() => copyHash(trade.signature || "")}
                          title="Copy tx hash"
                        >
                          {copiedHash === trade.signature ? "✓" : "⧉"}
                        </button>
                        <a
                          href={`https://solscan.io/tx/${trade.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="xeno-icon-btn"
                          title="View on Solscan"
                        >
                          ↗
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="xeno-table-empty">
                    No trades found. Waiting for activity...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Shared Sub-components ────────────────────────────────────────

function StatCard({
  title,
  value,
  sub,
  color,
}: {
  title: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="xeno-stat-card glass-card">
      <span className="xeno-stat-title">{title}</span>
      <span className="xeno-stat-value" style={{ color }}>{value}</span>
      <span className="xeno-stat-sub">{sub}</span>
    </div>
  );
}

function FeedItem({ event, solPrice }: { event: PumpEvent; solPrice: number }) {
  const [copied, setCopied] = useState(false);

  const typeConfig: Record<string, { color: string; label: string }> = {
    create: { color: "var(--cyan)", label: "CREATE" },
    trade: { color: "var(--alien-green)", label: "TRADE" },
    migrate: { color: "var(--purple)", label: "MIGRATE" },
  };
  const cfg = typeConfig[event.txType] || typeConfig.trade;

  const copyMint = () => {
    if (event.mint) {
      navigator.clipboard.writeText(event.mint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const pumpUrl = event.mint ? `https://pump.fun/${event.mint}` : undefined;

  return (
    <a
      className="xeno-sidebar-feed-item xeno-clickable-row"
      href={pumpUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => { if (!pumpUrl) e.preventDefault(); }}
    >
      <TokenAvatar uri={event.uri} alt={event.name || "Token"} size={34} />
      <div className="xeno-sidebar-feed-info">
        <span className="xeno-sidebar-feed-name">
          {event.symbol || event.name || shortAddr(event.mint)}
        </span>
        <div className="xeno-sidebar-feed-meta">
          <span className="xeno-sidebar-feed-type" style={{ color: cfg.color }}>{cfg.label}</span>
          {event.mint && (
            <button className="xeno-sidebar-feed-copy" onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyMint(); }}>
              {copied ? "✓" : shortAddr(event.mint)}
            </button>
          )}
        </div>
      </div>
      <div className="xeno-sidebar-feed-right">
        {event.solAmount ? (
          <span className="xeno-sidebar-feed-val">{formatUSD(event.solAmount * solPrice)}</span>
        ) : null}
        <span className="xeno-sidebar-feed-time">{timeAgo(event.timestamp)}</span>
      </div>
    </a>
  );
}
