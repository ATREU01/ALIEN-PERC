/**
 * Hook for sending Percolator transactions via wallet adapter.
 * Handles: build → sign → send → confirm → refetch
 *
 * Uses HTTP-polling for confirmation instead of WebSocket subscriptions,
 * because our /api/rpc proxy is HTTP-only (no WebSocket support).
 */
import { useState, useCallback, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { parsePercError } from "../lib/errors";

/**
 * Poll-based transaction confirmation (no WebSocket needed).
 * Uses getSignatureStatuses over HTTP instead of WebSocket subscriptions.
 */
async function pollConfirmTransaction(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
  commitment: "confirmed" | "finalized" = "confirmed",
): Promise<{ err: any } | null> {
  const POLL_INTERVAL_MS = 1000;
  const MAX_POLLS = 90; // 90 seconds max

  for (let i = 0; i < MAX_POLLS; i++) {
    // Check if blockhash has expired
    const blockHeight = await connection.getBlockHeight("confirmed");
    if (blockHeight > lastValidBlockHeight) {
      throw new Error(
        "Transaction expired — blockhash no longer valid. Please try again.",
      );
    }

    const resp = await connection.getSignatureStatuses([signature]);
    const status = resp?.value?.[0];

    if (status) {
      if (status.err) {
        return { err: status.err };
      }
      // Check if we've reached the desired commitment level
      if (commitment === "confirmed" && status.confirmationStatus === "confirmed") return null;
      if (commitment === "confirmed" && status.confirmationStatus === "finalized") return null;
      if (commitment === "finalized" && status.confirmationStatus === "finalized") return null;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error("Transaction confirmation timed out after 2 minutes.");
}

/**
 * Extract a human-readable error from a Solana simulation result.
 */
function extractSimError(logs: string[] | null, err: any): string {
  // Try Percolator-specific error parsing first (maps codes to human-readable messages)
  const percErr = parsePercError(logs, err);
  if (percErr) return percErr;

  // Fallback: scan logs for common patterns
  if (logs) {
    for (const line of logs) {
      if (line.includes("Program log: Error:")) return line.replace("Program log: Error: ", "");
      if (line.includes("insufficient")) return line;
      if (line.includes("already in use")) return "Account already in use";
    }
  }
  if (err) return typeof err === "string" ? err : JSON.stringify(err);
  return "Transaction simulation failed";
}

export type TxStatus = "idle" | "building" | "signing" | "confirming" | "success" | "error";

export interface TxResult {
  signature?: string;
  error?: string;
}

export interface TxHistoryEntry {
  signature: string;
  timestamp: number;
  status: "confirmed" | "failed";
  error?: string;
}

export function usePercolatorTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [txHistory, setTxHistory] = useState<TxHistoryEntry[]>([]);
  const [confirmElapsed, setConfirmElapsed] = useState(0);
  const confirmTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const execute = useCallback(
    async (
      buildFn: () => Promise<{ tx: Transaction; extraSigners?: Keypair[] }>,
      onSuccess?: () => void,
    ): Promise<TxResult> => {
      if (!publicKey || !sendTransaction) {
        const err = "Wallet not connected";
        setLastError(err);
        setStatus("error");
        return { error: err };
      }

      setStatus("building");
      setLastError(null);
      setLastSignature(null);
      setConfirmElapsed(0);
      if (confirmTimerRef.current) {
        clearInterval(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }

      try {
        console.log("[TX] Building transaction...");
        const { tx, extraSigners } = await buildFn();
        console.log("[TX] Built tx with", tx.instructions.length, "instructions");

        // Set recent blockhash and fee payer
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        console.log("[TX] Blockhash:", blockhash.slice(0, 12) + "...", "validUntil:", lastValidBlockHeight);

        // Sign with any extra keypairs (e.g., slab keypair for initMarket)
        if (extraSigners?.length) {
          console.log("[TX] Partial-signing with", extraSigners.length, "extra keypair(s)");
          tx.partialSign(...extraSigners);
        }

        // Log instruction details
        tx.instructions.forEach((ix, i) => {
          console.log(`[TX] ix[${i}] program=${ix.programId.toBase58().slice(0, 8)}... keys=${ix.keys.length} data=${ix.data.length}B`);
        });

        // Simulate first to get detailed error logs (wallet adapter swallows them)
        console.log("[TX] Simulating transaction...");
        const simResult = await connection.simulateTransaction(tx);
        if (simResult.value.err) {
          const errMsg = extractSimError(simResult.value.logs, simResult.value.err);
          console.error("[TX SIM FAILED]", errMsg);
          console.error("[TX SIM LOGS]", simResult.value.logs?.join("\n"));
          console.error("[TX SIM ERR]", JSON.stringify(simResult.value.err));
          setLastError(errMsg);
          setStatus("error");
          setTxHistory((h) => [{ signature: "", timestamp: Date.now(), status: "failed" as const, error: errMsg }, ...h].slice(0, 10));
          return { error: errMsg };
        }
        console.log("[TX] Simulation OK — CU used:", simResult.value.unitsConsumed);
        if (simResult.value.logs) {
          console.log("[TX SIM LOGS]", simResult.value.logs.join("\n"));
        }

        // Refresh blockhash right before wallet signs — prevents expiration
        // during simulation delay, wallet approval delay, and network propagation.
        console.log("[TX] Refreshing blockhash before sending...");
        const { blockhash: freshHash, lastValidBlockHeight: freshValidHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = freshHash;
        // Re-sign with extra keypairs since blockhash changed (invalidates old sigs)
        if (extraSigners?.length) {
          console.log("[TX] Re-signing with", extraSigners.length, "extra keypair(s) for fresh blockhash");
          tx.partialSign(...extraSigners);
        }
        console.log("[TX] Fresh blockhash:", freshHash.slice(0, 12) + "...", "validUntil:", freshValidHeight);

        setStatus("signing");
        console.log("[TX] Requesting wallet signature...");
        // skipPreflight since we already simulated; maxRetries for reliability
        const signature = await sendTransaction(tx, connection, {
          skipPreflight: true,
          maxRetries: 3,
        });
        console.log("[TX] Sent! Signature:", signature);

        setStatus("confirming");
        setConfirmElapsed(0);
        confirmTimerRef.current = setInterval(() => {
          setConfirmElapsed((s) => s + 1);
        }, 1000);
        console.log("[TX] Polling for confirmation (HTTP-based, no WebSocket)...");
        // Use HTTP-polling instead of WebSocket-based confirmTransaction.
        // Our /api/rpc proxy is HTTP-only — WebSocket subscriptions hang forever.
        const confirmError = await pollConfirmTransaction(
          connection,
          signature,
          freshHash,
          freshValidHeight,
          "confirmed",
        );
        if (confirmTimerRef.current) {
          clearInterval(confirmTimerRef.current);
          confirmTimerRef.current = null;
        }

        if (confirmError?.err) {
          const percConfirmErr = parsePercError(null, confirmError.err);
          const errMsg = percConfirmErr || `Transaction failed on-chain: ${JSON.stringify(confirmError.err)}`;
          console.error("[TX CONFIRM FAILED]", errMsg);
          setLastError(errMsg);
          setStatus("error");
          setTxHistory((h) => [{ signature, timestamp: Date.now(), status: "failed" as const, error: errMsg }, ...h].slice(0, 10));
          return { signature, error: errMsg };
        }

        console.log("[TX] CONFIRMED:", signature);
        setLastSignature(signature);
        setStatus("success");
        setTxHistory((h) => [{ signature, timestamp: Date.now(), status: "confirmed" as const }, ...h].slice(0, 10));
        onSuccess?.();

        return { signature };
      } catch (e: any) {
        if (confirmTimerRef.current) {
          clearInterval(confirmTimerRef.current);
          confirmTimerRef.current = null;
        }
        let errMsg = e?.message || "Transaction failed";
        // Try Percolator error parsing from logs or message
        const percErr = parsePercError(e?.logs || null, null);
        if (percErr) {
          errMsg = percErr;
        } else if (errMsg.includes("custom program error")) {
          const logsParsed = parsePercError([errMsg], null);
          if (logsParsed) errMsg = logsParsed;
        }
        // Clean up wallet adapter noise
        errMsg = errMsg
          .replace("WalletSendTransactionError: ", "")
          .replace("Unexpected error", "Transaction failed — check console for details");
        console.error("[TX ERROR]", errMsg, e);
        if (e?.logs) console.error("[TX ERROR LOGS]", e.logs);
        setLastError(errMsg);
        setStatus("error");

        return { error: errMsg };
      }
    },
    [publicKey, sendTransaction, connection],
  );

  const clearStatus = useCallback(() => {
    setStatus("idle");
    setLastError(null);
    setLastSignature(null);
    setConfirmElapsed(0);
  }, []);

  return {
    execute,
    status,
    lastError,
    lastSignature,
    txHistory,
    confirmElapsed,
    clearStatus,
    publicKey,
    connected: !!publicKey,
    connection,
  };
}
