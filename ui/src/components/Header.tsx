import React, { useState } from "react";
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
  { route: ROUTES.GUIDE, label: "Guide" },
];

export function Header({ currentRoute, onNavigate }: HeaderProps) {
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
              className={`nav-pill ${currentRoute === item.route ? "active" : ""}`}
              onClick={() => onNavigate(item.route)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
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
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
