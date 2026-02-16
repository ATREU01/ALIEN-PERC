import React from "react";

export function Terms() {
  return (
    <div className="page terms-page">
      <h1 className="section-title">Terms &amp; Conditions</h1>
      <p className="terms-updated">Last updated: February 16, 2026</p>

      <div className="terms-section">
        <h2>1. Acceptance of Terms</h2>
        <p className="terms-text">
          By accessing, browsing, or using the Alienator protocol interface ("Service") located at
          alienator.org, you acknowledge that you have read, understood, and agree to be bound by
          these Terms and Conditions ("Terms"). If you do not agree to these Terms, you must
          immediately cease all use of the Service.
        </p>
      </div>

      <div className="terms-section">
        <h2>2. Description of Service</h2>
        <p className="terms-text">
          Alienator is an experimental, decentralized perpetual futures protocol built on the
          Solana blockchain using the Percolator engine architecture designed by Anatoly Yakovenko.
          The protocol enables inverted perpetual futures markets where users deposit SPL tokens as
          collateral to trade USD-denominated contracts.
        </p>
        <p className="terms-text">
          The Service is currently deployed on Solana devnet for testing and development purposes.
          No real funds are at risk on devnet. The protocol is provided as open-source software and
          the interface is a frontend that interacts with on-chain smart contracts.
        </p>
        <p className="terms-text">
          The Service includes an AI-powered assistant ("Alien Intelligence") that provides
          informational responses about the protocol. The AI reads live on-chain market data but
          does not execute trades or manage funds on your behalf.
        </p>
      </div>

      <div className="terms-section">
        <h2>3. No Investment Advice</h2>
        <p className="terms-text">
          Nothing contained on this website or provided through the Service constitutes financial
          advice, investment advice, trading advice, or any other form of professional advice.
          You should conduct your own research and consult with qualified, independent financial
          advisors before making any financial decisions. The AI assistant is informational only
          and does not provide investment recommendations.
        </p>
      </div>

      <div className="terms-section">
        <h2>4. Risk Disclosure</h2>
        <p className="terms-text">
          Trading cryptocurrency derivatives involves substantial risk of loss and is not suitable
          for every individual. You should carefully consider whether trading is appropriate for
          you in light of your financial condition. Specific risks include but are not limited to:
        </p>
        <ul className="terms-list">
          <li><strong>Leverage risk:</strong> Leveraged trading amplifies both gains and losses. You can lose more than your initial deposit.</li>
          <li><strong>Liquidation risk:</strong> Positions may be automatically liquidated if margin requirements are not maintained.</li>
          <li><strong>Smart contract risk:</strong> The protocol relies on on-chain smart contracts which may contain bugs, vulnerabilities, or behave unexpectedly.</li>
          <li><strong>Oracle risk:</strong> The protocol uses a push-based oracle (Hyperp mode) with circuit breakers. Oracle manipulation or failure could result in incorrect pricing.</li>
          <li><strong>Market risk:</strong> Cryptocurrency markets are highly volatile. Prices can move rapidly and unpredictably.</li>
          <li><strong>Counterparty risk:</strong> LP vault depositors absorb counterparty risk from traders.</li>
          <li><strong>Technology risk:</strong> The Solana blockchain, RPC infrastructure, or wallet software may experience outages, delays, or failures.</li>
          <li><strong>Regulatory risk:</strong> Cryptocurrency regulations vary by jurisdiction and are subject to change.</li>
        </ul>
      </div>

      <div className="terms-section">
        <h2>5. No Warranty</h2>
        <p className="terms-text">
          THE SERVICE AND ALL ASSOCIATED SOFTWARE, SMART CONTRACTS, AND INFRASTRUCTURE ARE PROVIDED
          "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
          BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
          AND NON-INFRINGEMENT. THE CREATORS AND CONTRIBUTORS MAKE NO WARRANTY THAT THE SERVICE
          WILL BE UNINTERRUPTED, TIMELY, SECURE, OR ERROR-FREE.
        </p>
      </div>

      <div className="terms-section">
        <h2>6. Limitation of Liability</h2>
        <p className="terms-text">
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL THE CREATORS,
          CONTRIBUTORS, DEVELOPERS, OR ANY AFFILIATED PARTIES BE LIABLE FOR ANY INDIRECT,
          INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION,
          LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
          (A) YOUR ACCESS TO OR USE OF OR INABILITY TO ACCESS OR USE THE SERVICE; (B) ANY
          CONDUCT OR CONTENT OF ANY THIRD PARTY ON THE SERVICE; (C) ANY CONTENT OBTAINED FROM
          THE SERVICE; AND (D) UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR TRANSMISSIONS
          OR CONTENT.
        </p>
      </div>

      <div className="terms-section">
        <h2>7. Decentralized Protocol</h2>
        <p className="terms-text">
          After the admin key burn operation (transfer to system program address
          11111111111111111111111111111111), the on-chain market becomes fully autonomous and
          sovereign. No entity, individual, or organization can modify, pause, upgrade, or
          otherwise alter the market parameters. This is an irreversible, by-design feature of
          the protocol. There is no recourse, support channel, or mechanism to reverse
          transactions or recover funds from a burned market.
        </p>
      </div>

      <div className="terms-section">
        <h2>8. Intellectual Property</h2>
        <p className="terms-text">
          The Alienator protocol is built on open-source software. The Percolator engine is
          designed by Anatoly Yakovenko and the source code is publicly available. The Alienator
          fork, branding, name, logo, and associated trademarks are the property of the
          Alienator project. The AI integration and protocol intelligence system are proprietary
          components of the Alienator ecosystem.
        </p>
      </div>

      <div className="terms-section">
        <h2>9. Prohibited Use</h2>
        <p className="terms-text">
          You agree not to use the Service:
        </p>
        <ul className="terms-list">
          <li>From any jurisdiction where cryptocurrency trading or derivatives are prohibited by law</li>
          <li>If you are a resident or citizen of a sanctioned country or territory</li>
          <li>To engage in market manipulation, wash trading, or any form of fraudulent activity</li>
          <li>To launder money or finance terrorism or any illegal activity</li>
          <li>To circumvent any access restrictions, rate limits, or security measures</li>
          <li>In any manner that violates applicable local, state, national, or international law</li>
        </ul>
        <p className="terms-text">
          You are solely responsible for ensuring that your use of the Service complies with all
          applicable laws and regulations in your jurisdiction.
        </p>
      </div>

      <div className="terms-section">
        <h2>10. Privacy</h2>
        <p className="terms-text">
          The Alienator protocol does not collect, store, or process personal identifying
          information. All interactions with the protocol occur on-chain through your
          self-custodial wallet. Wallet addresses and transaction data are publicly visible
          on the Solana blockchain by design. Third-party RPC providers (e.g., Helius) may
          log request metadata in accordance with their own privacy policies. The AI chat
          feature processes conversation data transiently and does not store chat history
          server-side.
        </p>
      </div>

      <div className="terms-section">
        <h2>11. Modification of Terms</h2>
        <p className="terms-text">
          These Terms may be updated or modified at any time without prior notice. Your
          continued use of the Service following any changes constitutes acceptance of the
          revised Terms. It is your responsibility to review these Terms periodically.
        </p>
      </div>

      <div className="terms-section">
        <h2>12. Severability</h2>
        <p className="terms-text">
          If any provision of these Terms is held to be invalid, illegal, or unenforceable,
          the remaining provisions shall continue in full force and effect. The invalid or
          unenforceable provision shall be modified to the minimum extent necessary to make
          it valid and enforceable.
        </p>
      </div>

      <div className="terms-section">
        <h2>13. Disclaimer</h2>
        <p className="terms-text">
          These Terms are provided for informational purposes and do not constitute legal
          advice. You should consult with qualified legal counsel regarding your specific
          circumstances and the applicability of these Terms in your jurisdiction. The
          $ALIENATOR token is a meme coin with no intrinsic value, created for experimental
          and entertainment purposes only.
        </p>
      </div>

      <div className="terms-section">
        <h2>14. Contact</h2>
        <p className="terms-text">
          For questions regarding these Terms or the Alienator protocol, contact the team via{" "}
          <a
            href="https://x.com/AlienatorMarket"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan"
          >
            @AlienatorMarket on X
          </a>{" "}
          or through the{" "}
          <a
            href="https://github.com/ATREU01/ALIEN-PERC"
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyan"
          >
            GitHub repository
          </a>.
        </p>
      </div>
    </div>
  );
}
