/**
 * Push $Alienator oracle price on devnet
 *
 * Usage:
 *   npx tsx scripts/push-alien-price.ts 0.001        # Set price to $0.001
 *   npx tsx scripts/push-alien-price.ts 0.0025       # Set price to $0.0025
 *   npx tsx scripts/push-alien-price.ts               # Fetches from DexScreener
 */

import "dotenv/config";
import {
  Connection,
  Keypair,
  Transaction,
  PublicKey,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import { encodePushOraclePrice } from "../src/abi/instructions.js";
import { ACCOUNTS_PUSH_ORACLE_PRICE, buildAccountMetas } from "../src/abi/accounts.js";
import { buildIx } from "../src/runtime/tx.js";

const PROGRAM_ID = new PublicKey("2SSnp35m7FQ7cRLNKGdW5UzjYFF6RBUNq7d3m5mqNByp");

async function main() {
  // Load market info
  if (!fs.existsSync("devnet-market.json")) {
    console.error("ERROR: devnet-market.json not found. Run deploy-alien-devnet.ts first.");
    process.exit(1);
  }
  const market = JSON.parse(fs.readFileSync("devnet-market.json", "utf-8"));

  // Load wallet
  const walletPath = process.env.WALLET_PATH || `${process.env.HOME}/.config/solana/id.json`;
  const payer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  let priceUsd: number;
  const arg = process.argv[2];

  if (arg) {
    priceUsd = parseFloat(arg);
    if (isNaN(priceUsd) || priceUsd <= 0) {
      console.error("ERROR: Price must be a positive number");
      process.exit(1);
    }
  } else {
    // Try fetching from DexScreener
    console.log("No price provided. Attempting to fetch from DexScreener...");
    try {
      const ca = market.mainnetCA || process.env.ALIEN_CA || "AWQ5b6KkXKASgEQ9E7zh19fLAZaSFftSBJCQyhJrpump";
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
      const data = await resp.json();
      if (data.pairs && data.pairs.length > 0) {
        priceUsd = parseFloat(data.pairs[0].priceUsd);
        console.log(`  DexScreener price: $${priceUsd}`);
      } else {
        console.error("No pairs found on DexScreener. Provide price as argument.");
        process.exit(1);
      }
    } catch (e) {
      console.error("Failed to fetch from DexScreener. Provide price as argument.");
      process.exit(1);
    }
  }

  const priceE6 = Math.round(priceUsd * 1_000_000);
  console.log(`\nPushing price: $${priceUsd} (${priceE6} e6)`);
  console.log(`Slab: ${market.slab}`);

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const pushData = encodePushOraclePrice({
    priceE6: priceE6.toString(),
    timestamp: timestamp.toString(),
  });
  const pushKeys = buildAccountMetas(ACCOUNTS_PUSH_ORACLE_PRICE, [
    payer.publicKey,
    new PublicKey(market.slab),
  ]);

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }));
  tx.add(buildIx({ programId: PROGRAM_ID, keys: pushKeys, data: pushData }));

  const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
  console.log(`\nPrice updated! Signature: ${sig}`);
}

main().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
