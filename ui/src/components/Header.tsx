import React, { useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ROUTES } from "../lib/constants";

interface HeaderProps {
  currentRoute: string;
  onNavigate: (route: string) => void;
  onOpenChat?: () => void;
}

const NAV_ITEMS = [
  { route: ROUTES.HOME, label: "Home" },
  { route: ROUTES.TRADE, label: "Trade" },
  { route: ROUTES.EARN, label: "Earn" },
  { route: ROUTES.LAUNCHPAD, label: "Launchpad", accent: true, badge: "BETA" },
  { route: ROUTES.XENOSCOPE, label: "Xenoscope", xeno: true },
  { route: ROUTES.REGISTER, label: "Register" },
  { route: ROUTES.INDEXER, label: "Indexer" },
  { route: ROUTES.GUIDE, label: "Guide" },
];

export function Header({ currentRoute, onNavigate, onOpenChat }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (route: string) => {
    onNavigate(route);
    setMobileMenuOpen(false);
  };

  return (
    <header className="header">
      <div className="header-inner">
        <div
          className="header-logo"
          onClick={() => handleNav(ROUTES.HOME)}
        >
          <img
            src="/alien-hacker.jpg"
            alt="Alienator"
            className="logo-img"
          />
          <span className="logo-text">
            ALIEN<span className="logo-accent">ATOR</span>
          </span>
        </div>

        <nav className="header-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              className={`nav-pill ${currentRoute === item.route ? "active" : ""} ${item.accent ? "nav-pill-accent" : ""} ${(item as any).xeno ? "nav-pill-xeno" : ""}`}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <button className="header-ai-btn" onClick={onOpenChat}>
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none">
              <ellipse cx="32" cy="30" rx="22" ry="26" stroke="#39ff14" strokeWidth="2.5" fill="rgba(57,255,20,0.08)" />
              <ellipse cx="23" cy="26" rx="5" ry="7" fill="#39ff14" opacity="0.8" />
              <ellipse cx="41" cy="26" rx="5" ry="7" fill="#39ff14" opacity="0.8" />
            </svg>
            <span>Ask AI</span>
            <span className="header-ai-live" />
          </button>
          <WalletMultiButton />
          {/* Mobile hamburger */}
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? "open" : ""}`}>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              className={`mobile-nav-item ${currentRoute === item.route ? "active" : ""}`}
              onClick={() => handleNav(item.route)}
            >
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
          <button
            className="mobile-nav-item mobile-nav-ai"
            onClick={() => { setMobileMenuOpen(false); onOpenChat?.(); }}
          >
            Ask AI
          </button>
        </div>
      )}
    </header>
  );
}
