#!/bin/bash
echo "╔══════════════════════════════════════════════╗"
echo "║         MT Shopping — E2E Demo               ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

cd "$(dirname "$0")/.." || exit 1

# Start mock merchant in background
echo "[0] Starting mock merchant on port 3001..."
npx tsx demo/mock-merchant/index.ts &
MERCHANT_PID=$!
sleep 3

# Check merchant is running
if ! curl -s http://localhost:3001/merchant/health > /dev/null 2>&1; then
  echo "ERROR: Mock merchant failed to start"
  kill $MERCHANT_PID 2>/dev/null
  exit 1
fi
echo "[0] Mock merchant running (PID: $MERCHANT_PID)"
echo ""

# Run shopping agent
echo "─────────────────────────────────────────────────"
echo ""
AGENT_DID=did:base:0x380238347e58435f40B4da1F1A045A271D5838F5 \
HUMAN_DID=did:base:0xHumanPrincipal789 \
MERCHANT_URL=http://localhost:3001 \
npx tsx demo/shopping-agent/index.ts

# Cleanup
echo ""
echo "[Cleanup] Stopping mock merchant..."
kill $MERCHANT_PID 2>/dev/null
wait $MERCHANT_PID 2>/dev/null

echo ""
echo "═══════════════════════════════════════════════"
echo "  E2E test complete."
echo "═══════════════════════════════════════════════"
