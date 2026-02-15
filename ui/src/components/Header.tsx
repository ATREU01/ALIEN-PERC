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
          <img
            src="/alienator-logo.png"
            alt="Alienator"
            className="logo-img"
          />
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
