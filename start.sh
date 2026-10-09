#!/bin/sh
set -e

# 1. Start local in-container Redis if enabled (maxmemory 64mb, noeviction, no disk writes)
if [ "$LOCAL_REDIS" = "true" ]; then
    echo "[start] Starting local in-container Redis (maxmemory 64mb, noeviction, no persistence)..."
    redis-server --daemonize yes --maxmemory 64mb --maxmemory-policy noeviction --save "" --appendonly no
    sleep 1
fi

# 2. Launch Backend API (also serves the built SPA from ./dist)
echo "[start] Launching DocFlow Backend API on port ${PORT:-8080}..."
exec node backend/dist/index.api.js
