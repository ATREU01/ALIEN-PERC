import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarketDiscovery, useMarketData } from "../hooks/useMarketData";
import {
  formatBigintE6,
  formatPriceE6,
  formatBps,
  truncateAddress,
} from "../lib/format";

export function Earn() {
  const { connected } = useWallet();
  const { markets, loading: discovering } = useMarketDiscovery();
  const [selectedVault, setSelectedVault] = useState<string | null>(null);
  const { state } = useMarketData(selectedVault);
  const [depositAmount, setDepositAmount] = useState("");

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Earn</h1>
        <span className="badge-new">LP VAULTS</span>
      </div>
      <p className="text-muted" style={{ marginBottom: "2rem", maxWidth: "600px" }}>
        Provide liquidity to percolator markets. LPs absorb counterparty risk
        and earn a share of trading fees. After admin burn, the insurance fund
        grows permanently from all fee revenue.
      </p>

      {/* Vault grid */}
      <div className="vault-grid">
        {discovering && (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <span className="text-muted">Scanning for vaults...</span>
          </div>
        )}
        {!discovering && markets.length === 0 && (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <span className="text-muted">
              No vaults found. Check your RPC connection or{" "}
              <a href="#register" className="text-cyan">list a new token</a>.
            </span>
          </div>
        )}

        {markets.map((m) => {
          const isSelected = selectedVault === m.address;
          return (
            <div
              key={m.address}
              className={`vault-card ${isSelected ? "active" : ""}`}
              onClick={() => setSelectedVault(isSelected ? null : m.address)}
            >
              <div className="vault-header">
                <div>
                  <h3 className="vault-name">
                    {truncateAddress(m.state.collateralMint, 6)}
                    {m.state.inverted && (
                      <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                        INVERTED
                      </span>
                    )}
                  </h3>
                  <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                    Slab: {truncateAddress(m.address)}
                  </span>
                </div>
                {m.state.adminBurned ? (
                  <span className="badge-burned">SOVEREIGN</span>
                ) : (
                  <span className="badge-live">ACTIVE</span>
                )}
              </div>

              <div className="vault-stats">
                <div className="vault-stat">
                  <span className="vault-stat-label">TVL (Capital)</span>
                  <span className="vault-stat-value text-cyan">
                    {formatBigintE6(m.state.cTot)}
                  </span>
                </div>
                <div className="vault-stat">
                  <span className="vault-stat-label">Insurance</span>
                  <span className="vault-stat-value text-green">
                    {formatBigintE6(m.state.insuranceBalance)}
                  </span>
                </div>
                <div className="vault-stat">
                  <span className="vault-stat-label">Fee Revenue</span>
                  <span className="vault-stat-value text-purple">
                    {formatBigintE6(m.state.feeRevenue)}
                  </span>
                </div>
                <div className="vault-stat">
                  <span className="vault-stat-label">Mark Price</span>
                  <span className="vault-stat-value">
                    ${formatPriceE6(m.state.markPriceE6)}
                  </span>
                </div>
                <div className="vault-stat">
                  <span className="vault-stat-label">Trading Fee</span>
                  <span className="vault-stat-value">
                    {formatBps(m.state.tradingFeeBps)}
                  </span>
                </div>
                <div className="vault-stat">
                  <span className="vault-stat-label">LP Accounts</span>
                  <span className="vault-stat-value">{m.state.numAccounts}</span>
                </div>
              </div>

              {/* Deposit section (expanded) */}
              {isSelected && (
                <div className="vault-deposit" onClick={(e) => e.stopPropagation()}>
                  <div className="form-group">
                    <label className="form-label">Deposit Amount</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0.00"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                    />
                  </div>
                  {connected ? (
                    <button className="btn-deposit" style={{ width: "100%" }}>
                      Deposit to Vault
                    </button>
                  ) : (
                    <button className="btn-primary" style={{ width: "100%" }} disabled>
                      Connect Wallet to Deposit
                    </button>
                  )}
                  <p
                    className="text-muted"
                    style={{ fontSize: "0.75rem", marginTop: "0.5rem", textAlign: "center" }}
                  >
                    LP deposits absorb counterparty risk. Withdrawals may be delayed
                    during high utilization.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Insurance fund tracker */}
      <section className="section" style={{ marginTop: "3rem" }}>
        <h2 className="section-title">Insurance Fund Tracker</h2>
        <p className="text-muted" style={{ marginBottom: "1.5rem" }}>
          Once admin keys are burned, trading fees flow to the insurance fund forever.
          This is the soft burn mechanism — tokens locked permanently in the vault.
        </p>

        {state ? (
          <div className="insurance-tracker">
            <div className="insurance-big-number">
              {formatBigintE6(state.insuranceBalance)}
            </div>
            <span className="text-muted">Total Insurance Balance</span>
            <div className="stats-grid" style={{ marginTop: "1.5rem" }}>
              <div className="stat-card">
                <span className="stat-label">Fee Revenue</span>
                <span className="stat-value text-purple">
                  {formatBigintE6(state.feeRevenue)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">PnL+ Total</span>
                <span className="stat-value text-green">
                  {formatBigintE6(state.pnlPosTot)}
                </span>
              </div>
              <div className="stat-card">
                <span className="stat-label">Open Interest</span>
                <span className="stat-value text-cyan">
                  {formatBigintE6(state.totalOI)}
                </span>
              </div>
            </div>
            {state.adminBurned && (
              <div className="burn-indicator" style={{ marginTop: "1rem" }}>
                ADMIN BURNED — Insurance grows forever
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
            <span className="text-muted">
              Select a vault above to view its insurance fund details.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
