import React, { useState, useMemo, useEffect } from "react";
import { PublicKey, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { useMarketData, useMarketDiscovery } from "../hooks/useMarketData";
import { usePercolatorTx } from "../hooks/usePercolatorTx";
import {
  formatPriceE6,
  formatBps,
  formatCompact,
  truncateAddress,
  formatBigintE6,
} from "../lib/format";
import { getMarketName, getTokenDecimals } from "../lib/constants";
import {
  findUserAccount,
  findFirstLP,
  buildInitUserTx,
  buildDepositTx,
  buildTradeCpiTx,
  buildKeeperCrankTx,
  buildWithdrawTx,
  buildCloseAccountTx,
  readMint,
} from "../lib/transactions";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { parseAccount as parseAcctRaw, parseMarketState } from "../lib/percolator";

const COMPUTE_BUDGET_ID = ComputeBudgetProgram.programId;
function getNonBudgetIxs(tx: Transaction) {
  return tx.instructions.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET_ID));
}

function combineTxs(txs: Transaction[], cuLimit: number): Transaction {
  const combined = new Transaction();
  combined.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }));
  for (const tx of txs) {
    for (const ix of getNonBudgetIxs(tx)) combined.add(ix);
  }
  return combined;
}

type OrderSide = "long" | "short";

// Dismiss button for feedback cards
const DismissBtn = ({ onClick }: { onClick: () => void }) => (
  <button className="dismiss-btn" onClick={onClick}>x</button>
);

export function Trade() {
  const { execute, status, lastError, lastSignature, txHistory, confirmElapsed, clearStatus, connected, publicKey, connection } = usePercolatorTx();
  const { markets, loading: discovering } = useMarketDiscovery();
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const { state, accounts, rawData, loading, error, refetch } = useMarketData(selectedMarket);

  useEffect(() => {
    if (!selectedMarket && markets.length > 0) setSelectedMarket(markets[0].address);
  }, [markets, selectedMarket]);

  useEffect(() => { setTradePhase(null); }, [selectedMarket]);

  const [orderSide, setOrderSide] = useState<OrderSide>("long");
  const [leverage, setLeverage] = useState(5);
  const [amount, setAmount] = useState("");
  const [positionsTab, setPositionsTab] = useState<"positions" | "orders" | "history">("positions");
  const [tradePhase, setTradePhase] = useState<string | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const userAccounts = useMemo(() => accounts.filter((a) => a.kind === "user"), [accounts]);
  const lpAccounts = useMemo(() => accounts.filter((a) => a.kind === "lp"), [accounts]);

  const myAccount = useMemo(() => {
    if (!publicKey || !rawData) return null;
    const idx = findUserAccount(rawData, publicKey, "user");
    if (idx === null) return null;
    return accounts.find((a) => a.index === idx) || null;
  }, [publicKey, rawData, accounts]);

  const myAccountIdx = useMemo(() => {
    if (!publicKey || !rawData) return null;
    return findUserAccount(rawData, publicKey, "user");
  }, [publicKey, rawData]);

  const tokenDecimals = useMemo(() => state ? getTokenDecimals(state.collateralMint) : 6, [state]);
  const tokenMultiplier = useMemo(() => 10 ** tokenDecimals, [tokenDecimals]);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  async function fetchFreshSlab(slab: PublicKey): Promise<Buffer | null> {
    try {
      const info = await connection.getAccountInfo(slab);
      return info ? Buffer.from(info.data) : null;
    } catch {
      return null;
    }
  }

  // ─── Trade: Deposit + Crank + Trade (one wallet popup) ────────────────────

  const handleTrade = async () => {
    if (!publicKey || !selectedMarket || !rawData || !state || !amount || tradePhase) return;
    const slab = new PublicKey(selectedMarket);
    const amountLamports = BigInt(Math.floor(Number(amount) * tokenMultiplier));
    setTradeError(null);

    try {
      // Create account if needed (separate tx — first time only)
      if (myAccountIdx === null) {
        setTradePhase("Creating account...");
        const result = await execute(async () => ({
          tx: await buildInitUserTx(connection, publicKey, slab, rawData),
        }));
        if (result.error) { setTradePhase(null); return; }
        await new Promise((r) => setTimeout(r, 2000));
        await refetch();
      }

      // Fetch fresh slab
      setTradePhase("Fetching market data...");
      const freshData = await fetchFreshSlab(slab);
      if (!freshData) throw new Error("Failed to fetch market data");

      const userIdx = findUserAccount(freshData, publicKey, "user");
      if (userIdx === null) throw new Error("Account not found after creation");

      const lp = findFirstLP(freshData);
      if (!lp) throw new Error("No LP found — market needs liquidity");

      // Pre-flight: check collateral token balance
      setTradePhase("Checking balance...");
      const mint = readMint(freshData);
      let userTokenBalance = 0n;
      try {
        const userAta = await getAssociatedTokenAddress(mint, publicKey);
        const ataInfo = await getAccount(connection, userAta);
        userTokenBalance = ataInfo.amount;
      } catch { /* ATA doesn't exist — balance is 0 */ }

      const tokenName = getMarketName(state.collateralMint)?.name || "collateral";
      if (userTokenBalance < amountLamports) {
        const have = Number(userTokenBalance) / tokenMultiplier;
        const need = Number(amountLamports) / tokenMultiplier;
        throw new Error(
          `Insufficient ${tokenName} tokens — you have ${have.toFixed(2)} but need ${need.toFixed(2)}. Get more tokens first.`
        );
      }

      // Calculate position size: size = (amount * leverage) * 1e6 / markPrice
      const freshState = parseMarketState(freshData);
      const userAcct = parseAcctRaw(freshData, userIdx);
      const markPrice = freshState.markPriceE6;
      if (markPrice <= 0n) throw new Error("Mark price is zero — market not initialized");

      const sizeRaw = (amountLamports * BigInt(leverage) * 1_000_000n) / markPrice;
      const size = orderSide === "long" ? sizeRaw : -sizeRaw;

      // Pre-flight: verify margin covers
      const expectedNotional = sizeRaw * markPrice / 1_000_000n;
      const expectedMargin = expectedNotional * BigInt(freshState.initialMarginBps) / 10_000n;
      const expectedCapital = (userAcct?.capital ?? 0n) + amountLamports;
      if (expectedMargin > expectedCapital) {
        throw new Error(
          `Insufficient margin — need ${(Number(expectedMargin) / 1e6).toFixed(2)} but will have ${(Number(expectedCapital) / 1e6).toFixed(2)}. Try lower leverage.`
        );
      }

      // Build combined Deposit + Crank + Trade
      setTradePhase("Building trade...");
      await execute(async () => {
        const depositTx = await buildDepositTx(connection, publicKey, slab, freshData, userIdx, amountLamports);
        const crankTx = buildKeeperCrankTx(publicKey, slab, freshData);
        const tradeTx = await buildTradeCpiTx(
          publicKey, slab, freshData,
          lp.idx, lp.owner, lp.matcherProgram, lp.matcherContext,
          userIdx, size,
        );
        return { tx: combineTxs([depositTx, crankTx, tradeTx], 1_400_000) };
      });

      setTradePhase("Updating positions...");
      await new Promise((r) => setTimeout(r, 2000));
      await refetch();
    } catch (e: any) {
      setTradeError(e.message || "Trade failed");
    } finally {
      setTradePhase(null);
    }
  };

  // ─── Withdraw: Crank + Withdraw (one wallet popup) ────────────────────────

  const handleWithdraw = async (acctIdx: number, acctCapital: bigint) => {
    if (!publicKey || !selectedMarket || !rawData) return;
    const slab = new PublicKey(selectedMarket);
    const freshData = await fetchFreshSlab(slab);
    if (!freshData) return;

    await execute(async () => {
      const crankTx = buildKeeperCrankTx(publicKey, slab, freshData);
      const withdrawTx = await buildWithdrawTx(connection, publicKey, slab, freshData, acctIdx, acctCapital);
      return { tx: combineTxs([crankTx, withdrawTx], 1_000_000) };
    }, refetch);
  };

  // ─── Close account (zero everything) ──────────────────────────────────────

  const handleClose = async (acctIdx: number) => {
    if (!publicKey || !selectedMarket || !rawData) return;
    const slab = new PublicKey(selectedMarket);
    await execute(async () => ({
      tx: await buildCloseAccountTx(connection, publicKey, slab, rawData, acctIdx),
    }), refetch);
  };

  // ─── Close position: reverse trade to flatten ─────────────────────────────

  const handleClosePosition = async () => {
    if (!publicKey || !selectedMarket || !rawData || !myAccount || myAccountIdx === null || tradePhase) return;
    if (myAccount.positionSize === 0n) return;

    const slab = new PublicKey(selectedMarket);

    try {
      setTradePhase("Fetching market data...");
      const freshData = await fetchFreshSlab(slab);
      if (!freshData) { setTradePhase(null); return; }

      const userIdx = findUserAccount(freshData, publicKey, "user");
      if (userIdx === null) { setTradePhase(null); return; }

      // Use FRESH on-chain position — not stale React state
      const freshAcct = parseAcctRaw(freshData, userIdx);
      if (!freshAcct || freshAcct.positionSize === 0n) {
        await refetch();
        return;
      }

      const reverseSize = -freshAcct.positionSize;
      const lp = findFirstLP(freshData);
      if (!lp) { setTradePhase(null); return; }

      setTradePhase("Closing position...");
      await execute(async () => {
        const crankTx = buildKeeperCrankTx(publicKey, slab, freshData);
        const tradeTx = await buildTradeCpiTx(
          publicKey, slab, freshData,
          lp.idx, lp.owner, lp.matcherProgram, lp.matcherContext,
          userIdx, reverseSize,
        );
        return { tx: combineTxs([crankTx, tradeTx], 1_400_000) };
      });

      // Wait for chain to settle before clearing tradePhase
      setTradePhase("Updating positions...");
      await new Promise((r) => setTimeout(r, 2000));
      await refetch();
    } catch (e: any) {
      setTradeError(e.message || "Close position failed");
    } finally {
      setTradePhase(null);
    }
  };

  // ─── Derived UI state ─────────────────────────────────────────────────────

  const isBusy = !!tradePhase || status === "building" || status === "signing" || status === "confirming";

  const statusLabel = (() => {
    if (tradePhase) return tradePhase;
    switch (status) {
      case "building": return "Building transaction...";
      case "signing": return "Approve in wallet...";
      case "confirming": return `Confirming${confirmElapsed > 0 ? ` (${confirmElapsed}s)` : "..."}`;
      case "success": return "Confirmed!";
      case "error": return lastError?.slice(0, 60) || "Error";
      default: return null;
    }
  })();

  const maxLeverage = state ? Math.floor(10000 / state.initialMarginBps) : 5;

  const buttonLabel = isBusy
    ? statusLabel
    : !amount || Number(amount) <= 0
      ? "Enter Amount"
      : state?.resolved
        ? "Market Resolved"
        : myAccountIdx === null
          ? `Create Account & ${orderSide === "long" ? "Long" : "Short"}`
          : `Open ${orderSide === "long" ? "Long" : "Short"}`;

  const visibleAccounts = positionsTab === "positions"
    ? userAccounts
    : positionsTab === "orders"
      ? lpAccounts
      : accounts;

  // ─── Liq price estimate ───────────────────────────────────────────────────

  const liqPrice = useMemo(() => {
    if (!myAccount || !state || myAccount.positionSize === 0n || myAccount.capital <= 0n) return null;
    const absSize = myAccount.positionSize > 0n ? myAccount.positionSize : -myAccount.positionSize;
    if (absSize === 0n) return null;
    const capitalPerUnit = myAccount.capital * 1_000_000n / absSize;
    const maintReserve = myAccount.entryPrice * BigInt(state.maintenanceMarginBps) / 10_000n;
    const price = myAccount.positionSize > 0n
      ? myAccount.entryPrice - capitalPerUnit + maintReserve
      : myAccount.entryPrice + capitalPerUnit - maintReserve;
    return price > 0n ? price : null;
  }, [myAccount, state]);

  // ─── Render ───────────────────────────────────────────────────────────────

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
              No markets found. Check your RPC connection or{" "}
              <a href="#register" className="text-cyan">list a new token</a>.
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
                {getMarketName(m.state.collateralMint)?.name || truncateAddress(m.state.collateralMint)}
                {!getMarketName(m.state.collateralMint) && m.state.inverted && " (INV)"}
              </span>
              {m.state.adminBurned
                ? <span className="badge-burned">BURNED</span>
                : <span className="badge-live">ADMIN</span>}
            </div>
            <div className="market-card-stats">
              <div>
                <span className="text-muted">Mark</span>
                <span className="text-cyan">${formatPriceE6(m.state.markPriceE6)}</span>
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

      {/* Loading / error states */}
      {selectedMarket && !state && loading && (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <span className="text-cyan">Loading market data...</span>
        </div>
      )}
      {selectedMarket && !state && !loading && error && (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <span className="text-red">{error}</span>
          <br />
          <button className="btn-secondary" style={{ marginTop: "1rem" }} onClick={refetch}>Retry</button>
        </div>
      )}

      {/* ──── Trading Terminal ──── */}
      {selectedMarket && state && (
        <>
          {/* Stats bar */}
          <div className="stats-grid" style={{ marginBottom: "1.5rem" }}>
            <div className="stat-card">
              <span className="stat-label">Mark Price</span>
              <span className="stat-value text-cyan">${formatPriceE6(state.markPriceE6)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Open Interest</span>
              <span className="stat-value">{formatBigintE6(state.totalOI)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Insurance Fund</span>
              <span className="stat-value text-green">{formatBigintE6(state.insuranceBalance)}</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Fee Revenue</span>
              <span className="stat-value text-purple">{formatBigintE6(state.feeRevenue)}</span>
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

          <div className="terminal-layout">
            {/* ── Order Form ── */}
            <div className="order-form">
              <div className="order-tabs">
                <button className={`order-tab ${orderSide === "long" ? "active-long" : ""}`} onClick={() => setOrderSide("long")}>Long</button>
                <button className={`order-tab ${orderSide === "short" ? "active-short" : ""}`} onClick={() => setOrderSide("short")}>Short</button>
              </div>

              <div className="form-group">
                <label className="form-label">Amount (Collateral)</label>
                <input type="number" className="form-input" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>

              <div className="form-group">
                <label className="form-label">Leverage: <span className="text-cyan">{leverage}x</span></label>
                <input type="range" className="leverage-slider" min="1" max={maxLeverage} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
                <div className="flex-between text-muted" style={{ fontSize: "0.75rem" }}>
                  <span>1x</span>
                  <span>{maxLeverage}x</span>
                </div>
              </div>

              {/* Order summary */}
              <div className="order-summary-card">
                <div className="flex-between"><span className="text-muted">Position Size</span><span>{amount ? formatCompact(Number(amount) * leverage) : "--"}</span></div>
                <div className="flex-between"><span className="text-muted">Trading Fee</span><span>{amount ? formatCompact((Number(amount) * leverage * state.tradingFeeBps) / 10000) : "--"}</span></div>
                <div className="flex-between"><span className="text-muted">Initial Margin</span><span>{formatBps(state.initialMarginBps)}</span></div>
              </div>

              {/* My position */}
              {myAccount && (
                <div className={`position-card ${myAccount.positionSize > 0n ? "position-long" : myAccount.positionSize < 0n ? "position-short" : ""}`}>
                  <div className="flex-between" style={{ marginBottom: "0.5rem" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                      {myAccount.positionSize > 0n ? <span className="text-green">LONG</span>
                        : myAccount.positionSize < 0n ? <span className="text-red">SHORT</span>
                        : <span className="text-muted">NO POSITION</span>}
                    </span>
                    <span className="text-muted" style={{ fontSize: "0.7rem" }}>Account #{myAccount.index}</span>
                  </div>
                  <div className="flex-between"><span className="text-muted">Capital</span><span className="text-cyan">{formatBigintE6(myAccount.capital)}</span></div>
                  {myAccount.positionSize !== 0n && (
                    <>
                      <div className="flex-between">
                        <span className="text-muted">Size</span>
                        <span className={myAccount.positionSize > 0n ? "text-green" : "text-red"}>
                          {formatBigintE6(myAccount.positionSize > 0n ? myAccount.positionSize : -myAccount.positionSize)}
                        </span>
                      </div>
                      <div className="flex-between"><span className="text-muted">Entry Price</span><span>${formatPriceE6(myAccount.entryPrice)}</span></div>
                      <div className="flex-between"><span className="text-muted">Mark Price</span><span className="text-cyan">${formatPriceE6(state.markPriceE6)}</span></div>
                      <div className="flex-between">
                        <span className="text-muted">PnL</span>
                        <span className={myAccount.pnl >= 0n ? "text-green" : "text-red"} style={{ fontWeight: 600 }}>
                          {myAccount.pnl >= 0n ? "+" : ""}{formatBigintE6(myAccount.pnl)}
                        </span>
                      </div>
                      {liqPrice && (
                        <div className="flex-between">
                          <span className="text-muted">Est. Liq. Price</span>
                          <span className="text-red" style={{ fontSize: "0.8rem" }}>${formatPriceE6(liqPrice)}</span>
                        </div>
                      )}
                      <button className="btn-close-position" disabled={isBusy} onClick={handleClosePosition}>
                        {isBusy ? statusLabel : "Close Position"}
                      </button>
                    </>
                  )}
                  {myAccount.positionSize === 0n && myAccount.capital > 0n && (
                    <div className="flex-between">
                      <span className="text-muted">PnL</span>
                      <span className={myAccount.pnl >= 0n ? "text-green" : "text-red"}>{formatBigintE6(myAccount.pnl)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Trade button */}
              {connected ? (
                <button
                  className={orderSide === "long" ? "btn-long" : "btn-short"}
                  disabled={!amount || Number(amount) <= 0 || isBusy || state.resolved}
                  onClick={handleTrade}
                >{buttonLabel}</button>
              ) : (
                <button className="btn-primary" style={{ width: "100%" }} disabled>Connect Wallet</button>
              )}

              {/* Feedback cards */}
              {status === "success" && lastSignature && (
                <div className="feedback-card feedback-success">
                  <div className="flex-between">
                    <span className="text-green" style={{ fontWeight: 600 }}>Trade confirmed!</span>
                    <DismissBtn onClick={clearStatus} />
                  </div>
                  <a href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-cyan" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                    {lastSignature.slice(0, 20)}...{lastSignature.slice(-8)} — View on Solscan
                  </a>
                </div>
              )}
              {status === "confirming" && (
                <div className="feedback-card feedback-pending">
                  <div style={{ textAlign: "center" }}>
                    <span className="text-cyan">Waiting for confirmation...</span>
                    {confirmElapsed > 0 && <span className="text-muted" style={{ marginLeft: "0.5rem" }}>({confirmElapsed}s)</span>}
                  </div>
                  {confirmElapsed > 10 && (
                    <div className="text-muted" style={{ fontSize: "0.7rem", textAlign: "center", marginTop: "0.25rem" }}>
                      Devnet can be slow — your tx was sent
                    </div>
                  )}
                </div>
              )}
              {status === "error" && lastError && (
                <div className="feedback-card feedback-error">
                  <div className="flex-between">
                    <span className="text-red">{lastError.slice(0, 120)}</span>
                    <DismissBtn onClick={clearStatus} />
                  </div>
                </div>
              )}
              {tradeError && (
                <div className="feedback-card feedback-error">
                  <div className="flex-between">
                    <span className="text-red">{tradeError}</span>
                    <DismissBtn onClick={() => setTradeError(null)} />
                  </div>
                </div>
              )}
              {error && <div className="text-red" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>{error}</div>}

              {/* Recent transactions */}
              {txHistory.length > 0 && (
                <div className="tx-history">
                  <span className="tx-history-label">Recent Transactions</span>
                  {txHistory.map((tx, i) => (
                    <div key={tx.signature + i} className="tx-history-row">
                      <span className={tx.status === "confirmed" ? "text-green" : "text-red"} style={{ width: "48px" }}>
                        {tx.status === "confirmed" ? "OK" : "FAIL"}
                      </span>
                      <span className="text-muted">{new Date(tx.timestamp).toLocaleTimeString()}</span>
                      {tx.signature ? (
                        <a href={`https://solscan.io/tx/${tx.signature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-cyan">
                          {tx.signature.slice(0, 8)}...
                        </a>
                      ) : (
                        <span className="text-muted">sim failed</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Positions Table ── */}
            <div className="terminal-main">
              <div className="tabs">
                <button className={`tab ${positionsTab === "positions" ? "active" : ""}`} onClick={() => setPositionsTab("positions")}>
                  Positions <span className="tab-count">{userAccounts.length}</span>
                </button>
                <button className={`tab ${positionsTab === "orders" ? "active" : ""}`} onClick={() => setPositionsTab("orders")}>
                  LP Vaults <span className="tab-count">{lpAccounts.length}</span>
                </button>
                <button className={`tab ${positionsTab === "history" ? "active" : ""}`} onClick={() => setPositionsTab("history")}>
                  All Accounts <span className="tab-count">{accounts.length}</span>
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
                      {connected && <th>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={connected ? 8 : 7} style={{ textAlign: "center", padding: "2rem" }}>
                          <span className="text-muted">{loading ? "Loading accounts..." : "No accounts found"}</span>
                        </td>
                      </tr>
                    ) : (
                      visibleAccounts.map((acct) => {
                        const isOwner = publicKey && acct.owner === publicKey.toBase58();
                        return (
                          <tr key={acct.index}>
                            <td>#{acct.index}</td>
                            <td><span className={acct.kind === "lp" ? "text-purple" : "text-cyan"}>{acct.kind.toUpperCase()}</span></td>
                            <td>{isOwner ? <span className="text-green">YOU</span> : truncateAddress(acct.owner)}</td>
                            <td>{formatBigintE6(acct.capital)}</td>
                            <td><span className={acct.pnl >= 0n ? "text-green" : "text-red"}>{formatBigintE6(acct.pnl)}</span></td>
                            <td>
                              <span className={acct.positionSize > 0n ? "text-green" : acct.positionSize < 0n ? "text-red" : ""}>
                                {formatBigintE6(acct.positionSize)}
                              </span>
                            </td>
                            <td>${formatPriceE6(acct.entryPrice)}</td>
                            {connected && (
                              <td>
                                {isOwner && acct.kind === "user" && acct.capital > 0n && acct.positionSize === 0n && (
                                  <button className="btn-table-action" disabled={isBusy} onClick={() => handleWithdraw(acct.index, acct.capital)}>Withdraw</button>
                                )}
                                {isOwner && acct.kind === "user" && acct.capital === 0n && acct.positionSize === 0n && acct.pnl === 0n && (
                                  <button className="btn-table-action" disabled={isBusy} onClick={() => handleClose(acct.index)}>Close</button>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {!selectedMarket && !discovering && markets.length > 0 && (
        <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
          <h3 className="text-cyan" style={{ marginBottom: "0.5rem" }}>Select a Market</h3>
          <p className="text-muted">Choose a market from the cards above to open the trading terminal.</p>
        </div>
      )}
    </div>
  );
}
