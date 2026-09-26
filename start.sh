#!/bin/sh
set -e

# 1. Start local in-container Redis if enabled (maxmemory 64mb, noeviction, no disk writes)
if [ "$LOCAL_REDIS" = "true" ]; then
    echo "[start] Starting local in-container Redis (maxmemory 64mb, noeviction, no persistence)..."
    redis-server --daemonize yes --maxmemory 64mb --maxmemory-policy noeviction --save "" --appendonly no
    sleep 1
fi

# 2. StreamTor (WebTorrent) - internal only, never on the public port.
#    The API reverse-proxies /api/torrents to it, so both processes must agree
#    on the port and on the shared token. Both values are exported here, which
#    also wins over anything a .env file might otherwise load, so the pairing
#    cannot drift.
export STREAMTOR_PORT="${STREAMTOR_PORT:-3002}"
export STREAMTOR_INTERNAL_URL="${STREAMTOR_INTERNAL_URL:-http://127.0.0.1:${STREAMTOR_PORT}}"
if [ -z "$STREAMTOR_INTERNAL_TOKEN" ]; then
    STREAMTOR_INTERNAL_TOKEN=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
    export STREAMTOR_INTERNAL_TOKEN
    echo "[start] Minted an ephemeral STREAMTOR_INTERNAL_TOKEN (set one explicitly to pin it across restarts)."
fi

# Heap cap keeps StreamTor from pushing the whole container past its memory
# limit: worst case torrents stop, the API keeps serving. Override with
# STREAMTOR_NODE_OPTIONS if you have RAM to spare.
STREAMTOR_NODE_OPTIONS="${STREAMTOR_NODE_OPTIONS:---max-old-space-size=96}"

if [ "${STREAMTOR_ENABLED:-true}" != "false" ]; then
    echo "[start] Launching StreamTor (WebTorrent) on 127.0.0.1:${STREAMTOR_PORT}..."
    # Subshell so the `cd` does not move the API's working directory - both
    # Fastify's static root and StreamTor's static root resolve against cwd.
    (cd /app/streamtor && NODE_ENV="${NODE_ENV:-production}" NODE_OPTIONS="$STREAMTOR_NODE_OPTIONS" node dist/server.js) &
fi

# 3. Launch Backend API (also serves the built SPA from ./dist)
echo "[start] Launching DocFlow Backend API on port ${PORT:-8080}..."
exec node backend/dist/index.api.js
