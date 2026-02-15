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
          style={{ cursor: "pointer" }}
        >
          <div className="logo-icon">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* Alien head silhouette */}
              <ellipse cx="16" cy="14" rx="12" ry="14" fill="url(#alien-grad)" />
              <ellipse cx="10" cy="12" rx="3.5" ry="4.5" fill="#050510" />
              <ellipse cx="22" cy="12" rx="3.5" ry="4.5" fill="#050510" />
              <ellipse cx="10" cy="12" rx="2.5" ry="3.5" fill="var(--cyan)" opacity="0.8" />
              <ellipse cx="22" cy="12" rx="2.5" ry="3.5" fill="var(--cyan)" opacity="0.8" />
              <defs>
                <linearGradient id="alien-grad" x1="16" y1="0" x2="16" y2="28">
                  <stop stopColor="#7b61ff" />
                  <stop offset="1" stopColor="#00f0ff" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span className="logo-text">
            ALIEN<span className="logo-accent">PERC</span>
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
