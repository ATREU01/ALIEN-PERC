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

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
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
          message: text,
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
      const msgIndex = newMessages.length; // index of this AI message
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: clean },
      ]);
      if (navTargets.length > 0) {
        setNavHints((prev) => ({ ...prev, [msgIndex]: navTargets }));
      }
    } catch (err: any) {
      const msg = err.message || "Neural link disrupted";
      if (msg.includes("API key") || msg.includes("not configured")) {
        setError("Alien intelligence coming soon. Neural link not yet active.");
      } else {
        setError(msg);
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
      {/* Chat bubble trigger */}
      {!open && (
        <button
          className="alien-chat-trigger"
          onClick={() => setOpen(true)}
          aria-label="Open Alien Intelligence chat"
        >
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <ellipse cx="14" cy="12" rx="11" ry="12" stroke="#39ff14" strokeWidth="1.5" fill="none" />
            <ellipse cx="10" cy="10" rx="2.5" ry="3.5" fill="#39ff14" opacity="0.6" />
            <ellipse cx="18" cy="10" rx="2.5" ry="3.5" fill="#39ff14" opacity="0.6" />
            <ellipse cx="10.5" cy="9" rx="1" ry="1.2" fill="rgba(255,255,255,0.4)" />
            <ellipse cx="18.5" cy="9" rx="1" ry="1.2" fill="rgba(255,255,255,0.4)" />
            <path d="M10 17 Q14 20 18 17" stroke="#39ff14" strokeWidth="1" fill="none" opacity="0.4" />
          </svg>
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div className="alien-chat-window">
          <div className="alien-chat-header">
            <div className="alien-chat-title">
              <span className="beta-dot" />
              ALIEN INTELLIGENCE
            </div>
            <button
              className="alien-chat-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              &times;
            </button>
          </div>

          <div className="alien-chat-messages">
            {messages.length === 0 && !loading && (
              <div className="alien-chat-welcome">
                <p>Greetings, human. I am the Alienator protocol intelligence.</p>
                <p className="text-muted">
                  Ask me anything about the protocol, trading, how percolator works,
                  or what makes Alienator different.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div
                  className={`alien-chat-msg ${msg.role === "user" ? "alien-chat-msg-user" : "alien-chat-msg-ai"}`}
                >
                  {msg.role === "assistant" && <span className="alien-chat-ai-icon">A</span>}
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
                <span className="alien-chat-ai-icon">A</span>
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

          <div className="alien-chat-input-area">
            <input
              ref={inputRef}
              className="alien-chat-input"
              type="text"
              placeholder="Ask the alien..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
              disabled={loading}
            />
            <button
              className="alien-chat-send"
              onClick={sendMessage}
              disabled={!input.trim() || loading}
            >
              &uarr;
            </button>
          </div>
        </div>
      )}
    </>
  );
}
