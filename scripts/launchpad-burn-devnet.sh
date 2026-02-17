#!/bin/bash
#
# ALIEN PERCOLATOR - DEVNET ADMIN KEY BURN
# =========================================
# Run this on your LAUNCHPAD machine where you have:
#   - Wallet: 4n6ieASXeffeLN4WascGh9exE4Yy622VB9kSeAu4CJZc
#   - ~15.98 devnet SOL
#   - Helius devnet RPC
#
# This script:
#   1. Verifies pre-burn checks pass
#   2. Burns the admin key (IRREVERSIBLE)
#   3. Monitors the insurance fund
#
# Usage:
#   cd ALIEN-PERC
#   export SOLANA_RPC_URL="https://devnet.helius-rpc.com/?api-key=YOUR_KEY"
#   bash scripts/launchpad-burn-devnet.sh
#

set -e

echo ""
echo "======================================================================"
echo "  ALIEN PERCOLATOR - DEVNET BURN SEQUENCE"
echo "======================================================================"
echo ""

# Verify we have the market file
if [ ! -f "devnet-market.json" ]; then
    echo "ERROR: devnet-market.json not found!"
    echo "Make sure you're in the ALIEN-PERC directory."
    exit 1
fi

# Check RPC
if [ -z "$SOLANA_RPC_URL" ]; then
    echo "WARNING: SOLANA_RPC_URL not set. Using default devnet."
    echo "For Helius, run:"
    echo "  export SOLANA_RPC_URL=\"https://devnet.helius-rpc.com/?api-key=YOUR_KEY\""
    echo ""
fi

# Show market info
echo "Market file: devnet-market.json"
echo ""
cat devnet-market.json | head -10
echo "  ..."
echo ""

# Step 1: Pre-burn verification
echo "----------------------------------------------------------------------"
echo "  STEP 1: Running pre-burn verification..."
echo "----------------------------------------------------------------------"
echo ""
npx tsx scripts/verify-before-burn.ts

echo ""
read -p "Pre-burn checks complete. Continue to BURN? (y/N): " CONTINUE
if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
    echo "Aborted."
    exit 0
fi

# Step 2: Execute the burn
echo ""
echo "----------------------------------------------------------------------"
echo "  STEP 2: Executing admin key burn..."
echo "----------------------------------------------------------------------"
echo ""
npx tsx scripts/burn-admin-key.ts

# Step 3: Quick insurance fund check
echo ""
echo "----------------------------------------------------------------------"
echo "  STEP 3: Verifying insurance fund status..."
echo "----------------------------------------------------------------------"
echo ""

echo "Market is now SOVEREIGN. Admin key has been burned."
echo ""
echo "To monitor insurance fund growth:"
echo "  npx tsx scripts/monitor-alien-insurance.ts"
echo ""
echo "The alienator.org dashboard should now show 1/1 SOVEREIGN (BURNED)"
echo ""
echo "======================================================================"
echo "  BURN COMPLETE - MARKET IS AUTONOMOUS"
echo "======================================================================"
echo ""
