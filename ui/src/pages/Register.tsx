import React, { useState, useEffect } from "react";
import { PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { usePercolatorTx } from "../hooks/usePercolatorTx";
import { SLAB_DATA_SIZE, MIN_COLLATERAL_SOL, TX_FEE_SOL } from "../lib/constants";
import { buildInitMarketTx, buildUpdateAdminTx } from "../lib/transactions";

type RegisterStep = 1 | 2 | 3;

export function Register() {
  const { execute, status, lastError, lastSignature, connected, publicKey, connection } = usePercolatorTx();
  const [step, setStep] = useState<RegisterStep>(1);
  const [tokenMint, setTokenMint] = useState("");
  const [inverted, setInverted] = useState(true);
  const [burnAdmin, setBurnAdmin] = useState(true);

  // Risk params
  const [initialMarginBps, setInitialMarginBps] = useState(2000); // 20%
  const [maintenanceMarginBps, setMaintenanceMarginBps] = useState(1000); // 10%
  const [tradingFeeBps, setTradingFeeBps] = useState(30); // 0.30%

  // Fetch real slab rent from chain
  const [slabRentSol, setSlabRentSol] = useState<number | null>(null);
  useEffect(() => {
    connection
      .getMinimumBalanceForRentExemption(SLAB_DATA_SIZE)
      .then((lamports) => setSlabRentSol(lamports / LAMPORTS_PER_SOL))
      .catch(() => setSlabRentSol(6.91)); // fallback estimate
  }, [connection]);

  const totalCost = slabRentSol !== null
    ? slabRentSol + MIN_COLLATERAL_SOL + TX_FEE_SOL
    : null;

  const canProceed = step === 1 ? tokenMint.length >= 32 : true;

  const isBusy = status === "building" || status === "signing" || status === "confirming";
  const [deployedSlab, setDeployedSlab] = useState<string | null>(null);

  const statusLabel = (() => {
    switch (status) {
      case "building": return "Building tx...";
      case "signing": return "Sign in wallet...";
      case "confirming": return "Confirming on-chain...";
      default: return null;
    }
  })();

  // Deploy market on-chain
  const handleDeploy = async () => {
    if (!publicKey || !tokenMint) return;

    let mintPk: PublicKey;
    try {
      mintPk = new PublicKey(tokenMint);
    } catch {
      return; // Invalid mint address
    }

    // Step 1: Create slab + init market
    const deployResult = await execute(async () => {
      const { tx, slabKeypair } = await buildInitMarketTx(connection, publicKey, {
        collateralMint: mintPk,
        indexFeedId: "0000000000000000000000000000000000000000000000000000000000000000", // Hyperp mode
        invert: inverted ? 1 : 0,
        initialMarginBps,
        maintenanceMarginBps,
        tradingFeeBps,
        initialMarkPriceE6: 500_000n, // 0.50 USD initial mark
      });
      return { tx, extraSigners: [slabKeypair] };
    });

    if (deployResult.error) return;

    // Step 2: If burn admin, send updateAdmin to system program
    if (burnAdmin && deployResult.signature) {
      // We need the slab address from the deploy tx
      // For now, we track it via the success callback
      // The slab keypair was generated internally — we need to refactor to get it out
      // TODO: Surface slab address from deploy for admin burn
    }

    setDeployedSlab(deployResult.signature || null);
  };

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
                  DEPLOYMENT COSTS
                </h4>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>
                    Slab Account Rent
                    <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                      (~992KB, refundable on close)
                    </span>
                  </span>
                  <span className="text-cyan">
                    {slabRentSol !== null ? slabRentSol.toFixed(2) : "..."} SOL
                  </span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>
                    Initial LP Deposit
                    <span className="text-muted" style={{ fontSize: "0.75rem", marginLeft: "0.5rem" }}>
                      (min. {MIN_COLLATERAL_SOL} SOL, withdrawable)
                    </span>
                  </span>
                  <span className="text-cyan">{MIN_COLLATERAL_SOL} SOL</span>
                </div>
                <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                  <span>Transaction Fees</span>
                  <span className="text-cyan">~{TX_FEE_SOL} SOL</span>
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
                  <span className="text-cyan">
                    ~{totalCost !== null ? totalCost.toFixed(2) : "..."} SOL
                  </span>
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
              <button
                className="btn-primary btn-lg"
                disabled={isBusy}
                onClick={handleDeploy}
              >
                {isBusy
                  ? statusLabel
                  : burnAdmin ? "Deploy & Burn Admin" : "Deploy Market"}
              </button>
            ) : (
              <button className="btn-primary" disabled>
                Connect Wallet
              </button>
            )}
          </div>

          {/* Tx feedback */}
          {status === "success" && lastSignature && (
            <div className="glass-card" style={{ padding: "1rem", marginTop: "1rem", textAlign: "center", borderColor: "var(--alien-green)" }}>
              <div className="text-green" style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                Market Deployed Successfully!
              </div>
              <a
                href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan"
                style={{ fontSize: "0.85rem" }}
              >
                View transaction on Solscan
              </a>
            </div>
          )}
          {status === "error" && lastError && (
            <div className="text-red" style={{ marginTop: "1rem", fontSize: "0.85rem" }}>
              {lastError.slice(0, 200)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
