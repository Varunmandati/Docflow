#!/usr/bin/env bash
# =============================================================================
# DocFlow - one-shot bootstrap for a fresh Linux VM
# (tested on Ubuntu 22.04 / 24.04, works on x86_64 and arm64/Ampere)
#
#   sudo bash deploy/oracle/setup.sh
#
# What it does:
#   1. installs Docker Engine + the compose plugin (if missing)
#   2. clones (or updates) the repo into /opt/docflow
#   3. creates /opt/docflow/.env from the template on the first run and stops
#      so you can fill in your secrets
#   4. on later runs: builds the image and starts the stack (restart: unless-
#      stopped keeps it up 24/7, including after a reboot)
#
# Overrides: REPO_URL, REPO_BRANCH, APP_DIR as environment variables.
# =============================================================================
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Varunmandati/Docflow.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/docflow}"

log()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root: sudo bash deploy/oracle/setup.sh"

# --- 1. Docker ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

if ! docker compose version >/dev/null 2>&1; then
  log "Installing the Docker compose plugin"
  apt-get update -qq
  apt-get install -y -qq docker-compose-plugin docker-compose-v2 2>/dev/null || \
    apt-get install -y -qq docker-compose-plugin || fail "docker compose is unavailable"
fi

command -v git >/dev/null 2>&1 || { log "Installing git"; apt-get update -qq; apt-get install -y -qq git; }

# --- 2. Source ---------------------------------------------------------------
if [ ! -d "$APP_DIR/.git" ]; then
  log "Cloning $REPO_URL ($REPO_BRANCH) into $APP_DIR"
  git clone --depth 1 -b "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
else
  log "Updating existing checkout"
  git -C "$APP_DIR" fetch --depth 1 origin "$REPO_BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH" || true
fi

# --- 3. Environment ----------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cp "$APP_DIR/.env.production.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "Created $ENV_FILE from the template"
fi

if grep -Eq 'PLACEHOLDER_PASSWORD|re_your_api_key_here|your-web-api-key|your-project|your_firebase' "$ENV_FILE"; then
  cat <<EOF

Your .env still contains template placeholders. Edit it now:

    nano $ENV_FILE

Minimum required:
  - section 2 : DATABASE_URL / DATABASE_URL_WORKER / DATABASE_URL_DIRECT (Neon)
  - section 5 : RESEND_API_KEY (OTP emails)
  - section 6 : FIREBASE_SERVICE_ACCOUNT (Google login)
  - section 7 : VITE_FIREBASE_* (browser Firebase config)

Then re-run this script to build and start DocFlow.
EOF
  exit 1
fi

# --- 4. Build & start --------------------------------------------------------
cd "$APP_DIR"
log "Building the image (first run takes a few minutes)"
docker compose build

log "Starting DocFlow"
docker compose up -d

# --- 5. Report ---------------------------------------------------------------
IP="$(curl -fsS --max-time 5 http://169.254.169.254/opc/v1/vnics/ 2>/dev/null \
  | sed -n 's/.*"publicIp": *"\([^"]*\)".*/\1/p' | head -n1 || true)"
[ -n "$IP" ] || IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"

log "Waiting for the health endpoint"
ok=""
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 http://127.0.0.1:${DOCFLOW_PORT:-8080}/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

docker compose ps
if [ -n "$ok" ]; then
  cat <<EOF

DocFlow is up:
  health : http://${IP:-<server-ip>}:${DOCFLOW_PORT:-8080}/health
  app    : http://${IP:-<server-ip>}:${DOCFLOW_PORT:-8080}

  logs   : docker compose logs -f
  status : docker compose ps
  stop   : docker compose down
EOF
else
  cat <<EOF

The container is running but /health has not answered yet.
Check: docker compose logs --tail=100
EOF
fi
