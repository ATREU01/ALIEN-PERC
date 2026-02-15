import React from "react";

interface HomeProps {
  onNavigate: (route: string) => void;
}

export function Home({ onNavigate }: HomeProps) {
  return (
    <div className="page">
      {/* Hero */}
      <section className="hero">
        <div className="hero-badge">
          <span className="badge-sovereign">SOVEREIGN PERPS</span>
        </div>
        <h1 className="hero-title">
          <span className="gradient-text">ALIEN</span> Percolator
        </h1>
        <p className="hero-subtitle">
          Sovereign perpetual futures on Solana. Admin keys burned.
          Insurance fund compounds forever. No governance. No rugs. Just math.
        </p>
        <div className="hero-actions">
          <button className="btn-primary btn-lg" onClick={() => onNavigate("trade")}>
            Start Trading
          </button>
          <button className="btn-secondary btn-lg" onClick={() => onNavigate("register")}>
            List a Token
          </button>
        </div>

        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-value text-cyan">--</span>
            <span className="hero-stat-label">Total Markets</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value text-purple">--</span>
            <span className="hero-stat-label">Total Value Locked</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value text-green">--</span>
            <span className="hero-stat-label">Insurance Funds</span>
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
            <div className="feature-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="var(--cyan)" strokeWidth="2" opacity="0.3" />
                <path d="M20 8 L20 32 M12 16 L20 8 L28 16" stroke="var(--cyan)" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <h3 className="feature-title">Inverted Markets</h3>
            <p className="feature-desc">
              Price = 1/TOKEN_USD. Users deposit the memecoin itself as collateral.
              When price rises, shorts pay longs in the memecoin.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <rect x="6" y="6" width="28" height="28" rx="4" stroke="var(--purple)" strokeWidth="2" opacity="0.3" />
                <path d="M14 20 L18 24 L26 16" stroke="var(--purple)" strokeWidth="2.5" fill="none" />
              </svg>
            </div>
            <h3 className="feature-title">Admin Key Burn</h3>
            <p className="feature-desc">
              Admin is transferred to the system program (1111...1111).
              No one can modify the market parameters. Ever. Truly sovereign.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="var(--green)" strokeWidth="2" opacity="0.3" />
                <path d="M20 12 L20 28 M14 20 L26 20" stroke="var(--green)" strokeWidth="2" fill="none" />
              </svg>
            </div>
            <h3 className="feature-title">Growing Insurance</h3>
            <p className="feature-desc">
              All trading fees flow to the insurance fund permanently.
              Effectively a continuous soft burn — tokens locked forever in the vault.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="var(--yellow)" strokeWidth="2" opacity="0.3" />
                <path d="M12 28 L20 12 L28 28 Z" stroke="var(--yellow)" strokeWidth="2" fill="none" />
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
        <h2 className="section-title">The ALIEN Ecosystem</h2>
        <div className="features-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div className="glass-card" style={{ padding: "2rem" }}>
            <h3 className="text-cyan" style={{ marginBottom: "0.5rem" }}>Percolator Core</h3>
            <p className="text-muted" style={{ fontSize: "0.9rem" }}>
              On-chain perpetual futures engine. Single slab account holds all market state.
              ~992KB of pure on-chain logic.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "2rem" }}>
            <h3 className="text-purple" style={{ marginBottom: "0.5rem" }}>Matcher</h3>
            <p className="text-muted" style={{ fontSize: "0.9rem" }}>
              Off-chain matching engine cranks the on-chain state. Permissionless — anyone
              can run a matcher and earn rewards.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "2rem" }}>
            <h3 className="text-green" style={{ marginBottom: "0.5rem" }}>Squads Multisig</h3>
            <p className="text-muted" style={{ fontSize: "0.9rem" }}>
              Pre-burn governance via Squads multisig. After burn, the market is
              fully autonomous — no governance needed.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section" style={{ textAlign: "center", padding: "4rem 0" }}>
        <h2 className="gradient-text" style={{ fontSize: "2rem", marginBottom: "1rem" }}>
          Ready to trade sovereign perps?
        </h2>
        <p className="text-muted" style={{ marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
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
