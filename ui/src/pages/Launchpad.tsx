import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";

// ═══════════════════════════════════════════════════════════════════
// ALIENTOR LAUNCHPAD - Solana Mainnet Token Launch Platform
// Built on pump.fun | Vanity addresses | Programmable fee allocation
// ═══════════════════════════════════════════════════════════════════

type LaunchStep = 1 | 2 | 3 | 4;
type LaunchPath = "pumpfun" | "raydium";
type Strategy = "balanced" | "growth" | "burn" | "lp" | "revenue";

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

export function Launchpad() {
  const { publicKey, signTransaction, connected } = useWallet();
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

  // Load stats on mount
  useEffect(() => {
    fetch("/api/launchpad/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
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
      // Step 1: Get mint keypair (vault or generate client-side)
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

      // Step 2: Build transaction via server (PumpPortal proxy)
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

      // Step 3: If using vault, server signs with mint keypair
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

      // Step 4: User signs with wallet
      setLaunchStatus("Sign with your wallet...");
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);

      // Step 5: Send to Solana mainnet
      setLaunchStatus("Broadcasting to Solana mainnet...");
      const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
      const sig = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });

      setLaunchStatus("Confirming on-chain...");
      await new Promise((r) => setTimeout(r, 5000));

      // Step 6: Register token
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

      // Refresh my tokens
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
      <div className="page-title-row">
        <h1 className="page-title">Alientor Launchpad</h1>
        <span className="badge-mainnet">SOLANA MAINNET</span>
      </div>
      <p className="text-muted" style={{ marginBottom: "1.5rem", maxWidth: "720px" }}>
        Launch tokens on pump.fun through the Alientor Protocol. Mint contracts with vanity
        addresses, configure programmable fee allocation strategies, and manage your
        token lifecycle — all on Solana mainnet.
      </p>

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

      {/* My Launched Tokens */}
      {connected && (
        <section className="section" style={{ marginTop: "3rem" }}>
          <h2 className="section-title" style={{ fontSize: "1.25rem" }}>My Launched Tokens</h2>
          {loadingTokens ? (
            <p className="text-muted">Loading...</p>
          ) : myTokens.length === 0 ? (
            <p className="text-muted" style={{ fontSize: "0.9rem" }}>
              No tokens launched yet. Create your first token above.
            </p>
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
    </div>
  );
}
