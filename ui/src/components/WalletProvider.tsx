import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { RPC_ENDPOINT } from "../lib/constants";

// Default wallet adapter styles
import "@solana/wallet-adapter-react-ui/styles.css";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Explicit adapters for mobile deep-link support (Phantom, Solflare, Coinbase).
  // Desktop browser extensions also register via Wallet Standard automatically.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ],
    []
  );

  const connectionConfig = useMemo(
    () => ({
      commitment: "confirmed" as const,
      disableRetryOnRateLimit: true,
    }),
    []
  );

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT} config={connectionConfig}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
