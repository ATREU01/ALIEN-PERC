/**
 * Hook for sending Percolator transactions via wallet adapter.
 * Handles: build → sign → send → confirm → refetch
 *
 * Uses HTTP-polling for confirmation instead of WebSocket subscriptions,
 * because our /api/rpc proxy is HTTP-only (no WebSocket support).
 */
import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, Keypair, PublicKey, type Connection } from "@solana/web3.js";

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
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLLS = 60; // 2 minutes max

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

export type TxStatus = "idle" | "building" | "signing" | "confirming" | "success" | "error";

export interface TxResult {
  signature?: string;
  error?: string;
}

export function usePercolatorTx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<TxStatus>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);

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

      try {
        const { tx, extraSigners } = await buildFn();

        // Set recent blockhash and fee payer
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        // Sign with any extra keypairs (e.g., slab keypair for initMarket)
        if (extraSigners?.length) {
          tx.partialSign(...extraSigners);
        }

        setStatus("signing");
        const signature = await sendTransaction(tx, connection, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        });

        setStatus("confirming");
        // Use HTTP-polling instead of WebSocket-based confirmTransaction.
        // Our /api/rpc proxy is HTTP-only — WebSocket subscriptions hang forever.
        const confirmError = await pollConfirmTransaction(
          connection,
          signature,
          blockhash,
          lastValidBlockHeight,
          "confirmed",
        );

        if (confirmError?.err) {
          const errMsg = `Transaction failed: ${JSON.stringify(confirmError.err)}`;
          setLastError(errMsg);
          setStatus("error");
          return { signature, error: errMsg };
        }

        setLastSignature(signature);
        setStatus("success");
        onSuccess?.();

        // Auto-reset after 5 seconds
        setTimeout(() => setStatus("idle"), 5000);

        return { signature };
      } catch (e: any) {
        let errMsg = e?.message || "Transaction failed";
        // Extract useful info from Solana program errors
        if (errMsg.includes("custom program error")) {
          const match = errMsg.match(/custom program error: (0x[0-9a-fA-F]+)/);
          if (match) errMsg = `Program error: ${match[1]}`;
        }
        // Clean up wallet adapter noise
        errMsg = errMsg
          .replace("WalletSendTransactionError: ", "")
          .replace("Unexpected error", "Transaction simulation failed — check console for details");
        setLastError(errMsg);
        setStatus("error");

        // Auto-reset after 8 seconds
        setTimeout(() => setStatus("idle"), 8000);

        return { error: errMsg };
      }
    },
    [publicKey, sendTransaction, connection],
  );

  return {
    execute,
    status,
    lastError,
    lastSignature,
    publicKey,
    connected: !!publicKey,
    connection,
  };
}
