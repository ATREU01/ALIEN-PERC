import React from "react";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-section">
            <h4 className="footer-title">ALIEN PERCOLATOR</h4>
            <p className="text-muted" style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              Sovereign perpetual futures powered by the percolator protocol.
              Admin keys burned. Insurance fund grows forever.
            </p>
          </div>

          <div className="footer-section">
            <h4 className="footer-title">Protocol</h4>
            <ul className="footer-links">
              <li>
                <a
                  href="https://github.com/aeyakovenko/percolator-cli"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Percolator CLI
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ATREU01/ALIEN-PERC"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ALIEN Fork
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/ATREU01/squads-mpl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Squads Multisig
                </a>
              </li>
            </ul>
          </div>

          <div className="footer-section">
            <h4 className="footer-title">Resources</h4>
            <ul className="footer-links">
              <li>
                <a href="#indexer">Market Explorer</a>
              </li>
              <li>
                <a href="#register">List a Token</a>
              </li>
              <li>
                <a
                  href="https://solscan.io"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Solscan
                </a>
              </li>
            </ul>
          </div>

          <div className="footer-section">
            <h4 className="footer-title">Community</h4>
            <div className="footer-social">
              <a
                href="https://github.com/ATREU01/ALIEN-PERC"
                target="_blank"
                rel="noopener noreferrer"
                className="social-link"
                title="GitHub"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="text-muted">
            Built on Solana. Powered by the Percolator protocol.
          </span>
          <span className="badge-sovereign">SOVEREIGN</span>
        </div>
      </div>
    </footer>
  );
}
