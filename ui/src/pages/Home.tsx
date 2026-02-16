import React, { useState } from "react";
import { useMarketDiscovery } from "../hooks/useMarketData";
import { CONTRACT_ADDRESS, getMarketName } from "../lib/constants";
import { formatBigintE6 } from "../lib/format";

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
  const firstMarket = markets[0];
  const insuranceTotal = markets.reduce((s, m) => s + Number(m.state.insuranceBalance), 0);

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
          <span>ALIEN TEK // PERCOLATOR PROTOCOL</span>
        </div>
        <h1 className="hero-headline gradient-text">
          Memecoin Perpetuals.<br />Powered by Alien Intelligence.
        </h1>
        <p className="hero-sub">
          The first protocol to fuse AI directly into Toly's percolator engine.
          Sovereign perpetual futures where the memecoin <em>is</em> the collateral.
          Admin keys get burned. Insurance fund grows forever. No one controls it.
          Not even us.
        </p>
        <div className="hero-actions">
          <button className="btn-primary btn-lg" onClick={() => onNavigate("trade")}>
            Enter the Terminal
          </button>
          <button className="btn-secondary btn-lg" onClick={() => onNavigate("guide")}>
            How It Works
          </button>
        </div>

        {/* Live Protocol Stats */}
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
            <span className="hero-stat-label">On-Chain Accounts</span>
          </div>
          <div className="hero-stat">
            <span className="hero-stat-value text-purple">
              {totalMarkets > 0
                ? `${markets.filter((m) => m.state.adminBurned).length}/${totalMarkets}`
                : "--"}
            </span>
            <span className="hero-stat-label">Sovereign (Burned)</span>
          </div>
          {firstMarket && (
            <div className="hero-stat">
              <span className="hero-stat-value text-alien">
                {(Number(firstMarket.state.markPriceE6) / 1e6).toFixed(4)}
              </span>
              <span className="hero-stat-label">Mark Price</span>
            </div>
          )}
        </div>

        {/* Contract Address */}
        <div className="ca-section" style={{ padding: "28px 0" }}>
          <p className="ca-label">$ALIENATOR</p>
          {CONTRACT_ADDRESS ? (
            <>
              <div className="ca-box" onClick={copyCA} title="Click to copy">
                <span className="ca-address">{CONTRACT_ADDRESS}</span>
                <button className={`ca-copy-btn ${copied ? "ca-copied" : ""}`}>
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
              <p className="text-muted" style={{ fontSize: "0.75rem", marginTop: "12px" }}>
                Bonded on{" "}
                <a
                  href={`https://pump.fun/coin/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan"
                >
                  pump.fun
                </a>
                {" "}// Verify on{" "}
                <a
                  href={`https://solscan.io/token/${CONTRACT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan"
                >
                  Solscan
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
      </section>

      {/* What Makes This Different */}
      <section className="section">
        <h2 className="section-title">Not Another DEX. This Is Different.</h2>
        <p className="section-subtitle text-muted">
          Built on Anatoly Yakovenko's percolator architecture. One slab. 992KB. Everything on-chain.
        </p>

        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(57, 255, 20, 0.06)", borderColor: "rgba(57, 255, 20, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 4 L16 28 M8 12 L16 4 L24 12" stroke="#39ff14" strokeWidth="2" fill="none" strokeLinecap="round" />
                <circle cx="16" cy="16" r="14" stroke="#39ff14" strokeWidth="1" opacity="0.2" />
              </svg>
            </div>
            <h3 className="feature-title">Inverted Perpetuals</h3>
            <p className="feature-desc">
              You deposit the memecoin. You trade USD contracts. Price = 1/TOKEN.
              When your coin pumps, your long prints in the coin itself. This is how memecoins should trade.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(168, 85, 247, 0.06)", borderColor: "rgba(168, 85, 247, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <rect x="4" y="4" width="24" height="24" rx="4" stroke="#a855f7" strokeWidth="1.5" opacity="0.3" />
                <path d="M10 16 L14 20 L22 12" stroke="#a855f7" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="feature-title">Burn the Keys</h3>
            <p className="feature-desc">
              Admin key transferred to <span className="text-alien" style={{ fontFamily: "var(--font-mono)", fontSize: "0.78em" }}>1111...1111</span>.
              Nobody can pause it. Nobody can change the rules. Nobody can rug. The market becomes a permanent fixture of Solana.
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
            <h3 className="feature-title">Infinite Insurance</h3>
            <p className="feature-desc">
              Every trade pays a fee. Every fee goes to insurance. After burn, nobody can withdraw it.
              The fund only grows. Forever. A permanent soft burn built into the protocol.
            </p>
          </div>

          <div className="feature-card">
            <div className="feature-icon" style={{ background: "rgba(57, 255, 20, 0.06)", borderColor: "rgba(57, 255, 20, 0.15)" }}>
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <ellipse cx="16" cy="13" rx="10" ry="11" stroke="#39ff14" strokeWidth="1.5" fill="none" />
                <ellipse cx="12" cy="11" rx="2" ry="3" fill="#39ff14" opacity="0.5" />
                <ellipse cx="20" cy="11" rx="2" ry="3" fill="#39ff14" opacity="0.5" />
                <path d="M12 18 Q16 21 20 18" stroke="#39ff14" strokeWidth="1" fill="none" opacity="0.4" />
                <circle cx="16" cy="26" r="3" stroke="#39ff14" strokeWidth="1" fill="none" opacity="0.3" />
                <line x1="16" y1="24" x2="16" y2="23" stroke="#39ff14" strokeWidth="1" opacity="0.3" />
              </svg>
            </div>
            <h3 className="feature-title">Alien Intelligence</h3>
            <p className="feature-desc">
              AI wired into the protocol. Reads live on-chain state &mdash; mark price, open interest,
              insurance levels &mdash; in real-time. Helps you understand what's happening. First of its kind.
            </p>
          </div>
        </div>
      </section>

      {/* The Stack */}
      <section className="section">
        <h2 className="section-title">The Stack</h2>
        <p className="section-subtitle text-muted">
          Every layer purpose-built. No bloat. No middlemen. Pure protocol.
        </p>
        <div className="stack-grid">
          <div className="stack-item">
            <div className="stack-layer">L1</div>
            <div className="stack-info">
              <h4 className="text-alien">Percolator Slab</h4>
              <p>992KB on-chain account. Orderbook, matching engine, insurance, 4096 trader slots &mdash; all in one.</p>
            </div>
          </div>
          <div className="stack-item">
            <div className="stack-layer stack-layer-cyan">L2</div>
            <div className="stack-info">
              <h4 className="text-cyan">Permissionless Matcher</h4>
              <p>Anyone cranks the on-chain state. Run a matcher, earn fees. No special access needed.</p>
            </div>
          </div>
          <div className="stack-item">
            <div className="stack-layer stack-layer-purple">L3</div>
            <div className="stack-info">
              <h4 className="text-purple">Hyperp Oracle</h4>
              <p>Push-based price feed with 10% circuit breaker. Fast, simple, manipulation-resistant.</p>
            </div>
          </div>
          <div className="stack-item">
            <div className="stack-layer">AI</div>
            <div className="stack-info">
              <h4 className="text-alien">Protocol Intelligence</h4>
              <p>Live on-chain awareness. The AI reads market state from the slab and gives you real answers, not generic chatbot filler.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Live Market Preview */}
      {firstMarket && (
        <section className="section">
          <h2 className="section-title">Live on Solana</h2>
          <p className="section-subtitle text-muted">
            Real on-chain data. Devnet deployment active. Mainnet soon.
          </p>
          <div className="live-market-card" onClick={() => onNavigate("trade")}>
            <div className="live-market-header">
              <div>
                <h3 className="text-alien">{getMarketName(firstMarket.state.collateralMint)?.name || "Market"}</h3>
                <span className="text-muted" style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                  Inverted Perpetual
                </span>
              </div>
              <div className="live-market-status">
                <span className="pulse-dot" />
                <span className="text-alien" style={{ fontSize: "0.75rem", letterSpacing: "2px" }}>LIVE</span>
              </div>
            </div>
            <div className="live-market-stats">
              <div>
                <span className="text-muted">Mark Price</span>
                <span className="text-primary" style={{ fontFamily: "var(--font-mono)" }}>
                  {(Number(firstMarket.state.markPriceE6) / 1e6).toFixed(6)}
                </span>
              </div>
              <div>
                <span className="text-muted">Open Interest</span>
                <span className="text-cyan" style={{ fontFamily: "var(--font-mono)" }}>
                  {formatBigintE6(firstMarket.state.totalOI)}
                </span>
              </div>
              <div>
                <span className="text-muted">Insurance Fund</span>
                <span className="text-purple" style={{ fontFamily: "var(--font-mono)" }}>
                  {formatBigintE6(firstMarket.state.insuranceBalance)}
                </span>
              </div>
              <div>
                <span className="text-muted">Traders</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {firstMarket.state.numAccounts}
                </span>
              </div>
            </div>
            <p className="live-market-cta text-muted">Click to trade &rarr;</p>
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="cta-section">
        <h2 className="cta-title gradient-text">
          The future of memecoin trading is sovereign.
        </h2>
        <p className="cta-desc">
          No KYC. No intermediaries. No admin keys. Just you, the chain, and alien intelligence.
        </p>
        <div className="hero-actions">
          <button className="btn-primary btn-lg" onClick={() => onNavigate("trade")}>
            Enter the Terminal
          </button>
          <button className="btn-secondary btn-lg" onClick={() => onNavigate("register")}>
            List Your Token
          </button>
        </div>
      </section>
    </div>
  );
}
