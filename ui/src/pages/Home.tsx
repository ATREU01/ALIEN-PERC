import React, { useState } from "react";
import { useMarketDiscovery } from "../hooks/useMarketData";
import { CONTRACT_ADDRESS } from "../lib/constants";

interface HomeProps {
  onNavigate: (route: string) => void;
}

export function Home({ onNavigate }: HomeProps) {
  const { markets } = useMarketDiscovery();
  const [copied, setCopied] = useState(false);

  const copyCA = () => {
    if (!CONTRACT_ADDRESS) return;
    navigator.clipboard.writeText(CONTRACT_ADDRESS).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const totalMarkets = markets.length;
  const totalAccounts = markets.reduce((s, m) => s + m.state.numAccounts, 0);

  return (
    <div className="page">
      {/* Hero */}
      <section className="hero">
        <div className="hero-banner" />
        <img
          src="/alien-hacker.jpg"
          alt="Alienator"
          className="hero-logo"
        />
        <div className="hero-badge">
          <span className="pulse-dot" />
          <span>Sovereign Perpetuals Protocol</span>
        </div>
        <p>
          Sovereign perpetual futures on Solana. Admin keys burned.
          Insurance fund compounds forever. No governance. No rugs. Just math.
        </p>
        <div className="hero-actions">
          <button className="btn-primary btn-lg" onClick={() => onNavigate("trade")}>
            Launch Terminal
          </button>
          <button className="btn-secondary btn-lg" onClick={() => onNavigate("register")}>
            List a Token
          </button>
        </div>

        {/* Contract Address */}
        <div className="ca-section" style={{ padding: "32px 0" }}>
          <p className="ca-label">Contract Address (CA)</p>
          {CONTRACT_ADDRESS ? (
            <>
              <div className="ca-box" onClick={copyCA} title="Click to copy">
                <span className="ca-address">{CONTRACT_ADDRESS}</span>
                <button className={`ca-copy-btn ${copied ? "ca-copied" : ""}`}>
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
              <p className="text-muted" style={{ fontSize: "0.75rem", marginTop: "12px" }}>
                Click to copy. Verify on{" "}
                <a
                  href={`https://solscan.io/token/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan"
                >
                  Solscan
                </a>{" "}
                or{" "}
                <a
                  href={`https://pump.fun/coin/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan"
                >
                  pump.fun
                </a>
              </p>
            </>
          ) : (
            <div className="ca-box ca-coming-soon">
              <span className="ca-address" style={{ color: "var(--text-muted)" }}>
                CA DROPPING SOON ON PUMP.FUN
              </span>
              <span className="ca-copy-btn" style={{ opacity: 0.4, cursor: "default" }}>
                SOON
              </span>
            </div>
          )}
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value text-alien">
              {totalMarkets || "--"}
            </span>
            <span className="hero-stat-label">Live Markets</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value text-cyan">
              {totalAccounts || "--"}
            </span>
            <span className="hero-stat-label">Active Accounts</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value text-purple">
              {totalMarkets > 0
                ? `${markets.filter((m) => m.state.adminBurned).length}/${totalMarkets}`
                : "--"}
            </span>
            <span className="hero-stat-label">Admin Burned</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section">
        <h2 className="section-title">How the Percolator Works</h2>
        <p className="section-subtitle text-muted">
          A @toly design. Inverted perpetual markets backed by the memecoin itself.
        </p>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(57, 255, 20, 0.06)", borderColor: "rgba(57, 255, 20, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 4 L16 28 M8 12 L16 4 L24 12" stroke="#39ff14" strokeWidth="2" fill="none" strokeLinecap="round" />
                <circle cx="16" cy="16" r="14" stroke="#39ff14" strokeWidth="1" opacity="0.2" />
              </svg>
            </div>
            <h3 className="feature-title">Inverted Markets</h3>
            <p className="feature-desc">
              Price = 1/TOKEN_USD. Users deposit the memecoin itself as collateral.
              When price rises, shorts pay longs in the memecoin.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(168, 85, 247, 0.06)", borderColor: "rgba(168, 85, 247, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="4" width="24" height="24" rx="4" stroke="#a855f7" strokeWidth="1.5" opacity="0.3" />
                <path d="M10 16 L14 20 L22 12" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="feature-title">Admin Key Burn</h3>
            <p className="feature-desc">
              Admin is transferred to the system program (1111...1111).
              No one can modify the market parameters. Ever. Truly sovereign.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(0, 240, 255, 0.06)", borderColor: "rgba(0, 240, 255, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="#00f0ff" strokeWidth="1" opacity="0.2" />
                <path d="M16 8 L16 24 M10 16 L22 16" stroke="#00f0ff" strokeWidth="2" fill="none" strokeLinecap="round" />
                <circle cx="16" cy="16" r="6" stroke="#00f0ff" strokeWidth="1" opacity="0.4" />
              </svg>
            </div>
            <h3 className="feature-title">Growing Insurance</h3>
            <p className="feature-desc">
              All trading fees flow to the insurance fund permanently.
              Effectively a continuous soft burn &mdash; tokens locked forever in the vault.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(255, 214, 10, 0.06)", borderColor: "rgba(255, 214, 10, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" stroke="#ffd60a" strokeWidth="1" opacity="0.2" />
                <path d="M10 24 L16 8 L22 24 Z" stroke="#ffd60a" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                <line x1="16" y1="16" x2="16" y2="20" stroke="#ffd60a" strokeWidth="2" strokeLinecap="round" />
                <circle cx="16" cy="22" r="1" fill="#ffd60a" />
              </svg>
            </div>
            <h3 className="feature-title">Permissionless</h3>
            <p className="feature-desc">
              Anyone can list any SPL token. Deploy a slab, deposit collateral,
              burn admin key. Your market runs autonomously on Solana forever.
            </p>
          </div>
        </div>
      </section>

      {/* Ecosystem */}
      <section className="section">
        <h2 className="section-title">The Alienator Ecosystem</h2>
        <div className="features-grid">
          <div className="ecosystem-card eco-green">
            <h3 className="ecosystem-title text-alien">Percolator Core</h3>
            <p className="ecosystem-desc">
              On-chain perpetual futures engine. Single slab account holds all market state.
              ~992KB of pure on-chain logic.
            </p>
          </div>
          <div className="ecosystem-card eco-purple">
            <h3 className="ecosystem-title text-purple">Matcher</h3>
            <p className="ecosystem-desc">
              Off-chain matching engine cranks the on-chain state. Permissionless &mdash; anyone
              can run a matcher and earn rewards.
            </p>
          </div>
          <div className="ecosystem-card eco-cyan">
            <h3 className="ecosystem-title text-cyan">Squads Multisig</h3>
            <p className="ecosystem-desc">
              Pre-burn governance via Squads multisig. After burn, the market is
              fully autonomous &mdash; no governance needed.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-section">
        <h2 className="cta-title gradient-text">
          Ready to trade sovereign perps?
        </h2>
        <p className="cta-desc">
          Connect your wallet, pick a market, and start trading.
          No KYC. No intermediaries. Just you and the chain.
        </p>
        <button className="btn-primary btn-lg" onClick={() => onNavigate("trade")}>
          Launch Terminal
        </button>
      </section>
    </div>
  );
}
