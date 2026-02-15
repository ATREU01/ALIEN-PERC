import React, { useState, useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarketData, useMarketDiscovery } from "../hooks/useMarketData";
import {
  formatPriceE6,
  formatBps,
  formatCompact,
  truncateAddress,
  formatBigintE6,
} from "../lib/format";

type OrderSide = "long" | "short";
type OrderTab = "market" | "limit";

export function Trade() {
  const { connected } = useWallet();
  const { markets, loading: discovering } = useMarketDiscovery();
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const { state, accounts, loading, error } = useMarketData(selectedMarket);

  // Order form state
  const [orderSide, setOrderSide] = useState<OrderSide>("long");
  const [orderTab, setOrderTab] = useState<OrderTab>("market");
  const [leverage, setLeverage] = useState(5);
  const [amount, setAmount] = useState("");
  const [positionsTab, setPositionsTab] = useState<"positions" | "orders" | "history">("positions");

  // Derived
  const userAccounts = useMemo(
    () => accounts.filter((a) => a.kind === "user"),
    [accounts]
  );
  const lpAccounts = useMemo(
    () => accounts.filter((a) => a.kind === "lp"),
    [accounts]
  );

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Trade</h1>
        {state?.resolved && <span className="badge-burned">RESOLVED</span>}
        {state && !state.resolved && <span className="badge-live">LIVE</span>}
      </div>

      {/* Market selector */}
      <div className="markets-grid" style={{ marginBottom: "2rem" }}>
        {discovering && (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <span className="text-muted">Discovering markets on-chain...</span>
          </div>
        )}
        {!discovering && markets.length === 0 && (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <span className="text-muted">
              No markets auto-discovered (public RPC limitation).{" "}
              Use the <a href="#indexer" className="text-cyan">Market Indexer</a> to paste a market address, or{" "}
              <a href="#register" className="text-cyan">list a token</a>.
            </span>
          </div>
        )}
        {markets.map((m) => (
          <div
            key={m.address}
            className={`market-card ${selectedMarket === m.address ? "active" : ""}`}
            onClick={() => setSelectedMarket(m.address)}
          >
            <div className="market-card-header">
              <span className="market-card-name">
                {truncateAddress(m.state.collateralMint)}
                {m.state.inverted && " (INV)"}
              </span>
              {m.state.adminBurned ? (
                <span className="badge-burned">BURNED</span>
              ) : (
                <span className="badge-live">ADMIN</span>
              )}
            </div>
            <div className="market-card-stats">
              <div>
                <span className="text-muted">Mark</span>
                <span className="text-cyan">
                  ${formatPriceE6(m.state.markPriceE6)}
                </span>
              </div>
              <div>
                <span className="text-muted">Traders</span>
                <span>{m.state.numAccounts}</span>
              </div>
              <div>
                <span className="text-muted">OI</span>
                <span>{formatBigintE6(m.state.totalOI)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Trading Terminal */}
      {selectedMarket && state && (
        <>
          {/* Stats bar */}
          <div className="stats-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="stat-card">
              <span className="stat-label">Mark Price</span>
              <span className="stat-value text-cyan">
                ${formatPriceE6(state.markPriceE6)}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Open Interest</span>
              <span className="stat-value">{formatBigintE6(state.totalOI)}</span>
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
              <span className="stat-label">Trading Fee</span>
              <span className="stat-value">{formatBps(state.tradingFeeBps)}</span>
            </div>
          </div>

          {/* Terminal layout */}
          <div className="terminal-layout">
            {/* Order form */}
            <div className="order-form">
              <div className="order-tabs">
                <button
                  className={`order-tab ${orderSide === "long" ? "active-long" : ""}`}
                  onClick={() => setOrderSide("long")}
                >
                  Long
                </button>
                <button
                  className={`order-tab ${orderSide === "short" ? "active-short" : ""}`}
                  onClick={() => setOrderSide("short")}
                >
                  Short
                </button>
              </div>

              <div className="tabs" style={{ marginBottom: "1rem" }}>
                <button
                  className={`tab ${orderTab === "market" ? "active" : ""}`}
                  onClick={() => setOrderTab("market")}
                >
                  Market
                </button>
                <button
                  className={`tab ${orderTab === "limit" ? "active" : ""}`}
                  onClick={() => setOrderTab("limit")}
                >
                  Limit
                </button>
              </div>

              {orderTab === "limit" && (
                <div className="form-group">
                  <label className="form-label">Limit Price</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder="0.00"
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Amount (Collateral)</label>
                <input
                  type="number"
                  className="form-input"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Leverage: <span className="text-cyan">{leverage}x</span>
                </label>
                <input
                  type="range"
                  className="leverage-slider"
                  min="1"
                  max={Math.floor(10000 / state.initialMarginBps)}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                />
                <div className="flex-between text-muted" style={{ fontSize: "0.75rem" }}>
                  <span>1x</span>
                  <span>{Math.floor(10000 / state.initialMarginBps)}x</span>
                </div>
              </div>

              <div className="glass-card" style={{ padding: "0.75rem", marginBottom: "1rem" }}>
                <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                  <span className="text-muted">Position Size</span>
                  <span>
                    {amount ? formatCompact(Number(amount) * leverage) : "--"}
                  </span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                  <span className="text-muted">Trading Fee</span>
                  <span>
                    {amount
                      ? formatCompact(
                          (Number(amount) * leverage * state.tradingFeeBps) / 10000
                        )
                      : "--"}
                  </span>
                </div>
                <div className="flex-between">
                  <span className="text-muted">Initial Margin</span>
                  <span>{formatBps(state.initialMarginBps)}</span>
                </div>
              </div>

              {connected ? (
                <button
                  className={orderSide === "long" ? "btn-long" : "btn-short"}
                  style={{ width: "100%" }}
                >
                  {orderSide === "long" ? "Open Long" : "Open Short"}
                </button>
              ) : (
                <button className="btn-primary" style={{ width: "100%" }} disabled>
                  Connect Wallet
                </button>
              )}

              {error && (
                <div className="text-red" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  {error}
                </div>
              )}
            </div>

            {/* Positions / orderbook area */}
            <div className="terminal-main">
              <div className="tabs">
                <button
                  className={`tab ${positionsTab === "positions" ? "active" : ""}`}
                  onClick={() => setPositionsTab("positions")}
                >
                  Positions
                  <span className="tab-count">{userAccounts.length}</span>
                </button>
                <button
                  className={`tab ${positionsTab === "orders" ? "active" : ""}`}
                  onClick={() => setPositionsTab("orders")}
                >
                  LP Vaults
                  <span className="tab-count">{lpAccounts.length}</span>
                </button>
                <button
                  className={`tab ${positionsTab === "history" ? "active" : ""}`}
                  onClick={() => setPositionsTab("history")}
                >
                  All Accounts
                  <span className="tab-count">{accounts.length}</span>
                </button>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Index</th>
                      <th>Type</th>
                      <th>Owner</th>
                      <th>Capital</th>
                      <th>PnL</th>
                      <th>Position</th>
                      <th>Entry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(positionsTab === "positions"
                      ? userAccounts
                      : positionsTab === "orders"
                        ? lpAccounts
                        : accounts
                    ).length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: "center", padding: "2rem" }}>
                          <span className="text-muted">
                            {loading ? "Loading accounts..." : "No accounts found"}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      (positionsTab === "positions"
                        ? userAccounts
                        : positionsTab === "orders"
                          ? lpAccounts
                          : accounts
                      ).map((acct) => (
                        <tr key={acct.index}>
                          <td>#{acct.index}</td>
                          <td>
                            <span className={acct.kind === "lp" ? "text-purple" : "text-cyan"}>
                              {acct.kind.toUpperCase()}
                            </span>
                          </td>
                          <td>{truncateAddress(acct.owner)}</td>
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
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {/* No market selected state */}
      {!selectedMarket && !discovering && markets.length > 0 && (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <h3 className="text-cyan" style={{ marginBottom: "0.5rem" }}>
            Select a Market
          </h3>
          <p className="text-muted">
            Choose a market from the cards above to open the trading terminal.
          </p>
        </div>
      )}
    </div>
  );
}
