#!/bin/bash
# Drift-Check: Prüft ob CONFORMANCE.md und Live-API synchron sind.
# Exit 0 = synchron, Exit 1 = Drift erkannt, Exit 2 = API unerreichbar.

set -eo pipefail

API_URL="https://api.moltrust.ch/guard/audit/version"
CONFORMANCE_FILES=(
    "$HOME/moltrust-protocol/docs/CONFORMANCE.md"
    "/var/www/html/CONFORMANCE.md"
)

# 1. API-Checksum holen
API_RESPONSE=$(curl -s -m 10 "$API_URL" 2>/dev/null) || {
    echo "API unreachable: $API_URL"
    exit 2
}

API_CHECKSUM=$(echo "$API_RESPONSE" | python3 -c "import json,sys;print(json.load(sys.stdin)[\"checksum\"])" 2>/dev/null) || {
    echo "Invalid API response:"
    echo "$API_RESPONSE" | head -c 200
    exit 2
}

echo "API checksum: $API_CHECKSUM"

# 2. Jede CONFORMANCE.md prüfen
DRIFT=0
for file in "${CONFORMANCE_FILES[@]}"; do
    if [ ! -f "$file" ]; then
        echo "Missing file: $file"
        DRIFT=1
        continue
    fi

    MD_CHECKSUM=$(grep "checksum" "$file" | grep -oE "[a-f0-9]{16}" | head -1)
    MD_CHECKSUM=${MD_CHECKSUM:-none}

    if [ "$API_CHECKSUM" = "$MD_CHECKSUM" ]; then
        echo "OK $file ($MD_CHECKSUM)"
    else
        echo "DRIFT: $file"
        echo "     API: $API_CHECKSUM"
        echo "     MD:  $MD_CHECKSUM"
        DRIFT=1
    fi
done

# 3. Exit mit klarer Message
if [ $DRIFT -eq 1 ]; then
    echo ""
    echo "To fix: python3 ~/moltguard/scripts/gen_conformance.py"
    exit 1
fi

echo ""
echo "All CONFORMANCE.md files in sync with live API"
exit 0
