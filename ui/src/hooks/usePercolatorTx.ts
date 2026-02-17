/**
 * Hook for sending Percolator transactions via wallet adapter.
 * Handles: build → sign → send → confirm → refetch
 */
import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction, Keypair, PublicKey } from "@solana/web3.js";

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
        const confirmation = await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed",
        );

        if (confirmation.value.err) {
          const errMsg = `Transaction failed: ${JSON.stringify(confirmation.value.err)}`;
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
