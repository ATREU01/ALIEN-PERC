import React, { useState, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { useMarketDiscovery, useMarketData } from "../hooks/useMarketData";
import { usePercolatorTx } from "../hooks/usePercolatorTx";
import {
  formatBigintE6,
  formatPriceE6,
  formatBps,
  truncateAddress,
} from "../lib/format";
import { getMarketName, MATCHER_PROGRAM_ID } from "../lib/constants";
import {
  findUserAccount,
  buildInitLpTx,
  buildDepositTx,
  buildWithdrawTx,
} from "../lib/transactions";

export function Earn() {
  const { execute, status, lastError, lastSignature, connected, publicKey, connection } = usePercolatorTx();
  const { markets, loading: discovering } = useMarketDiscovery();
  const [selectedVault, setSelectedVault] = useState<string | null>(null);
  const { state, accounts, rawData, refetch } = useMarketData(selectedVault);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  // Find user's LP account on the selected market
  const myLpIdx = useMemo(() => {
    if (!publicKey || !rawData) return null;
    return findUserAccount(rawData, publicKey, "lp");
  }, [publicKey, rawData]);

  const myLpAccount = useMemo(() => {
    if (myLpIdx === null) return null;
    return accounts.find((a) => a.index === myLpIdx) || null;
  }, [myLpIdx, accounts]);

  const lpAccounts = useMemo(
    () => accounts.filter((a) => a.kind === "lp"),
    [accounts],
  );

  const isBusy = status === "building" || status === "signing" || status === "confirming";

  const statusLabel = (() => {
    switch (status) {
      case "building": return "Building tx...";
      case "signing": return "Sign in wallet...";
      case "confirming": return "Confirming...";
      default: return null;
    }
  })();

  // Handle deposit: create LP account if needed, then deposit
  const handleDeposit = async () => {
    if (!publicKey || !selectedVault || !rawData || !depositAmount) return;
    const slab = new PublicKey(selectedVault);
    const amountLamports = BigInt(Math.floor(Number(depositAmount) * 1_000_000_000));

    // If user has no LP account, create one first
    // For simplicity, use the existing matcher program from the first LP or the known matcher
    if (myLpIdx === null) {
      // Find existing matcher context from the first LP, or use default
      const existingLp = accounts.find((a) => a.kind === "lp");
      // For InitLP we need a matcher program + context. On devnet the market
      // already has an LP with a matcher set up. New LPs need their own matcher
      // context. For the UI MVP, we create the LP with the known matcher program.
      // NOTE: In production this would need an atomic matcher context creation.
      const result = await execute(async () => ({
        tx: await buildInitLpTx(
          connection,
          publicKey,
          slab,
          rawData,
          MATCHER_PROGRAM_ID,
          // Use a dummy context for now — the percolator program will validate
          PublicKey.default,
        ),
      }), refetch);
      if (result.error) return;
      await new Promise((r) => setTimeout(r, 2000));
      await refetch();
    }

    // Refetch to get fresh state
    const freshInfo = await connection.getAccountInfo(slab);
    if (!freshInfo) return;
    const freshData = Buffer.from(freshInfo.data);
    const lpIdx = findUserAccount(freshData, publicKey, "lp");
    if (lpIdx === null) return;

    // Deposit
    await execute(async () => ({
      tx: await buildDepositTx(connection, publicKey, slab, freshData, lpIdx, amountLamports),
    }), refetch);

    setDepositAmount("");
  };

  // Handle withdraw
  const handleWithdraw = async () => {
    if (!publicKey || !selectedVault || !rawData || myLpIdx === null || !withdrawAmount) return;
    const slab = new PublicKey(selectedVault);
    const amountLamports = BigInt(Math.floor(Number(withdrawAmount) * 1_000_000_000));

    await execute(async () => ({
      tx: await buildWithdrawTx(connection, publicKey, slab, rawData, myLpIdx, amountLamports),
    }), refetch);

    setWithdrawAmount("");
  };

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
                    {getMarketName(m.state.collateralMint)?.name || truncateAddress(m.state.collateralMint, 6)}
                    {!getMarketName(m.state.collateralMint) && m.state.inverted && (
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

              {/* Expanded: deposit/withdraw + your LP position */}
              {isSelected && (
                <div className="vault-deposit" onClick={(e) => e.stopPropagation()}>
                  {/* Show your LP position if you have one */}
                  {myLpAccount && (
                    <div className="glass-card" style={{ padding: "0.75rem", marginBottom: "1rem", borderColor: "var(--alien-green)" }}>
                      <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "1px", color: "var(--alien-green)", marginBottom: "0.5rem" }}>
                        Your LP Position
                      </div>
                      <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                        <span className="text-muted">Capital</span>
                        <span className="text-cyan">{formatBigintE6(myLpAccount.capital)}</span>
                      </div>
                      <div className="flex-between" style={{ marginBottom: "0.25rem" }}>
                        <span className="text-muted">Net Position</span>
                        <span className={myLpAccount.positionSize > 0n ? "text-green" : myLpAccount.positionSize < 0n ? "text-red" : ""}>
                          {formatBigintE6(myLpAccount.positionSize)}
                        </span>
                      </div>
                      <div className="flex-between">
                        <span className="text-muted">PnL</span>
                        <span className={myLpAccount.pnl >= 0n ? "text-green" : "text-red"}>
                          {formatBigintE6(myLpAccount.pnl)}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Deposit */}
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
                    <button
                      className="btn-deposit"
                      style={{ width: "100%" }}
                      disabled={!depositAmount || Number(depositAmount) <= 0 || isBusy}
                      onClick={handleDeposit}
                    >
                      {isBusy
                        ? statusLabel
                        : myLpIdx === null
                          ? "Create LP & Deposit"
                          : "Deposit to Vault"}
                    </button>
                  ) : (
                    <button className="btn-primary" style={{ width: "100%" }} disabled>
                      Connect Wallet to Deposit
                    </button>
                  )}

                  {/* Withdraw (only if they have an LP) */}
                  {myLpAccount && myLpAccount.capital > 0n && (
                    <div style={{ marginTop: "1rem" }}>
                      <div className="form-group">
                        <label className="form-label">Withdraw Amount</label>
                        <input
                          type="number"
                          className="form-input"
                          placeholder="0.00"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                        />
                      </div>
                      <button
                        className="btn-secondary"
                        style={{ width: "100%" }}
                        disabled={!withdrawAmount || Number(withdrawAmount) <= 0 || isBusy}
                        onClick={handleWithdraw}
                      >
                        {isBusy ? statusLabel : "Withdraw from Vault"}
                      </button>
                    </div>
                  )}

                  {/* Tx feedback */}
                  {status === "success" && lastSignature && (
                    <div className="text-green" style={{ marginTop: "0.5rem", fontSize: "0.8rem", textAlign: "center" }}>
                      Confirmed! <a href={`https://solscan.io/tx/${lastSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="text-cyan">View tx</a>
                    </div>
                  )}
                  {status === "error" && lastError && (
                    <div className="text-red" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                      {lastError.slice(0, 120)}
                    </div>
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

      {/* LP Accounts table */}
      {state && lpAccounts.length > 0 && (
        <section className="section" style={{ marginTop: "2rem" }}>
          <h2 className="section-title">LP Accounts</h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Index</th>
                  <th>Owner</th>
                  <th>Capital</th>
                  <th>PnL</th>
                  <th>Position</th>
                </tr>
              </thead>
              <tbody>
                {lpAccounts.map((acct) => {
                  const isOwner = publicKey && acct.owner === publicKey.toBase58();
                  return (
                    <tr key={acct.index}>
                      <td>#{acct.index}</td>
                      <td>{isOwner ? <span className="text-green">YOU</span> : truncateAddress(acct.owner)}</td>
                      <td className="text-cyan">{formatBigintE6(acct.capital)}</td>
                      <td>
                        <span className={acct.pnl >= 0n ? "text-green" : "text-red"}>
                          {formatBigintE6(acct.pnl)}
                        </span>
                      </td>
                      <td>
                        <span className={acct.positionSize > 0n ? "text-green" : acct.positionSize < 0n ? "text-red" : ""}>
                          {formatBigintE6(acct.positionSize)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
