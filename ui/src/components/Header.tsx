import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ROUTES } from "../lib/constants";

interface HeaderProps {
  currentRoute: string;
  onNavigate: (route: string) => void;
}

const NAV_ITEMS = [
  { route: ROUTES.HOME, label: "Home" },
  { route: ROUTES.TRADE, label: "Trade" },
  { route: ROUTES.EARN, label: "Earn" },
  { route: ROUTES.REGISTER, label: "Register" },
  { route: ROUTES.INDEXER, label: "Indexer" },
];

export function Header({ currentRoute, onNavigate }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-inner">
        <div
          className="header-logo"
          onClick={() => onNavigate(ROUTES.HOME)}
        >
          <div className="logo-icon">
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <ellipse cx="20" cy="17" rx="15" ry="17" fill="url(#alien-head)" />
              <ellipse cx="13" cy="15" rx="4.5" ry="5.5" fill="#020208" />
              <ellipse cx="27" cy="15" rx="4.5" ry="5.5" fill="#020208" />
              <ellipse cx="13" cy="15" rx="3" ry="4" fill="url(#eye-glow-l)" />
              <ellipse cx="27" cy="15" rx="3" ry="4" fill="url(#eye-glow-r)" />
              <ellipse cx="14" cy="13.5" rx="1" ry="1.5" fill="rgba(255,255,255,0.4)" />
              <ellipse cx="28" cy="13.5" rx="1" ry="1.5" fill="rgba(255,255,255,0.4)" />
              <path d="M15 28 Q20 33 25 28" stroke="#39ff14" strokeWidth="0.5" fill="none" opacity="0.3" />
              <defs>
                <linearGradient id="alien-head" x1="20" y1="0" x2="20" y2="34">
                  <stop stopColor="#a855f7" />
                  <stop offset="0.5" stopColor="#39ff14" stopOpacity="0.8" />
                  <stop offset="1" stopColor="#00f0ff" />
                </linearGradient>
                <radialGradient id="eye-glow-l" cx="0.5" cy="0.5" r="0.5">
                  <stop stopColor="#39ff14" />
                  <stop offset="1" stopColor="#00f0ff" stopOpacity="0.6" />
                </radialGradient>
                <radialGradient id="eye-glow-r" cx="0.5" cy="0.5" r="0.5">
                  <stop stopColor="#39ff14" />
                  <stop offset="1" stopColor="#00f0ff" stopOpacity="0.6" />
                </radialGradient>
              </defs>
            </svg>
          </div>
          <span className="logo-text">
            ALIEN<span className="logo-accent">ATOR</span>
          </span>
        </div>

        <nav className="header-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.route}
              className={`nav-pill ${currentRoute === item.route ? "active" : ""}`}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
