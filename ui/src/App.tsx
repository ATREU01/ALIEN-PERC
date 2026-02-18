import React, { useState, useEffect, useCallback } from "react";
import { WalletProvider } from "./components/WalletProvider";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { AlienChat } from "./components/AlienChat";
import { Home } from "./pages/Home";
import { Trade } from "./pages/Trade";
import { Earn } from "./pages/Earn";
import { Launchpad } from "./pages/Launchpad";
import { Register } from "./pages/Register";
import { Indexer } from "./pages/Indexer";
import { Guide } from "./pages/Guide";
import { Terms } from "./pages/Terms";
import { ROUTES } from "./lib/constants";
import "./styles.css";

function getRouteFromHash(): string {
  const hash = window.location.hash.replace("#", "");
  return hash || ROUTES.HOME;
}

function AppContent() {
  const [route, setRoute] = useState(getRouteFromHash);
  const [chatOpen, setChatOpen] = useState(false);

  const navigate = useCallback((newRoute: string) => {
    window.location.hash = newRoute;
    setRoute(newRoute);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const renderPage = () => {
    switch (route) {
      case ROUTES.TRADE:
        return <Trade />;
      case ROUTES.EARN:
        return <Earn />;
      case ROUTES.LAUNCHPAD:
        return <Launchpad />;
      case ROUTES.REGISTER:
        return <Register />;
      case ROUTES.INDEXER:
        return <Indexer />;
      case ROUTES.GUIDE:
        return <Guide onNavigate={navigate} />;
      case ROUTES.TERMS:
        return <Terms />;
      default:
        return <Home onNavigate={navigate} />;
    }
  };

  return (
    <div className="app">
      <Header currentRoute={route} onNavigate={navigate} onOpenChat={() => setChatOpen(true)} />
      <main className="main-content">
        <div className="container">{renderPage()}</div>
      </main>
      <Footer />
      <AlienChat onNavigate={navigate} externalOpen={chatOpen} onExternalOpenHandled={() => setChatOpen(false)} />
    </div>
  );
}

export function App() {
  return (
    <WalletProvider>
      <AppContent />
    </WalletProvider>
  );
}
