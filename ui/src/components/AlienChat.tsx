import React, { useState, useRef, useEffect } from "react";
import { useMarketDiscovery } from "../hooks/useMarketData";
import { getMarketName } from "../lib/constants";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AlienChatProps {
  onNavigate?: (route: string) => void;
}

// Extract [NAV:xxx] tags from AI response and return clean text + nav targets
function parseNavHints(text: string): { clean: string; navTargets: string[] } {
  const navTargets: string[] = [];
  const clean = text.replace(/\[NAV:(\w+)\]/g, (_, route) => {
    navTargets.push(route);
    return "";
  }).trim();
  return { clean, navTargets };
}

const NAV_LABELS: Record<string, string> = {
  trade: "Go to Trade",
  earn: "Go to Earn",
  register: "List a Token",
  indexer: "Market Explorer",
  guide: "Read the Guide",
};

const SUGGESTED_PROMPTS = [
  "What is Alienator?",
  "How does percolator work?",
  "How do I trade?",
  "Tell me about the insurance fund",
];

// Inline Alienator logo SVG component — matches brand identity
function AlienLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="30" rx="22" ry="26" fill="url(#alien-chat-grad)" />
      <ellipse cx="23" cy="26" rx="6" ry="8" fill="#050510" />
      <ellipse cx="41" cy="26" rx="6" ry="8" fill="#050510" />
      <ellipse cx="23" cy="26" rx="4.2" ry="5.8" fill="#39ff14" opacity="0.85" />
      <ellipse cx="41" cy="26" rx="4.2" ry="5.8" fill="#39ff14" opacity="0.85" />
      <ellipse cx="23" cy="24" rx="1.8" ry="2.5" fill="#fff" opacity="0.5" />
      <ellipse cx="41" cy="24" rx="1.8" ry="2.5" fill="#fff" opacity="0.5" />
      <defs>
        <linearGradient id="alien-chat-grad" x1="32" y1="0" x2="32" y2="60">
          <stop stopColor="#39ff14" stopOpacity="0.25" />
          <stop offset="1" stopColor="#00f0ff" stopOpacity="0.15" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Larger alien face for the header
function AlienHeaderLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="30" rx="22" ry="26" stroke="#39ff14" strokeWidth="1.5" fill="rgba(57, 255, 20, 0.06)" />
      <ellipse cx="23" cy="26" rx="6" ry="8" fill="#050510" />
      <ellipse cx="41" cy="26" rx="6" ry="8" fill="#050510" />
      <ellipse cx="23" cy="26" rx="4.2" ry="5.8" fill="#39ff14" opacity="0.8" />
      <ellipse cx="41" cy="26" rx="4.2" ry="5.8" fill="#39ff14" opacity="0.8" />
      <ellipse cx="23" cy="24" rx="1.8" ry="2.5" fill="#fff" opacity="0.45" />
      <ellipse cx="41" cy="24" rx="1.8" ry="2.5" fill="#fff" opacity="0.45" />
    </svg>
  );
}

export function AlienChat({ onNavigate }: AlienChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [navHints, setNavHints] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { markets } = useMarketDiscovery();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Build real-time market context for the AI
  const buildMarketContext = () => {
    if (markets.length === 0) return undefined;
    return {
      totalMarkets: markets.length,
      markets: markets.map((m) => {
        const name = getMarketName(m.state.collateralMint);
        return {
          name: name?.name || "Unknown",
          symbol: name?.symbol || "???",
          markPriceE6: m.state.markPriceE6.toString(),
          totalOI: m.state.totalOI.toString(),
          insuranceBalance: m.state.insuranceBalance.toString(),
          numAccounts: m.state.numAccounts,
          adminBurned: m.state.adminBurned,
          inverted: m.state.inverted,
          tradingFeeBps: m.state.tradingFeeBps,
        };
      }),
    };
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { role: "user", content: msg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: newMessages.slice(-10),
          marketContext: buildMarketContext(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const { clean, navTargets } = parseNavHints(data.response);
      const msgIndex = newMessages.length;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: clean },
      ]);
      if (navTargets.length > 0) {
        setNavHints((prev) => ({ ...prev, [msgIndex]: navTargets }));
      }
    } catch (err: any) {
      const errMsg = err.message || "Neural link disrupted";
      if (errMsg.includes("API key") || errMsg.includes("not configured")) {
        setError("Alien intelligence coming soon. Neural link not yet active.");
      } else {
        setError(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      {!open && (
        <button
          className="alien-chat-trigger"
          onClick={() => setOpen(true)}
          aria-label="Open Alien Intelligence chat"
        >
          <div className="alien-chat-trigger-inner">
            <AlienHeaderLogo />
          </div>
          <span className="alien-chat-trigger-label">AI</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="alien-chat-window">
          {/* Header */}
          <div className="alien-chat-header">
            <div className="alien-chat-header-left">
              <div className="alien-chat-header-logo">
                <AlienHeaderLogo />
              </div>
              <div className="alien-chat-header-info">
                <span className="alien-chat-title">ALIEN INTELLIGENCE</span>
                <span className="alien-chat-subtitle">
                  <span className="alien-chat-status-dot" />
                  Protocol-aware AI
                </span>
              </div>
            </div>
            <button
              className="alien-chat-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="alien-chat-messages">
            {messages.length === 0 && !loading && (
              <div className="alien-chat-welcome">
                <div className="alien-chat-welcome-logo">
                  <AlienLogo size={44} />
                </div>
                <h3 className="alien-chat-welcome-title">Alien Intelligence</h3>
                <p className="alien-chat-welcome-desc">
                  Protocol-aware AI with real-time on-chain data. Ask anything about Alienator, trading, or how percolator works.
                </p>
                <div className="alien-chat-suggestions">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className="alien-chat-suggestion"
                      onClick={() => sendMessage(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div
                  className={`alien-chat-msg ${msg.role === "user" ? "alien-chat-msg-user" : "alien-chat-msg-ai"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="alien-chat-ai-icon">
                      <AlienLogo size={18} />
                    </div>
                  )}
                  <div className="alien-chat-msg-text">{msg.content}</div>
                </div>
                {msg.role === "assistant" && navHints[i] && onNavigate && (
                  <div className="alien-chat-nav-hints">
                    {navHints[i].map((route) => (
                      <button
                        key={route}
                        className="alien-chat-nav-btn"
                        onClick={() => { onNavigate(route); setOpen(false); }}
                      >
                        {NAV_LABELS[route] || route}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="alien-chat-msg alien-chat-msg-ai">
                <div className="alien-chat-ai-icon">
                  <AlienLogo size={18} />
                </div>
                <div className="alien-chat-msg-text alien-chat-thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}

            {error && (
              <div className="alien-chat-error">{error}</div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="alien-chat-input-area">
            <input
              ref={inputRef}
              className="alien-chat-input"
              type="text"
              placeholder="Ask the alien anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
              disabled={loading}
            />
            <button
              className="alien-chat-send"
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 14V2M8 2L2 8M8 2L14 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
