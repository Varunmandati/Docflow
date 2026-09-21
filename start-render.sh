#!/bin/sh
set -e

# 1. Start local in-container Redis if enabled
if [ "$LOCAL_REDIS" = "true" ]; then
    echo "[start] Starting local in-container Redis (maxmemory 64mb, no persistence)..."
    redis-server --daemonize yes --maxmemory 64mb --maxmemory-policy noeviction --save "" --appendonly no
    sleep 1
fi

# 2. Sidecar streamtor control
if [ "$STREAMTOR_ENABLED" = "false" ]; then
    echo "[start] Streamtor disabled (STREAMTOR_ENABLED=false) — launching backend API"
    exec node backend/dist/index.api.js
else
    echo "[start] Launching backend API and Streamtor sidecar via concurrently"
    exec concurrently "node backend/dist/index.api.js" "STREAMTOR_PORT=3002 node streamtor/dist/server.js"
fi
