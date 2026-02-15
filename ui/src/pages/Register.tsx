import React, { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { SLAB_RENT_SOL, COLLATERAL_SOL, BURN_FEE_SOL, TOTAL_LISTING_COST_SOL } from "../lib/constants";

type RegisterStep = 1 | 2 | 3;

export function Register() {
  const { connected } = useWallet();
  const [step, setStep] = useState<RegisterStep>(1);
  const [tokenMint, setTokenMint] = useState("");
  const [inverted, setInverted] = useState(true);
  const [burnAdmin, setBurnAdmin] = useState(true);

  // Risk params
  const [initialMarginBps, setInitialMarginBps] = useState(2000); // 20%
  const [maintenanceMarginBps, setMaintenanceMarginBps] = useState(1000); // 10%
  const [tradingFeeBps, setTradingFeeBps] = useState(30); // 0.30%

  const canProceed = step === 1 ? tokenMint.length >= 32 : true;

  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Register a Market</h1>
        <span className="badge-new">PERMISSIONLESS</span>
      </div>
      <p className="text-muted" style={{ marginBottom: "2rem", maxWidth: "640px" }}>
        List any SPL token as a sovereign perpetual market. Deploy the on-chain slab,
        set parameters, deposit collateral, and optionally burn the admin key
        to make it fully autonomous forever.
      </p>

      {/* Progress steps */}
      <div className="register-steps">
        <div className={`register-step ${step >= 1 ? "active" : ""} ${step > 1 ? "completed" : ""}`}>
          <div className="step-icon">1</div>
          <div className="step-content">
            <span className="step-title">Enter Token</span>
            <span className="step-desc">SPL token mint address</span>
          </div>
        </div>
        <div className="step-line" />
        <div className={`register-step ${step >= 2 ? "active" : ""} ${step > 2 ? "completed" : ""}`}>
          <div className="step-icon">2</div>
          <div className="step-content">
            <span className="step-title">Configure</span>
            <span className="step-desc">Set risk parameters</span>
          </div>
        </div>
        <div className="step-line" />
        <div className={`register-step ${step >= 3 ? "active" : ""}`}>
          <div className="step-icon">3</div>
          <div className="step-content">
            <span className="step-title">Deploy</span>
            <span className="step-desc">Create slab on-chain</span>
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="register-container">
        <div className="register-form">
          {step === 1 && (
            <>
              <h3 style={{ marginBottom: "1rem" }}>Token Mint Address</h3>
              <div className="form-group">
                <label className="form-label">SPL Token Mint</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Enter Solana token mint address..."
                  value={tokenMint}
                  onChange={(e) => setTokenMint(e.target.value)}
                  style={{ fontFamily: "var(--font-mono)" }}
                />
                <span className="text-muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem", display: "block" }}>
                  The SPL token that will be used as collateral for this market.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={inverted}
                    onChange={(e) => setInverted(e.target.checked)}
                  />
                  Inverted Market (recommended for memecoins)
                </label>
                <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                  Inverted: price = 1/TOKEN_USD. Users deposit the token as collateral.
                </span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h3 style={{ marginBottom: "1rem" }}>Risk Parameters</h3>

              <div className="form-group">
                <label className="form-label">
                  Initial Margin:{" "}
                  <span className="text-cyan">{(initialMarginBps / 100).toFixed(1)}%</span>
                  <span className="text-muted"> ({Math.floor(10000 / initialMarginBps)}x max leverage)</span>
                </label>
                <input
                  type="range"
                  className="leverage-slider"
                  min="500"
                  max="5000"
                  step="100"
                  value={initialMarginBps}
                  onChange={(e) => setInitialMarginBps(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Maintenance Margin:{" "}
                  <span className="text-cyan">{(maintenanceMarginBps / 100).toFixed(1)}%</span>
                </label>
                <input
                  type="range"
                  className="leverage-slider"
                  min="200"
                  max={initialMarginBps}
                  step="100"
                  value={maintenanceMarginBps}
                  onChange={(e) => setMaintenanceMarginBps(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Trading Fee:{" "}
                  <span className="text-cyan">{(tradingFeeBps / 100).toFixed(2)}%</span>
                  <span className="text-muted"> ({tradingFeeBps} bps)</span>
                </label>
                <input
                  type="range"
                  className="leverage-slider"
                  min="5"
                  max="100"
                  step="5"
                  value={tradingFeeBps}
                  onChange={(e) => setTradingFeeBps(Number(e.target.value))}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={burnAdmin}
                    onChange={(e) => setBurnAdmin(e.target.checked)}
                  />
                  Burn Admin Key After Deploy (IRREVERSIBLE)
                </label>
                <span className="text-muted" style={{ fontSize: "0.8rem" }}>
                  Transfers admin to system program. Market becomes fully sovereign — no one
                  can modify parameters ever again. Recommended for trust.
                </span>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h3 style={{ marginBottom: "1rem" }}>Review & Deploy</h3>

              <div className="glass-card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
                <h4 className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  MARKET CONFIGURATION
                </h4>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span className="text-muted">Token Mint</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>
                    {tokenMint.slice(0, 8)}...{tokenMint.slice(-8)}
                  </span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span className="text-muted">Market Type</span>
                  <span>{inverted ? "Inverted" : "Standard"}</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span className="text-muted">Initial Margin</span>
                  <span>{(initialMarginBps / 100).toFixed(1)}% ({Math.floor(10000 / initialMarginBps)}x)</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span className="text-muted">Maintenance Margin</span>
                  <span>{(maintenanceMarginBps / 100).toFixed(1)}%</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span className="text-muted">Trading Fee</span>
                  <span>{(tradingFeeBps / 100).toFixed(2)}%</span>
                </div>
                <div className="flex-between">
                  <span className="text-muted">Admin Burn</span>
                  <span className={burnAdmin ? "text-red" : "text-yellow"}>
                    {burnAdmin ? "YES — IRREVERSIBLE" : "No"}
                  </span>
                </div>
              </div>

              {/* Costs */}
              <div className="register-costs">
                <h4 className="text-muted" style={{ marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  ESTIMATED COSTS
                </h4>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>Slab Rent (~992KB)</span>
                  <span className="text-cyan">{SLAB_RENT_SOL} SOL</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>Initial Collateral</span>
                  <span className="text-cyan">{COLLATERAL_SOL} SOL</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>Network Fees</span>
                  <span className="text-cyan">~{BURN_FEE_SOL} SOL</span>
                </div>
                <div
                  className="flex-between"
                  style={{
                    borderTop: "1px solid var(--border)",
                    paddingTop: "0.5rem",
                    marginTop: "0.5rem",
                    fontWeight: 600,
                  }}
                >
                  <span>Total</span>
                  <span className="text-cyan">~{TOTAL_LISTING_COST_SOL} SOL</span>
                </div>
              </div>
            </>
          )}

          {/* Navigation buttons */}
          <div className="flex-between" style={{ marginTop: "1.5rem" }}>
            {step > 1 ? (
              <button
                className="btn-secondary"
                onClick={() => setStep((s) => (s - 1) as RegisterStep)}
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {step < 3 ? (
              <button
                className="btn-primary"
                disabled={!canProceed}
                onClick={() => setStep((s) => (s + 1) as RegisterStep)}
              >
                Continue
              </button>
            ) : connected ? (
              <button className="btn-primary btn-lg">
                {burnAdmin ? "Deploy & Burn Admin" : "Deploy Market"}
              </button>
            ) : (
              <button className="btn-primary" disabled>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
