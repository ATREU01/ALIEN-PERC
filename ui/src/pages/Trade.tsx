import React, { useState, useMemo } from "react";
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
} from "../lib/transactions";

/** Filter out ComputeBudgetProgram instructions from a transaction */
const COMPUTE_BUDGET_ID = ComputeBudgetProgram.programId;
function getNonBudgetInstructions(tx: Transaction) {
  return tx.instructions.filter((ix) => !ix.programId.equals(COMPUTE_BUDGET_ID));
}

type OrderSide = "long" | "short";

export function Trade() {
  const { execute, status, lastError, lastSignature, connected, publicKey, connection } = usePercolatorTx();
  const { markets, loading: discovering } = useMarketDiscovery();
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const { state, accounts, rawData, loading, error, refetch } = useMarketData(selectedMarket);

  // Order form state
  const [orderSide, setOrderSide] = useState<OrderSide>("long");
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

  // Find current user's account on this market
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

  // Token decimals for the collateral mint (6 for Alienator, etc.)
  const tokenDecimals = useMemo(() => {
    if (!state) return 6;
    return getTokenDecimals(state.collateralMint);
  }, [state]);

  const tokenMultiplier = useMemo(() => 10 ** tokenDecimals, [tokenDecimals]);

  // Handle trade submission — ONE wallet popup for Deposit+Crank+Trade combined
  const handleTrade = async () => {
    if (!publicKey || !selectedMarket || !rawData || !state || !amount) return;
    const slab = new PublicKey(selectedMarket);
    const amountLamports = BigInt(Math.floor(Number(amount) * tokenMultiplier));
    console.log("[TRADE] Starting trade:", { side: orderSide, amount, leverage, amountLamports: amountLamports.toString(), slab: slab.toBase58() });

    // Step 1: Create account if user doesn't have one (separate tx — only first time ever)
    if (myAccountIdx === null) {
      console.log("[TRADE] No user account found — creating one first (InitUser)...");
      const result = await execute(async () => ({
        tx: await buildInitUserTx(connection, publicKey, slab, rawData),
      }));
      if (result.error) {
        console.error("[TRADE] InitUser FAILED:", result.error);
        return;
      }
      console.log("[TRADE] InitUser confirmed, waiting 2s then refetching slab...");
      await new Promise((r) => setTimeout(r, 2000));
      await refetch();
    }

    // Refetch slab data ONCE to get latest state
    console.log("[TRADE] Fetching fresh slab data...");
    const freshInfo = await connection.getAccountInfo(slab);
    if (!freshInfo) { console.error("[TRADE] Slab account not found!"); return; }
    const freshData = Buffer.from(freshInfo.data);
    console.log("[TRADE] Got slab data:", freshInfo.data.length, "bytes");

    const userIdx = findUserAccount(freshData, publicKey, "user");
    if (userIdx === null) { console.error("[TRADE] User account not found in slab after InitUser!"); return; }
    console.log("[TRADE] User account index:", userIdx);

    const lp = findFirstLP(freshData);
    if (!lp) { console.error("[TRADE] No LP found on this market — cannot trade"); return; }
    console.log("[TRADE] Found LP:", { idx: lp.idx, owner: lp.owner.toBase58(), matcher: lp.matcherProgram.toBase58() });

    // Calculate position size
    const posNotional = Number(amount) * leverage;
    const sizeRaw = BigInt(Math.floor(posNotional * tokenMultiplier));
    const size = orderSide === "long" ? sizeRaw : -sizeRaw;
    console.log("[TRADE] Position size:", { notional: posNotional, sizeRaw: sizeRaw.toString(), signedSize: size.toString() });

    // Build all 3 transactions individually, then combine instructions into ONE tx
    console.log("[TRADE] Building combined Deposit+Crank+Trade transaction...");
    await execute(async () => {
      const depositTx = await buildDepositTx(connection, publicKey, slab, freshData, userIdx, amountLamports);
      console.log("[TRADE]   Deposit instructions:", depositTx.instructions.length);

      const crankTx = buildKeeperCrankTx(publicKey, slab, freshData);
      console.log("[TRADE]   Crank instructions:", crankTx.instructions.length);

      const tradeTx = await buildTradeCpiTx(
        publicKey, slab, freshData,
        lp.idx, lp.owner, lp.matcherProgram, lp.matcherContext,
        userIdx, size,
      );
      console.log("[TRADE]   Trade instructions:", tradeTx.instructions.length);

      // Combine: single compute budget + all real instructions
      const combined = new Transaction();
      combined.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));

      for (const tx of [depositTx, crankTx, tradeTx]) {
        for (const ix of getNonBudgetInstructions(tx)) {
          combined.add(ix);
        }
      }

      console.log("[TRADE] Combined tx total instructions:", combined.instructions.length,
        "(1 compute budget + deposit + crank + trade)");
      return { tx: combined };
    }, refetch);

    console.log("[TRADE] Trade flow complete");
  };

  // Handle withdraw — ONE wallet popup for Crank+Withdraw combined
  const handleWithdraw = async (acctIdx: number, acctCapital: bigint) => {
    if (!publicKey || !selectedMarket || !rawData) return;
    const slab = new PublicKey(selectedMarket);
    console.log("[WITHDRAW] Starting withdraw:", { acctIdx, capital: acctCapital.toString(), slab: slab.toBase58() });

    // Fetch fresh data
    console.log("[WITHDRAW] Fetching fresh slab data...");
    const freshInfo = await connection.getAccountInfo(slab);
    if (!freshInfo) { console.error("[WITHDRAW] Slab account not found!"); return; }
    const freshData = Buffer.from(freshInfo.data);

    // Build combined Crank+Withdraw in ONE transaction
    console.log("[WITHDRAW] Building combined Crank+Withdraw transaction...");
    await execute(async () => {
      const crankTx = buildKeeperCrankTx(publicKey, slab, freshData);
      const withdrawTx = await buildWithdrawTx(connection, publicKey, slab, freshData, acctIdx, acctCapital);

      const combined = new Transaction();
      combined.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));

      for (const tx of [crankTx, withdrawTx]) {
        for (const ix of getNonBudgetInstructions(tx)) {
          combined.add(ix);
        }
      }

      console.log("[WITHDRAW] Combined tx instructions:", combined.instructions.length);
      return { tx: combined };
    }, refetch);

    console.log("[WITHDRAW] Withdraw flow complete");
  };

  // Handle close
  const handleClose = async (acctIdx: number) => {
    if (!publicKey || !selectedMarket || !rawData) return;
    const slab = new PublicKey(selectedMarket);
    await execute(async () => ({
      tx: await buildCloseAccountTx(connection, publicKey, slab, rawData, acctIdx),
    }), refetch);
  };

  const isBusy = status === "building" || status === "signing" || status === "confirming";

  const statusLabel = (() => {
    switch (status) {
      case "building": return "Building tx...";
      case "signing": return "Sign in wallet...";
      case "confirming": return "Confirming...";
      case "success": return "Confirmed!";
      case "error": return lastError?.slice(0, 60) || "Error";
      default: return null;
    }
  })();

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

              {/* My position info */}
              {myAccount && (
                <div className="glass-card" style={{ padding: "0.75rem", marginBottom: "1rem", borderColor: "var(--alien-green)" }}>
                  <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                    <span className="text-muted">Your Capital</span>
                    <span className="text-cyan">{formatBigintE6(myAccount.capital)}</span>
                  </div>
                  <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                    <span className="text-muted">Your Position</span>
                    <span className={myAccount.positionSize > 0n ? "text-green" : myAccount.positionSize < 0n ? "text-red" : ""}>
                      {formatBigintE6(myAccount.positionSize)}
                    </span>
                  </div>
                  <div className="flex-between">
                    <span className="text-muted">Your PnL</span>
                    <span className={myAccount.pnl >= 0n ? "text-green" : "text-red"}>
                      {formatBigintE6(myAccount.pnl)}
                    </span>
                  </div>
                </div>
              )}

              {connected ? (
                <button
                  className={orderSide === "long" ? "btn-long" : "btn-short"}
                  style={{ width: "100%" }}
                  disabled={!amount || Number(amount) <= 0 || isBusy || state.resolved}
                  onClick={handleTrade}
                >
                  {isBusy
                    ? statusLabel
                    : myAccountIdx === null
                      ? `Create Account & ${orderSide === "long" ? "Long" : "Short"}`
                      : `Open ${orderSide === "long" ? "Long" : "Short"}`}
                </button>
              ) : (
                <button className="btn-primary" style={{ width: "100%" }} disabled>
                  Connect Wallet
                </button>
              )}

              {/* Tx feedback */}
              {status === "success" && lastSignature && (
                <div className="text-green" style={{ marginTop: "0.5rem", fontSize: "0.8rem", textAlign: "center" }}>
                  Confirmed! <a href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-cyan">View tx</a>
                </div>
              )}
              {status === "error" && lastError && (
                <div className="text-red" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
                  {lastError.slice(0, 120)}
                </div>
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
                      {connected && <th>Actions</th>}
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
                        <td colSpan={connected ? 8 : 7} style={{ textAlign: "center", padding: "2rem" }}>
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
                      ).map((acct) => {
                        const isOwner = publicKey && acct.owner === publicKey.toBase58();
                        return (
                          <tr key={acct.index}>
                            <td>#{acct.index}</td>
                            <td>
                              <span className={acct.kind === "lp" ? "text-purple" : "text-cyan"}>
                                {acct.kind.toUpperCase()}
                              </span>
                            </td>
                            <td>{isOwner ? <span className="text-green">YOU</span> : truncateAddress(acct.owner)}</td>
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
                            {connected && (
                              <td>
                                {isOwner && acct.kind === "user" && acct.capital > 0n && acct.positionSize === 0n && (
                                  <button
                                    className="btn-secondary"
                                    style={{ padding: "4px 10px", fontSize: "0.7rem" }}
                                    disabled={isBusy}
                                    onClick={() => handleWithdraw(acct.index, acct.capital)}
                                  >
                                    Withdraw
                                  </button>
                                )}
                                {isOwner && acct.kind === "user" && acct.capital === 0n && acct.positionSize === 0n && acct.pnl === 0n && (
                                  <button
                                    className="btn-secondary"
                                    style={{ padding: "4px 10px", fontSize: "0.7rem" }}
                                    disabled={isBusy}
                                    onClick={() => handleClose(acct.index)}
                                  >
                                    Close
                                  </button>
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
