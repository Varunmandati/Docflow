#!/bin/sh
set -e

# 1. Start local in-container Redis if enabled
if [ "$LOCAL_REDIS" = "true" ]; then
    echo "[start] Starting local in-container Redis (maxmemory 64mb, no persistence)..."
    redis-server --daemonize yes --maxmemory 64mb --maxmemory-policy noeviction --save "" --appendonly no
    sleep 1
fi

# 2. Launch the backend API (also serves the built SPA from ./dist)
echo "[start] Launching backend API"
exec node backend/dist/index.api.js
