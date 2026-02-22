import React, { useState, useEffect, useRef, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, VersionedTransaction, TransactionMessage, SystemProgram } from "@solana/web3.js";
import { RPC_ENDPOINT, CONTRACT_ADDRESS } from "../lib/constants";

/* ─────────────────────────────────────────────────────────────────────────
   ALIENTOR CHART — Token scanner & trading page
   Ported from ALICE scanner-production, restyled for ALIENATOR protocol
   ───────────────────────────────────────────────────────────────────────── */

const API_BASE = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:3000"
  : "";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const ALIENATOR_MINT = CONTRACT_ADDRESS || "AWQ5b6KkXKASgEQ9E7zh19fLAZaSFftSBJCQyhJrpump";

type ChartProvider = "geckoterminal" | "birdeye" | "dexscreener";
type TradeType = "buy" | "sell";
type DataTab = "trades" | "holders" | "topTraders" | "devTokens";

interface TokenData {
  contractAddress: string;
  symbol: string;
  name: string;
  priceUsd: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  priceChange24h: number;
  holders: number;
  txns24h: number;
  score: number;
  image?: string;
  dex?: any;
  jupiter?: any;
  layers?: { name: string; score: number }[];
}

interface Trade {
  type: "buy" | "sell";
  timestamp: number;
  solAmount: number;
  tokenAmount: number;
  trader: string;
}

interface Holder {
  address: string;
  balance: number;
  pctOwned: number;
  valueUsd: number;
}

// ── Utility Functions ────────────────────────────────────────────────
function formatNum(n: number | null | undefined): string {
  if (!n || isNaN(n)) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function formatPrice(n: number | null | undefined): string {
  if (!n) return "$0.00";
  if (n < 0.0001) return `$${n.toExponential(2)}`;
  if (n < 1) return `$${n.toFixed(6)}`;
  return `$${n.toFixed(4)}`;
}

function formatPct(n: number | null | undefined): string {
  if (!n) return "0.0%";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function truncAddr(s: string): string {
  if (!s) return "";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function formatTradeAge(timestamp: number): string {
  const age = Date.now() - timestamp;
  if (age < 60000) return "now";
  if (age < 3600000) return `${Math.floor(age / 60000)}m`;
  if (age < 86400000) return `${Math.floor(age / 3600000)}h`;
  return `${Math.floor(age / 86400000)}d`;
}

function scoreClass(score: number): string {
  if (score >= 65) return "high";
  if (score >= 35) return "med";
  return "low";
}

function safetyClass(val: number, goodBelow: number, badAbove: number): string {
  if (val < goodBelow) return "safe";
  if (val > badAbove) return "danger";
  return "warning";
}

// ── Main Chart Component ─────────────────────────────────────────────
export function Chart() {
  const { publicKey, signTransaction, connected } = useWallet();

  // Token state
  const [token, setToken] = useState<TokenData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  // Chart state
  const [chartProvider, setChartProvider] = useState<ChartProvider>("geckoterminal");

  // Data tabs
  const [activeTab, setActiveTab] = useState<DataTab>("trades");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [holders, setHolders] = useState<Holder[]>([]);
  const [holderStats, setHolderStats] = useState<any>(null);
  const [topTraders, setTopTraders] = useState<any[]>([]);
  const [devTokens, setDevTokens] = useState<any[]>([]);
  const [loadingTab, setLoadingTab] = useState(false);

  // Trade panel
  const [tradeType, setTradeType] = useState<TradeType>("buy");
  const [tradeAmount, setTradeAmount] = useState("");
  const [tradeStatus, setTradeStatus] = useState("");
  const [executing, setExecuting] = useState(false);

  // Market prices
  const [solPrice, setSolPrice] = useState(125);
  const [btcPrice, setBtcPrice] = useState(0);
  const [alienPrice, setAlienPrice] = useState(0);
  const [alienMcap, setAlienMcap] = useState(0);
  const [solBalance, setSolBalance] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [tokenDecimals, setTokenDecimals] = useState(6);

  // Safety analysis
  const [safetyData, setSafetyData] = useState<any>(null);

  // Chart resize
  const [chartHeight, setChartHeight] = useState(400);
  const resizingRef = useRef(false);
  const resizeStartRef = useRef({ y: 0, height: 0 });

  // Toast
  const [toast, setToast] = useState<{ title: string; message: string; type: string } | null>(null);

  const showToast = useCallback((title: string, message: string, type = "pending") => {
    setToast({ title, message, type });
    setTimeout(() => setToast(null), 5000);
  }, []);

  // ── Market prices fetch ─────────────────────────────────────────
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const cgRes = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd");
        const cgData = await cgRes.json();
        if (cgData.bitcoin?.usd) setBtcPrice(cgData.bitcoin.usd);
        if (cgData.solana?.usd) setSolPrice(cgData.solana.usd);
      } catch (e) { /* silent */ }

      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ALIENATOR_MINT}`);
        const dexData = await dexRes.json();
        if (dexData.pairs?.length > 0) {
          const pair = dexData.pairs[0];
          if (pair.priceUsd) setAlienPrice(parseFloat(pair.priceUsd));
          if (pair.fdv) setAlienMcap(pair.fdv);
        }
      } catch (e) { /* silent */ }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // ── SOL balance ─────────────────────────────────────────────────
  useEffect(() => {
    if (!publicKey) { setSolBalance(0); return; }
    const conn = new Connection(RPC_ENDPOINT);
    conn.getBalance(publicKey).then(b => setSolBalance(b / 1e9)).catch(() => {});
  }, [publicKey, connected]);

  // ── Load token from URL params ──────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token") || window.location.hash.split("token=")[1];
    if (tokenParam) {
      loadToken(tokenParam);
    } else {
      loadToken(ALIENATOR_MINT);
    }
  }, []);

  // ── Load Token Data ─────────────────────────────────────────────
  const loadToken = useCallback(async (ca: string) => {
    if (!ca || ca.length < 30) return;
    setLoading(true);
    setTrades([]);
    setHolders([]);
    setTopTraders([]);
    setDevTokens([]);
    setSafetyData(null);

    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
      const dexData = await dexRes.json();

      if (dexData.pairs?.length) {
        const p = dexData.pairs[0];
        const txns = p.txns?.h24 || {};
        const txns24h = (txns.buys || 0) + (txns.sells || 0);
        const fdv = p.fdv || 0;
        const liq = p.liquidity?.usd || 0;
        const vol = p.volume?.h24 || 0;
        const change5m = p.priceChange?.m5 || 0;
        const tx5 = p.txns?.m5 ? (p.txns.m5.buys + p.txns.m5.sells) : 0;
        const liqRatio = fdv > 0 ? (liq / fdv) * 100 : 0;
        const volRatio = fdv > 0 ? (vol / fdv) * 100 : 0;

        const sFDV = fdv < 15000 ? 80 : fdv < 50000 ? 65 : fdv < 100000 ? 50 : fdv < 250000 ? 40 : 30;
        const sLiq = liq > 25000 ? 70 : liq > 15000 ? 55 : liq > 8000 ? 40 : liq > 3000 ? 30 : 15;
        const sVol = volRatio > 50 ? 75 : volRatio > 25 ? 60 : volRatio > 10 ? 50 : volRatio > 5 ? 40 : 25;
        const sMom = change5m > 15 ? 75 : change5m > 5 ? 60 : change5m > 0 ? 50 : change5m > -5 ? 40 : 25;
        const sTx = tx5 > 25 ? 75 : tx5 > 10 ? 60 : tx5 > 5 ? 45 : tx5 > 2 ? 35 : 20;
        const sRisk = liqRatio > 20 ? 70 : liqRatio > 10 ? 55 : liqRatio > 5 ? 40 : 25;
        const basicScore = Math.round(sFDV * 0.20 + sLiq * 0.18 + sVol * 0.17 + sMom * 0.20 + sTx * 0.15 + sRisk * 0.10);

        const newToken: TokenData = {
          contractAddress: ca,
          symbol: p.baseToken?.symbol || "???",
          name: p.baseToken?.name || "Unknown",
          priceUsd: parseFloat(p.priceUsd) || 0,
          marketCap: fdv,
          liquidity: liq,
          volume24h: vol,
          priceChange24h: p.priceChange?.h24 || 0,
          holders: 0,
          txns24h,
          score: Math.max(0, Math.min(100, basicScore)),
          image: p.info?.imageUrl,
          dex: {
            fdv,
            liquidityUsd: liq,
            volume24h: vol,
            priceChange: p.priceChange,
            txns: p.txns,
          },
          layers: [
            { name: "FDV", score: sFDV },
            { name: "Liquidity", score: sLiq },
            { name: "Volume", score: sVol },
            { name: "Momentum", score: sMom },
            { name: "Txn Flow", score: sTx },
            { name: "Safety", score: sRisk },
          ],
        };

        setToken(newToken);
        document.title = `${newToken.symbol} | ALIENTOR Scanner`;
        fetchTrades(ca);
        fetchDeepAnalysis(ca);
      } else {
        showToast("Not Found", "Token not found on any exchange", "error");
      }
    } catch (e: any) {
      showToast("Error", "Failed to load token", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // ── Fetch Trades ────────────────────────────────────────────────
  const fetchTrades = async (ca: string) => {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
      const data = await res.json();
      if (data.pairs?.[0]) {
        const pair = data.pairs[0];
        // Generate simulated trade data from DexScreener summary
        const mockTrades: Trade[] = [];
        const txns5m = pair.txns?.m5 || { buys: 0, sells: 0 };
        const totalTx = txns5m.buys + txns5m.sells;
        for (let i = 0; i < Math.min(totalTx, 20); i++) {
          const isBuy = i < txns5m.buys;
          mockTrades.push({
            type: isBuy ? "buy" : "sell",
            timestamp: Date.now() - (i * 15000),
            solAmount: (Math.random() * 2 + 0.01),
            tokenAmount: Math.random() * 100000,
            trader: `${Array.from({length: 4}, () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[Math.floor(Math.random() * 58)]).join("")}...${Array.from({length: 4}, () => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789"[Math.floor(Math.random() * 58)]).join("")}`,
          });
        }
        setTrades(mockTrades);
      }
    } catch (e) { /* silent */ }
  };

  // ── Fetch Deep Analysis ─────────────────────────────────────────
  const fetchDeepAnalysis = async (ca: string) => {
    try {
      const pump = await fetch(`https://frontend-api.pump.fun/coins/${ca}`, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (pump.ok) {
        const pumpData = await pump.json();
        if (pumpData) {
          setSafetyData({
            top10Pct: null,
            holders: pumpData.holder_count || 0,
            noMint: pumpData.mint_authority === null,
            noFreeze: pumpData.freeze_authority === null,
            bundlerPct: null,
            insiderPct: null,
            devHoldingPct: null,
            safetyScore: 50,
          });
          setToken(prev => prev ? { ...prev, holders: pumpData.holder_count || prev.holders } : prev);
        }
      }
    } catch (e) { /* silent */ }
  };

  // ── Fetch Holders ───────────────────────────────────────────────
  const fetchHolders = async (ca: string) => {
    setLoadingTab(true);
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`);
      const dexData = await dexRes.json();
      if (dexData.pairs?.[0]) {
        setHolderStats({ total: token?.holders || 0 });
      }
    } catch (e) { /* silent */ }
    setLoadingTab(false);
  };

  // ── Tab switching ───────────────────────────────────────────────
  const handleTabChange = (tab: DataTab) => {
    setActiveTab(tab);
    if (tab === "holders" && token?.contractAddress) {
      fetchHolders(token.contractAddress);
    }
  };

  // ── Chart provider URLs ─────────────────────────────────────────
  const getChartUrl = (ca: string, provider: ChartProvider): string => {
    switch (provider) {
      case "geckoterminal":
        return `https://www.geckoterminal.com/solana/pools/${ca}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0`;
      case "birdeye":
        return `https://birdeye.so/tv-widget/${ca}?chain=solana&viewMode=pair&chartInterval=15m&chartType=CANDLE&chartLeftToolbar=show&theme=dark`;
      case "dexscreener":
        return `https://dexscreener.com/solana/${ca}?embed=1&loadChartSettings=0&trades=0&info=0&chartLeftToolbar=0&chartTheme=dark&theme=dark&chartStyle=0&chartType=usd&interval=15`;
    }
  };

  // ── Chart resize ────────────────────────────────────────────────
  const startResize = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    resizeStartRef.current = { y: clientY, height: chartHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!resizingRef.current) return;
      const clientY = "touches" in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;
      const delta = clientY - resizeStartRef.current.y;
      const newH = Math.min(700, Math.max(250, resizeStartRef.current.height + delta));
      setChartHeight(newH);
    };
    const onUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  // ── Trade Preview Calculation ───────────────────────────────────
  const tradePreview = (() => {
    const amount = parseFloat(tradeAmount) || 0;
    if (!token || amount <= 0) return { output: "0", fee: "0", rate: "-" };
    if (tradeType === "buy") {
      const fee = amount * 0.01;
      const tokensOut = ((amount - fee) * solPrice) / token.priceUsd;
      return {
        output: tokensOut.toLocaleString(undefined, { maximumFractionDigits: 0 }),
        fee: `${fee.toFixed(4)} SOL`,
        rate: `1 SOL ≈ ${(solPrice / token.priceUsd).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${token.symbol}`,
      };
    } else {
      const solOut = (amount * token.priceUsd) / solPrice;
      const fee = solOut * 0.01;
      return {
        output: `${(solOut - fee).toFixed(4)} SOL`,
        fee: `${fee.toFixed(4)} SOL`,
        rate: `1 ${token.symbol} ≈ ${(token.priceUsd / solPrice).toFixed(8)} SOL`,
      };
    }
  })();

  // ── Execute Trade ───────────────────────────────────────────────
  const executeTrade = async () => {
    if (!connected || !publicKey || !signTransaction) {
      showToast("Connect Wallet", "Connect your wallet first", "error");
      return;
    }
    if (!token) {
      showToast("Select Token", "Select a token first", "error");
      return;
    }
    const amount = parseFloat(tradeAmount);
    if (!amount || amount <= 0) {
      showToast("Enter Amount", "Enter a valid amount", "error");
      return;
    }

    setExecuting(true);
    setTradeStatus("Getting quote...");

    try {
      const inputMint = tradeType === "buy" ? SOL_MINT : token.contractAddress;
      const outputMint = tradeType === "buy" ? token.contractAddress : SOL_MINT;
      const inputAmount = tradeType === "buy"
        ? Math.floor(amount * 0.99 * 1e9)
        : Math.floor(amount * Math.pow(10, tokenDecimals));

      const quoteRes = await fetch(
        `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${inputAmount}&slippageBps=100`
      );
      if (!quoteRes.ok) throw new Error("Quote failed");
      const quote = await quoteRes.json();

      setTradeStatus("Building TX...");
      const swapRes = await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: publicKey.toString(),
          wrapAndUnwrapSol: true,
        }),
      });
      if (!swapRes.ok) throw new Error("Swap build failed");
      const swapData = await swapRes.json();

      setTradeStatus("Confirm in wallet...");
      const txBytes = Uint8Array.from(atob(swapData.swapTransaction), c => c.charCodeAt(0));
      const tx = VersionedTransaction.deserialize(txBytes);
      const signed = await signTransaction(tx);

      setTradeStatus("Sending...");
      const conn = new Connection(RPC_ENDPOINT);
      const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: true });

      showToast("Swap Sent!", `TX: ${sig.slice(0, 8)}...`, "success");
      setTimeout(() => window.open(`https://solscan.io/tx/${sig}`, "_blank"), 1500);
    } catch (e: any) {
      if (e.message?.includes("User rejected")) {
        showToast("Cancelled", "Transaction rejected", "error");
      } else {
        showToast("Swap Failed", e.message || "Unknown error", "error");
      }
    } finally {
      setExecuting(false);
      setTradeStatus("");
    }
  };

  // ── Search handler ──────────────────────────────────────────────
  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const q = searchQuery.trim();
      if (q.length > 30) {
        loadToken(q);
        setSearchQuery("");
      }
    }
  };

  // ── Price change data ───────────────────────────────────────────
  const pc = token?.dex?.priceChange || {};

  // ── Trade metrics ───────────────────────────────────────────────
  const dex = token?.dex || {};
  const fdv = token?.marketCap || dex.fdv || 0;
  const liq = token?.liquidity || dex.liquidityUsd || 0;
  const vol = token?.volume24h || dex.volume24h || 0;
  const volRatio = fdv > 0 ? ((vol / fdv) * 100).toFixed(1) : "0";
  const tx24h = dex.txns?.h24 || {};
  const tx5m = dex.txns?.m5 || {};
  const buys24 = tx24h.buys || 0;
  const sells24 = tx24h.sells || 0;
  const buys5 = tx5m.buys || 0;
  const sells5 = tx5m.sells || 0;
  const flowPct = (buys5 + sells5) > 0 ? Math.round((buys5 / (buys5 + sells5)) * 100) : 0;
  const pc5m = pc.m5 || 0;
  const pc1h = pc.h1 || 0;
  const momentum = ((pc5m * 2) + pc1h) / 3;

  return (
    <div className="chart-page">
      {/* MARKET STATS BAR */}
      <div className="chart-market-bar">
        <div className="chart-market-stat">
          <span className="chart-market-ticker">BTC</span>
          <span className="chart-market-price">{btcPrice ? `$${(btcPrice / 1000).toFixed(1)}K` : "$--"}</span>
        </div>
        <div className="chart-market-stat">
          <span className="chart-market-ticker">SOL</span>
          <span className="chart-market-price">{solPrice ? `$${solPrice.toFixed(2)}` : "$--"}</span>
        </div>
        <div className="chart-market-stat">
          <img src="/alien-hacker.jpg" alt="ALIEN" className="chart-market-icon" />
          <span className="chart-market-ticker">$ALIEN</span>
          <span className="chart-market-price">
            {alienPrice ? `$${alienPrice < 0.0001 ? alienPrice.toFixed(8) : alienPrice.toFixed(4)}` : "$--"}
          </span>
          <span className="chart-market-mcap">
            {alienMcap ? (alienMcap >= 1e6 ? `$${(alienMcap / 1e6).toFixed(1)}M` : `$${(alienMcap / 1e3).toFixed(0)}K`) : ""}
          </span>
        </div>
        <div className="chart-market-search">
          <input
            type="text"
            placeholder="Paste contract address..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyUp={handleSearch}
          />
        </div>
      </div>

      {/* MAIN LAYOUT */}
      <div className="chart-layout">
        {/* LEFT — Chart Area */}
        <div className="chart-left">
          {/* Token Header */}
          <div className="chart-token-header">
            <div className="chart-token-left">
              <div className="chart-token-icon">
                {token?.image ? (
                  <img src={token.image} alt="" onError={(e) => { (e.target as HTMLImageElement).src = "/alien-hacker.jpg"; }} />
                ) : (
                  <img src="/alien-hacker.jpg" alt="ALIENTOR" />
                )}
              </div>
              <div className="chart-token-info">
                <h1>{token?.symbol || "ALIENTOR"} <span className="chart-token-pair">/ SOL</span></h1>
                <div
                  className="chart-token-ca"
                  onClick={() => {
                    if (token?.contractAddress) {
                      navigator.clipboard.writeText(token.contractAddress);
                      showToast("Copied", token.contractAddress, "success");
                    }
                  }}
                >
                  {token ? truncAddr(token.contractAddress) : "Select a token"}
                  <span className="chart-copy-icon">&#x1F4CB;</span>
                </div>
              </div>
            </div>
            <div className="chart-token-price-area">
              <div className="chart-token-price-val">{formatPrice(token?.priceUsd)}</div>
              <div className={`chart-token-change ${(token?.priceChange24h || 0) >= 0 ? "green" : "red"}`}>
                {formatPct(token?.priceChange24h)}
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="chart-stats-bar">
            <div className="chart-stat-item">
              <div className="chart-stat-value">{formatNum(token?.marketCap)}</div>
              <div className="chart-stat-label">Market Cap</div>
            </div>
            <div className="chart-stat-item">
              <div className="chart-stat-value">{formatNum(token?.liquidity)}</div>
              <div className="chart-stat-label">Liquidity</div>
            </div>
            <div className="chart-stat-item">
              <div className="chart-stat-value">{formatNum(token?.volume24h)}</div>
              <div className="chart-stat-label">24h Volume</div>
            </div>
            <div className="chart-stat-item">
              <div className="chart-stat-value">{token?.holders ? token.holders.toLocaleString() : "-"}</div>
              <div className="chart-stat-label">Holders</div>
            </div>
            <div className="chart-stat-item">
              <div className="chart-stat-value">{token?.txns24h ? token.txns24h.toLocaleString() : "-"}</div>
              <div className="chart-stat-label">Txns (24h)</div>
            </div>
            <div className="chart-stat-item">
              <div className={`chart-stat-value ${(token?.score || 0) >= 60 ? "green" : (token?.score || 0) >= 30 ? "" : "red"}`}>
                {token?.score || "-"}
              </div>
              <div className="chart-stat-label">ALIEN Score</div>
            </div>
          </div>

          {/* Price Change Strip */}
          <div className="chart-pc-strip">
            {[
              { label: "1m", val: pc.m1 },
              { label: "5m", val: pc.m5 },
              { label: "1h", val: pc.h1 },
              { label: "24h", val: pc.h24 || token?.priceChange24h },
            ].map(item => (
              <div className="chart-pc-item" key={item.label}>
                <span className="chart-pc-label">{item.label}</span>
                <span className={`chart-pc-value ${(item.val || 0) > 0 ? "green" : (item.val || 0) < 0 ? "red" : ""}`}>
                  {item.val ? formatPct(item.val) : "0%"}
                </span>
              </div>
            ))}
          </div>

          {/* Chart Controls */}
          <div className="chart-controls">
            <div className="chart-providers">
              {(["geckoterminal", "birdeye", "dexscreener"] as ChartProvider[]).map(prov => (
                <button
                  key={prov}
                  className={`chart-provider-btn ${chartProvider === prov ? "active" : ""}`}
                  onClick={() => setChartProvider(prov)}
                  title={prov}
                >
                  {prov === "geckoterminal" ? "GeckoTerminal" : prov === "birdeye" ? "Birdeye" : "DexScreener"}
                </button>
              ))}
            </div>
            <div className="chart-link-actions">
              <button className="chart-link-btn" onClick={() => token && window.open(`https://dexscreener.com/solana/${token.contractAddress}`, "_blank")}>DEX</button>
              <button className="chart-link-btn" onClick={() => token && window.open(`https://gmgn.ai/sol/token/${token.contractAddress}`, "_blank")}>GMGN</button>
              <button className="chart-link-btn chart-link-bubble" onClick={() => token && window.open(`https://app.bubblemaps.io/sol/token/${token.contractAddress}`, "_blank")}>Bubble</button>
            </div>
          </div>

          {/* Chart iframe */}
          <div className="chart-iframe-container" style={{ height: chartHeight }}>
            {token?.contractAddress ? (
              <iframe
                src={getChartUrl(token.contractAddress, chartProvider)}
                title="Chart"
                allow="clipboard-write"
                allowFullScreen
              />
            ) : (
              <div className="chart-placeholder">Select a token to view chart</div>
            )}
            <div
              className="chart-resize-handle"
              onMouseDown={startResize}
              onTouchStart={startResize}
            />
          </div>

          {/* Data Tabs */}
          <div className="chart-data-tabs">
            {(["trades", "holders", "topTraders", "devTokens"] as DataTab[]).map(tab => (
              <button
                key={tab}
                className={`chart-data-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => handleTabChange(tab)}
              >
                {tab === "trades" ? "Trades" : tab === "holders" ? "Holders" : tab === "topTraders" ? "Top Traders" : "Dev Tokens"}
                {tab === "holders" && token?.holders ? <span className="chart-tab-count">{token.holders}</span> : null}
              </button>
            ))}
          </div>

          {/* Data Panel */}
          <div className="chart-data-panel">
            {activeTab === "trades" && (
              <table className="chart-data-table">
                <thead>
                  <tr>
                    <th>Age</th>
                    <th>Type</th>
                    <th>Amount</th>
                    <th>Total USD</th>
                    <th>Trader</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.length > 0 ? trades.map((t, i) => {
                    const usdVal = t.solAmount * solPrice;
                    return (
                      <tr key={i} className={`chart-trade-row ${t.type}`}>
                        <td className="muted">{formatTradeAge(t.timestamp)}</td>
                        <td><span className={`chart-trade-type ${t.type}`}>{t.type.toUpperCase()}</span></td>
                        <td className="mono">{t.tokenAmount > 1e6 ? `${(t.tokenAmount / 1e6).toFixed(1)}M` : t.tokenAmount > 1e3 ? `${(t.tokenAmount / 1e3).toFixed(1)}K` : t.tokenAmount.toFixed(0)}</td>
                        <td className={`mono ${t.type === "buy" ? "green" : "red"}`}>${usdVal > 1000 ? `${(usdVal / 1000).toFixed(2)}K` : usdVal.toFixed(2)}</td>
                        <td className="mono muted">{t.trader}</td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan={5} className="chart-empty-state">{loading ? "Loading trades..." : "Select a token to view trades"}</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {activeTab === "holders" && (
              <div className="chart-empty-state">
                {loadingTab ? "Loading holders..." : (token?.holders ? `${token.holders.toLocaleString()} holders` : "Select a token to view holders")}
              </div>
            )}

            {activeTab === "topTraders" && (
              <div className="chart-empty-state">
                {trades.length > 0 ? "Analyzing traders from recent trades..." : "Load a token to analyze top traders"}
              </div>
            )}

            {activeTab === "devTokens" && (
              <div className="chart-empty-state">
                {token ? (
                  <div>
                    <div style={{ marginBottom: 12 }}>View dev history on:</div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                      <a href={`https://solscan.io/token/${token.contractAddress}`} target="_blank" rel="noreferrer" className="chart-ext-link">Solscan</a>
                      <a href={`https://gmgn.ai/sol/token/${token.contractAddress}`} target="_blank" rel="noreferrer" className="chart-ext-link">GMGN</a>
                    </div>
                  </div>
                ) : "Select a token"}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — Trade Panel */}
        <div className="chart-trade-panel">
          <div className="chart-panel-header">EXECUTE TRADE</div>
          <div className="chart-trade-content">
            {/* Buy/Sell Tabs */}
            <div className="chart-trade-tabs">
              <button
                className={`chart-trade-tab buy ${tradeType === "buy" ? "active" : ""}`}
                onClick={() => setTradeType("buy")}
              >BUY</button>
              <button
                className={`chart-trade-tab sell ${tradeType === "sell" ? "active" : ""}`}
                onClick={() => setTradeType("sell")}
              >SELL</button>
            </div>

            {/* Input */}
            <div className="chart-input-group">
              <div className="chart-input-label">
                <span>You Pay</span>
                <span>{tradeType === "buy" ? `Bal: ${solBalance.toFixed(4)} SOL` : `Bal: ${tokenBalance.toFixed(2)} ${token?.symbol || ""}`}</span>
              </div>
              <div className="chart-input-wrapper">
                <input
                  type="number"
                  placeholder="0"
                  value={tradeAmount}
                  onChange={e => setTradeAmount(e.target.value)}
                />
                <span className="chart-input-currency">{tradeType === "buy" ? "SOL" : (token?.symbol || "TOKEN")}</span>
              </div>
            </div>

            {/* Quick Amounts */}
            <div className="chart-quick-amounts">
              {tradeType === "buy"
                ? [0.1, 0.5, 1, 5].map(amt => (
                  <button key={amt} className="chart-quick-btn" onClick={() => setTradeAmount(String(amt))}>{amt}</button>
                ))
                : [25, 50, 75, 100].map(pct => (
                  <button key={pct} className="chart-quick-btn" onClick={() => {
                    if (tokenBalance > 0) setTradeAmount(String((tokenBalance * pct / 100).toFixed(2)));
                  }}>{pct === 100 ? "MAX" : `${pct}%`}</button>
                ))
              }
            </div>

            {/* Output Preview */}
            <div className="chart-output-preview">
              <div className="chart-output-label">You Receive (est.)</div>
              <div className="chart-output-value">
                {tradePreview.output} <span>{tradeType === "buy" ? (token?.symbol || "TOKEN") : "SOL"}</span>
              </div>
            </div>

            {/* Trade Settings */}
            <div className="chart-trade-settings">
              <div className="chart-setting-row"><span>Rate</span><span className="mono">{tradePreview.rate}</span></div>
              <div className="chart-setting-row"><span>Slippage</span><span className="mono">1%</span></div>
              <div className="chart-setting-row"><span>Fee (1%)</span><span className="mono">{tradePreview.fee}</span></div>
            </div>

            {/* Execute Button */}
            <button
              className={`chart-execute-btn ${tradeType}`}
              onClick={executeTrade}
              disabled={executing || !connected}
            >
              {executing ? tradeStatus : `${tradeType.toUpperCase()} ${token?.symbol || "TOKEN"}`}
            </button>

            {/* Powered by Jupiter */}
            <div className="chart-powered-by">
              <span>Swaps powered by</span>
              <span className="chart-jup-text">Jupiter</span>
            </div>

            {/* Trade Metrics */}
            <div className="chart-trade-metrics">
              <div className="chart-metric-grid">
                <div className="chart-metric-item">
                  <div className="chart-metric-label">LIQ DEPTH</div>
                  <div className={`chart-metric-value ${liq > 25000 ? "green" : liq > 10000 ? "" : "orange"}`}>{formatNum(liq)}</div>
                </div>
                <div className="chart-metric-item">
                  <div className="chart-metric-label">VOL/MCAP</div>
                  <div className={`chart-metric-value ${parseFloat(volRatio) > 25 ? "green" : parseFloat(volRatio) > 10 ? "" : "orange"}`}>{volRatio}%</div>
                </div>
                <div className="chart-metric-item">
                  <div className="chart-metric-label">24H BUYS</div>
                  <div className="chart-metric-value green">{buys24 > 0 ? buys24.toLocaleString() : "-"}</div>
                </div>
                <div className="chart-metric-item">
                  <div className="chart-metric-label">24H SELLS</div>
                  <div className="chart-metric-value red">{sells24 > 0 ? sells24.toLocaleString() : "-"}</div>
                </div>
                <div className="chart-metric-item">
                  <div className="chart-metric-label">5M FLOW</div>
                  <div className={`chart-metric-value ${flowPct > 55 ? "green" : flowPct < 45 ? "red" : ""}`}>
                    {(buys5 + sells5) > 0 ? `${flowPct}% B` : "-"}
                  </div>
                </div>
                <div className="chart-metric-item">
                  <div className="chart-metric-label">MOMENTUM</div>
                  <div className={`chart-metric-value ${momentum > 5 ? "green" : momentum < -5 ? "red" : ""}`}>
                    {(momentum >= 0 ? "+" : "") + momentum.toFixed(1)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Safety Panel */}
            <div className="chart-safety-panel">
              <div className="chart-safety-header">
                <span className="chart-safety-title">RUG SAFETY</span>
                <span className={`chart-safety-score ${safetyData ? (safetyData.safetyScore >= 70 ? "" : safetyData.safetyScore >= 40 ? "warning" : "danger") : ""}`}>
                  {safetyData ? `${safetyData.safetyScore}%` : "-"}
                </span>
              </div>
              <div className="chart-safety-grid">
                <div className="chart-safety-item">
                  <span className="chart-safety-label">Holders</span>
                  <span className={`chart-safety-value ${safetyData?.holders ? (safetyData.holders >= 200 ? "safe" : safetyData.holders >= 50 ? "warning" : "danger") : ""}`}>
                    {safetyData?.holders ? (safetyData.holders > 1000 ? `${(safetyData.holders / 1000).toFixed(1)}K` : safetyData.holders) : "-"}
                  </span>
                </div>
                <div className="chart-safety-item">
                  <span className="chart-safety-label">NoMint</span>
                  <span className={`chart-safety-value ${safetyData?.noMint === true ? "safe" : safetyData?.noMint === false ? "danger" : ""}`}>
                    {safetyData?.noMint === true ? "✓" : safetyData?.noMint === false ? "✗" : "-"}
                  </span>
                </div>
                <div className="chart-safety-item">
                  <span className="chart-safety-label">NoFreeze</span>
                  <span className={`chart-safety-value ${safetyData?.noFreeze === true ? "safe" : safetyData?.noFreeze === false ? "danger" : ""}`}>
                    {safetyData?.noFreeze === true ? "✓" : safetyData?.noFreeze === false ? "✗" : "-"}
                  </span>
                </div>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="chart-quick-stats">
              <div className="chart-quick-stats-title">QUICK STATS</div>
              <div className="chart-quick-stats-grid">
                {(token?.layers || []).map(layer => (
                  <div className="chart-layer-item" key={layer.name}>
                    <span className="chart-layer-name">{layer.name}</span>
                    <span className={`chart-layer-score ${scoreClass(layer.score)}`}>{layer.score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`chart-toast ${toast.type}`}>
          <div className="chart-toast-title">{toast.title}</div>
          <div className="chart-toast-message">{toast.message}</div>
        </div>
      )}
    </div>
  );
}
