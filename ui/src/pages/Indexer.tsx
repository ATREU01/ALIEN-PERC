import React, { useState, useMemo } from "react";
import { useMarketDiscovery, useMarketData } from "../hooks/useMarketData";
import {
  formatPriceE6,
  formatBigintE6,
  formatBps,
  truncateAddress,
} from "../lib/format";

type IndexerTab = "overview" | "accounts" | "insurance" | "config";

export function Indexer() {
  const { markets, loading: discovering, error: discoveryError, refresh } = useMarketDiscovery();
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const { state, accounts, loading, error } = useMarketData(selectedAddress);
  const [activeTab, setActiveTab] = useState<IndexerTab>("overview");
  const [accountFilter, setAccountFilter] = useState<"all" | "user" | "lp">("all");

  const filteredAccounts = useMemo(() => {
    if (accountFilter === "all") return accounts;
    return accounts.filter((a) => a.kind === accountFilter);
  }, [accounts, accountFilter]);

  const handleManualLoad = () => {
    const addr = manualAddress.trim();
    if (addr.length >= 32 && addr.length <= 44) {
      setSelectedAddress(addr);
    }
  };

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Market Indexer</h1>
        <button className="btn-secondary" onClick={refresh} style={{ fontSize: "0.85rem" }}>
          Refresh
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: "2rem", maxWidth: "600px" }}>
        Explore all percolator markets on-chain. View market state, account data,
        insurance funds, and configuration parameters in real-time.
      </p>

      {/* Market dropdown / selector */}
      {markets.length > 0 && (
        <div className="form-group" style={{ maxWidth: "500px", marginBottom: "1rem" }}>
          <label className="form-label">Discovered Markets</label>
          <select
            className="form-input"
            value={selectedAddress || ""}
            onChange={(e) => setSelectedAddress(e.target.value || null)}
          >
            <option value="">
              {discovering ? "Scanning for markets..." : "Choose a market..."}
            </option>
            {markets.map((m) => (
              <option key={m.address} value={m.address}>
                {truncateAddress(m.address, 8)} — {m.state.numAccounts} accounts
                {m.state.adminBurned ? " [BURNED]" : ""}
                {m.state.inverted ? " (INV)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Manual address input */}
      <div className="form-group" style={{ maxWidth: "500px", marginBottom: "2rem" }}>
        <label className="form-label">
          <span>Enter Market Address</span>
          {discovering && <span className="text-alien">Scanning...</span>}
          {!discovering && markets.length === 0 && !discoveryError && (
            <span className="text-muted">No markets auto-discovered</span>
          )}
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            className="form-input"
            style={{ flex: 1 }}
            placeholder="Paste slab account address..."
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleManualLoad()}
          />
          <button
            className="btn-primary"
            style={{ padding: "12px 24px", fontSize: "13px", whiteSpace: "nowrap" }}
            onClick={handleManualLoad}
            disabled={manualAddress.trim().length < 32}
          >
            Load
          </button>
        </div>
        {discoveryError && (
          <p className="text-muted" style={{ fontSize: "0.75rem", marginTop: "8px" }}>
            {discoveryError}. Paste a market address above to explore it.
          </p>
        )}
      </div>

      {error && (
        <div className="glass-card text-red" style={{ padding: "1rem", marginBottom: "1rem" }}>
          Error: {error}
        </div>
      )}

      {/* Market detail */}
      {state && (
        <>
          {/* Status badges */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
            {state.adminBurned ? (
              <span className="badge-burned">ADMIN BURNED</span>
            ) : (
              <span className="badge-live">ADMIN ACTIVE</span>
            )}
            {state.inverted && <span className="badge-new">INVERTED</span>}
            {state.resolved && <span className="badge-burned">RESOLVED</span>}
            <span className="badge-sovereign">v{state.version}</span>
          </div>

          {/* Tab navigation */}
          <div className="tabs" style={{ marginBottom: "1.5rem" }}>
            <button
              className={`tab ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab ${activeTab === "accounts" ? "active" : ""}`}
              onClick={() => setActiveTab("accounts")}
            >
              Accounts
              <span className="tab-count">{accounts.length}</span>
            </button>
            <button
              className={`tab ${activeTab === "insurance" ? "active" : ""}`}
              onClick={() => setActiveTab("insurance")}
            >
              Insurance
            </button>
            <button
              className={`tab ${activeTab === "config" ? "active" : ""}`}
              onClick={() => setActiveTab("config")}
            >
              Config
            </button>
          </div>

          {/* Overview tab */}
          {activeTab === "overview" && (
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Mark Price</span>
                <span className="stat-value text-cyan">
                  ${formatPriceE6(state.markPriceE6)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Total Capital</span>
                <span className="stat-value">{formatBigintE6(state.cTot)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Open Interest</span>
                <span className="stat-value text-yellow">
                  {formatBigintE6(state.totalOI)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Insurance Fund</span>
                <span className="stat-value text-green">
                  {formatBigintE6(state.insuranceBalance)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Fee Revenue</span>
                <span className="stat-value text-purple">
                  {formatBigintE6(state.feeRevenue)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Accounts</span>
                <span className="stat-value">{state.numAccounts}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">LP Abs Sum</span>
                <span className="stat-value">{formatBigintE6(state.lpSumAbs)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">PnL+ Total</span>
                <span className="stat-value text-green">
                  {formatBigintE6(state.pnlPosTot)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Admin</span>
                <span className="stat-value" style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>
                  {state.adminBurned ? "BURNED (1111...1111)" : truncateAddress(state.admin, 6)}
                </span>
              </div>
            </div>
          )}

          {/* Accounts tab */}
          {activeTab === "accounts" && (
            <>
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                {(["all", "user", "lp"] as const).map((f) => (
                  <button
                    key={f}
                    className={`tab ${accountFilter === f ? "active" : ""}`}
                    onClick={() => setAccountFilter(f)}
                  >
                    {f.toUpperCase()}
                    <span className="tab-count">
                      {f === "all"
                        ? accounts.length
                        : accounts.filter((a) => a.kind === f).length}
                    </span>
                  </button>
                ))}
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Owner</th>
                      <th>Capital</th>
                      <th>PnL</th>
                      <th>Position Size</th>
                      <th>Entry Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>
                          <span className="text-muted">Loading accounts...</span>
                        </td>
                      </tr>
                    )}
                    {!loading && filteredAccounts.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>
                          <span className="text-muted">No accounts found</span>
                        </td>
                      </tr>
                    )}
                    {filteredAccounts.map((acct) => (
                      <tr key={acct.index}>
                        <td>#{acct.index}</td>
                        <td>
                          <span className={acct.kind === "lp" ? "text-purple" : "text-cyan"}>
                            {acct.kind.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                          <a
                            href={`https://solscan.io/account/${acct.owner}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan"
                          >
                            {truncateAddress(acct.owner, 6)}
                          </a>
                        </td>
                        <td>{formatBigintE6(acct.capital)}</td>
                        <td>
                          <span className={acct.pnl >= 0n ? "text-green" : "text-red"}>
                            {formatBigintE6(acct.pnl)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={
                              acct.positionSize > 0n
                                ? "text-green"
                                : acct.positionSize < 0n
                                  ? "text-red"
                                  : ""
                            }
                          >
                            {formatBigintE6(acct.positionSize)}
                          </span>
                        </td>
                        <td>${formatPriceE6(acct.entryPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Insurance tab */}
          {activeTab === "insurance" && (
            <div className="insurance-tracker">
              <div className="insurance-big-number">
                {formatBigintE6(state.insuranceBalance)}
              </div>
              <span className="text-muted" style={{ display: "block", textAlign: "center", marginBottom: "1.5rem" }}>
                Insurance Fund Balance
              </span>

              {state.adminBurned && (
                <div className="burn-indicator" style={{ marginBottom: "1.5rem" }}>
                  ADMIN KEY BURNED — Insurance fund grows forever from trading fees
                </div>
              )}

              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">Insurance Balance</span>
                  <span className="stat-value text-green">
                    {formatBigintE6(state.insuranceBalance)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Fee Revenue</span>
                  <span className="stat-value text-purple">
                    {formatBigintE6(state.feeRevenue)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Total Capital Locked</span>
                  <span className="stat-value text-cyan">
                    {formatBigintE6(state.cTot)}
                  </span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Open Interest</span>
                  <span className="stat-value text-yellow">
                    {formatBigintE6(state.totalOI)}
                  </span>
                </div>
              </div>

              <div className="glass-card" style={{ padding: "1.5rem", marginTop: "1.5rem" }}>
                <h4 style={{ marginBottom: "0.75rem" }}>How the Soft Burn Works</h4>
                <ol className="text-muted" style={{ paddingLeft: "1.25rem", lineHeight: 2 }}>
                  <li>Every trade pays a fee ({formatBps(state.tradingFeeBps)} per side)</li>
                  <li>Fees flow directly to the market's insurance fund</li>
                  <li>After admin burn, no one can withdraw from the fund</li>
                  <li>Tokens are locked forever — effective supply reduction</li>
                  <li>More trading volume = more tokens permanently locked</li>
                </ol>
              </div>
            </div>
          )}

          {/* Config tab */}
          {activeTab === "config" && (
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-label">Collateral Mint</span>
                <span className="stat-value" style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}>
                  <a
                    href={`https://solscan.io/token/${state.collateralMint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan"
                  >
                    {truncateAddress(state.collateralMint, 8)}
                  </a>
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Vault</span>
                <span className="stat-value" style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}>
                  <a
                    href={`https://solscan.io/account/${state.vault}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan"
                  >
                    {truncateAddress(state.vault, 8)}
                  </a>
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Admin</span>
                <span className="stat-value" style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono)" }}>
                  {state.adminBurned ? (
                    <span className="text-red">BURNED</span>
                  ) : (
                    <a
                      href={`https://solscan.io/account/${state.admin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan"
                    >
                      {truncateAddress(state.admin, 8)}
                    </a>
                  )}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Inverted</span>
                <span className="stat-value">
                  {state.inverted ? (
                    <span className="text-green">Yes</span>
                  ) : (
                    <span className="text-muted">No</span>
                  )}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Initial Margin</span>
                <span className="stat-value">{formatBps(state.initialMarginBps)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Maintenance Margin</span>
                <span className="stat-value">{formatBps(state.maintenanceMarginBps)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Trading Fee</span>
                <span className="stat-value">{formatBps(state.tradingFeeBps)}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Max Leverage</span>
                <span className="stat-value text-cyan">
                  {Math.floor(10000 / state.initialMarginBps)}x
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Version</span>
                <span className="stat-value">{state.version}</span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Last Crank Slot</span>
                <span className="stat-value" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                  {state.lastCrankSlot.toString()}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty state */}
      {!selectedAddress && !discovering && (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem", opacity: 0.5 }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <ellipse cx="32" cy="28" rx="24" ry="28" fill="none" stroke="#39ff14" strokeWidth="1.5" opacity="0.2" />
              <ellipse cx="22" cy="24" rx="7" ry="9" fill="#39ff14" opacity="0.08" />
              <ellipse cx="42" cy="24" rx="7" ry="9" fill="#39ff14" opacity="0.08" />
              <ellipse cx="22" cy="24" rx="4" ry="6" fill="#39ff14" opacity="0.3" />
              <ellipse cx="42" cy="24" rx="4" ry="6" fill="#39ff14" opacity="0.3" />
              <ellipse cx="23" cy="22" rx="1.5" ry="2" fill="rgba(255,255,255,0.3)" />
              <ellipse cx="43" cy="22" rx="1.5" ry="2" fill="rgba(255,255,255,0.3)" />
            </svg>
          </div>
          <h3 className="text-cyan" style={{ marginBottom: "0.5rem" }}>
            Select a Market to Explore
          </h3>
          <p className="text-muted">
            Use the dropdown above to pick a market and view its on-chain state.
          </p>
        </div>
      )}
    </div>
  );
}
