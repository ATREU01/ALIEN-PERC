import React from "react";

interface GuideProps {
  onNavigate?: (route: string) => void;
}

const STEPS = [
  {
    icon: "01",
    title: "Connect Your Wallet",
    body: `Install Phantom (phantom.app) or any Solana wallet. Click "Select Wallet" in the top-right corner. Important: switch your wallet to Devnet in Settings > Developer Settings > Change Network > Devnet. This is a testnet — no real money involved.`,
  },
  {
    icon: "02",
    title: "Get Devnet SOL",
    body: `You need free testnet SOL to interact with the protocol. Go to faucet.solana.com, paste your wallet address, select "Devnet", and request an airdrop. You can request up to 5 SOL at a time. This is free fake money for testing.`,
    link: { href: "https://faucet.solana.com", label: "Open Solana Faucet" },
  },
  {
    icon: "03",
    title: "Trade Perpetual Futures",
    body: `Go to the Trade page. Select the Alienator / USD market. Choose Long (bet price goes up) or Short (bet price goes down). Set your leverage with the slider and enter your collateral amount. This is an inverted perpetual — you deposit the memecoin as collateral and trade USD-denominated contracts. When the token pumps, shorts get liquidated. When it dumps, longs get wrecked.`,
    nav: "trade",
  },
  {
    icon: "04",
    title: "Earn as a Liquidity Provider",
    body: `Go to the Earn page. LPs provide liquidity to the market by depositing collateral into vaults. LPs absorb counterparty risk from traders and earn a share of trading fees. The passive matcher runs with a 50bps spread, meaning LPs earn on every trade that matches against their liquidity.`,
    nav: "earn",
  },
  {
    icon: "05",
    title: "List Any Token",
    body: `Go to the Register page. Anyone can deploy a new perpetual futures market for any SPL token. Enter the token mint address, configure risk parameters (margins, fees), and deploy. The cost is approximately 10 SOL (mostly rent for the 992KB on-chain slab). No permission needed, no listing fees, no committee — fully permissionless.`,
    nav: "register",
  },
  {
    icon: "06",
    title: "Explore On-Chain Data",
    body: `The Indexer page lets you inspect any percolator market in real-time. View market state (mark price, open interest, insurance fund), browse individual accounts (traders and LPs), inspect insurance fund growth, and review configuration parameters. All data is read directly from the Solana blockchain — no backend, no indexer, no API.`,
    nav: "indexer",
  },
  {
    icon: "07",
    title: "Insurance Fund (Soft Burn)",
    body: `Every trade pays a fee that flows directly into the market's insurance fund. After the admin key is burned, nobody can withdraw from this fund — ever. The tokens are permanently locked on-chain. More trading volume means more tokens locked forever. This creates continuous deflationary pressure — a soft burn that grows with every fill.`,
  },
  {
    icon: "08",
    title: "Admin Key Burn",
    body: `The admin key controls market parameters (fees, margins, oracle). When the admin key is burned — transferred to the Solana system program (1111...1111) — no one can change anything. The market becomes truly sovereign: no governance votes, no multisig, no emergency pauses. It runs on math alone, forever. This is irreversible by design.`,
  },
];

export function Guide({ onNavigate }: GuideProps) {
  return (
    <div className="page">
      <div className="page-title-row">
        <h1 className="page-title">Guide</h1>
        <span className="badge-new">DEVNET BETA</span>
      </div>

      {/* Intro */}
      <div className="guide-intro">
        <h2>What is Alienator?</h2>
        <p>
          Alienator is a sovereign perpetual futures protocol built on Solana using the Percolator engine.
          It enables leveraged trading on memecoins with no intermediaries, no admin keys, and no governance.
          The entire market state — orderbook, positions, insurance fund, matching engine — lives in a single
          992KB on-chain account called a <strong>slab</strong>.
        </p>
        <p>
          This is currently deployed on <strong>Solana Devnet</strong> for testing. No real funds are involved.
          Everything you see is running on testnet with fake SOL.
        </p>
        <div className="guide-network-info">
          <span className="beta-dot" />
          <span>Network: <strong>Solana Devnet</strong></span>
          <span className="text-muted">|</span>
          <span>Status: <strong className="text-green">Live</strong></span>
          <span className="text-muted">|</span>
          <span>Cost: <strong>Free (testnet)</strong></span>
        </div>
      </div>

      {/* Steps */}
      <div className="guide-steps">
        {STEPS.map((step, i) => (
          <div key={i} className="guide-card">
            <div className="guide-card-icon">{step.icon}</div>
            <div className="guide-card-content">
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {step.link && (
                <a
                  href={step.link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="guide-link"
                >
                  {step.link.label} &rarr;
                </a>
              )}
              {step.nav && onNavigate && (
                <button
                  className="guide-link-btn"
                  onClick={() => onNavigate(step.nav!)}
                >
                  Go to {step.title.split(" ").pop()} &rarr;
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Architecture */}
      <div className="guide-section">
        <h2>How the Percolator Works</h2>
        <div className="guide-arch-grid">
          <div className="glass-card" style={{ padding: "1.5rem" }}>
            <h4 className="text-cyan">The Slab</h4>
            <p className="text-muted">
              A 992KB Solana account that holds the entire market. Orderbook, 4096 account slots,
              insurance fund, matching engine config — all packed into one account. One RPC call
              gives you everything.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "1.5rem" }}>
            <h4 className="text-purple">The Matcher</h4>
            <p className="text-muted">
              Permissionless matching engine. Anyone can run a crank to fill resting orders.
              No privileged relayer, no MEV auction. You see an order, you match it, you earn the fee.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "1.5rem" }}>
            <h4 className="text-green">The Oracle</h4>
            <p className="text-muted">
              Push-based oracle with a circuit breaker (max 10% price change per update).
              In Hyperp mode, the admin pushes prices directly. After burn, the oracle
              authority is also locked.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
