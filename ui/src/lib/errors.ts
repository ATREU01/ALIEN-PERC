/**
 * Percolator program error definitions.
 * Copied from percolator-ALIEN/src/abi/errors.ts
 */
interface ErrorInfo {
  name: string;
  hint: string;
}

export const PERCOLATOR_ERRORS: Record<number, ErrorInfo> = {
  0: { name: "InvalidMagic", hint: "The market account has invalid data. Make sure you're on the right market." },
  1: { name: "InvalidVersion", hint: "Market version mismatch. The program may have been upgraded." },
  2: { name: "AlreadyInitialized", hint: "This account is already initialized." },
  3: { name: "NotInitialized", hint: "The market is not initialized yet." },
  4: { name: "InvalidSlabLen", hint: "Market account has wrong size." },
  5: { name: "InvalidOracleKey", hint: "Oracle account doesn't match the market config." },
  6: { name: "OracleStale", hint: "Oracle price is too old. Wait a moment and try again." },
  7: { name: "OracleConfTooWide", hint: "Oracle confidence interval is too wide. Wait for more stable conditions." },
  8: { name: "InvalidVaultAta", hint: "Vault token account is invalid." },
  9: { name: "InvalidMint", hint: "Wrong collateral token. Make sure you have the right token." },
  10: { name: "ExpectedSigner", hint: "Missing wallet signature." },
  11: { name: "ExpectedWritable", hint: "Account must be writable — this may be a bug." },
  12: { name: "OracleInvalid", hint: "Oracle data is invalid." },
  13: { name: "InsufficientBalance", hint: "Not enough collateral. Deposit more tokens before trading." },
  14: { name: "Undercollateralized", hint: "Account is undercollateralized. Add more collateral or reduce position/leverage." },
  15: { name: "Unauthorized", hint: "Not authorized — you must be the account owner." },
  16: { name: "InvalidMatchingEngine", hint: "Matcher program doesn't match LP config." },
  17: { name: "PnlNotWarmedUp", hint: "PnL not warmed up yet. Wait a moment and try again." },
  18: { name: "Overflow", hint: "Number too large. Try a smaller amount or leverage." },
  19: { name: "AccountNotFound", hint: "Account not found. Your account may not be created yet — try trading again." },
  20: { name: "NotAnLPAccount", hint: "Expected an LP account but got a user account." },
  21: { name: "PositionSizeMismatch", hint: "Position size mismatch — please report this bug." },
  22: { name: "RiskReductionOnly", hint: "Market is in risk-reduction mode. Only closing trades are allowed." },
  23: { name: "AccountKindMismatch", hint: "Wrong account type for this operation." },
  24: { name: "InvalidTokenAccount", hint: "Token account is invalid. Make sure you have the collateral token in your wallet." },
  25: { name: "InvalidTokenProgram", hint: "Invalid token program." },
  26: { name: "InvalidConfigParam", hint: "Invalid config parameter. Check per-market admin limits and constraints." },
  27: { name: "HyperpTradeNoCpiDisabled", hint: "Hyperp mode requires CPI trades. Use the trade panel instead of direct TradeNoCpi." },
};

/**
 * Parse a Percolator error code from transaction logs or error objects.
 * Returns a user-friendly error message with actionable hint.
 */
export function parsePercError(logs: string[] | null, err: any): string | null {
  // Try to extract from logs first
  if (logs) {
    for (const log of logs) {
      const match = log.match(/custom program error: 0x([0-9a-fA-F]+)/);
      if (match) {
        const code = parseInt(match[1], 16);
        const info = PERCOLATOR_ERRORS[code];
        if (info) return `${info.name} — ${info.hint}`;
        return `Program error 0x${match[1]}`;
      }
    }
  }
  // Try to extract from error object (e.g., { InstructionError: [2, { Custom: 13 }] })
  if (err && typeof err === "object") {
    const errStr = JSON.stringify(err);
    const customMatch = errStr.match(/"Custom":(\d+)/);
    if (customMatch) {
      const code = parseInt(customMatch[1], 10);
      const info = PERCOLATOR_ERRORS[code];
      if (info) return `${info.name} — ${info.hint}`;
      return `Program error code ${code}`;
    }
  }
  return null;
}
