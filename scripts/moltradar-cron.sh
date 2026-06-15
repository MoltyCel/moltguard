#!/usr/bin/env bash
# MoltRadar 6h refresh: scan -> store -> atomic publish to the path Hono serves.
#
# RADAR_STORE here MUST equal the RADAR_STORE in the Hono service unit, or Hono
# silently serves a stale store. Set it in both the cron/timer env and the Hono unit.
#
# crontab:  0 */6 * * *  RADAR_STORE=/srv/moltguard/data/radar_store.json /srv/moltguard/moltradar-cron.sh >> /var/log/moltradar.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

RADAR_STORE="${RADAR_STORE:-$PWD/data/radar_store.json}"
dest_dir="$(dirname "$RADAR_STORE")"
mkdir -p "$dest_dir"

tmp=""
trap '[ -n "$tmp" ] && rm -f "$tmp"' EXIT   # never leak a hidden temp on kill

python3 moltradar_scan.py            # -> active_wallets.json (cwd)
python3 moltradar_store_writer.py    # -> radar_store.json    (cwd)

# sanity gate: don't overwrite a good store with a drastically thinner one
# (guards against a partial RPC sweep that "succeeds" but is semantically degraded)
new_count=$(python3 -c "import json;print(len(json.load(open('radar_store.json'))['markets']))")
old_count=0
if [ -f "$RADAR_STORE" ]; then
  old_count=$(python3 -c "import json;print(len(json.load(open('$RADAR_STORE')).get('markets',{})))" 2>/dev/null || echo 0)
fi
if [ "$old_count" -ge 10 ] && [ "$new_count" -lt $((old_count / 2)) ]; then
  echo "$(date -u +%FT%TZ) DEGRADED: new=$new_count < 50% of live=$old_count — keeping last good store" >&2
  exit 3
fi

# atomic publish: temp in the SAME dir (same fs), readable perms, then mv over live
tmp="$(mktemp "$dest_dir/.radar_store.XXXXXX")"
cp -f radar_store.json "$tmp"
chmod 0644 "$tmp"                    # mktemp is 0600; store must be readable by the Hono user
mv -f "$tmp" "$RADAR_STORE"
tmp=""
echo "$(date -u +%FT%TZ) published $RADAR_STORE ($new_count markets)"
