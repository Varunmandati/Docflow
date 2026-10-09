#!/usr/bin/env bash
# =============================================================================
# DocFlow - first-time setup for an Oracle A1 instance.
#
# Run as the non-root `ubuntu` user on a fresh instance:
#
#   git clone <repo> ~/docflow
#   cd ~/docflow/deploy/oci
#   ./setup.sh
#
# Idempotent: re-running it will NOT overwrite secrets already present in .env.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; CYN=$'\033[0;36m'; RST=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s  !!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s ERROR%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

# ── 0. Preconditions ────────────────────────────────────────────────────────
command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "docker compose v2 is required (apt install docker-compose-v2)"

if [ "$(id -u)" -eq 0 ]; then
    warn "running as root; the ubuntu user is the supported account for docker on OCI"
fi

say "Checking Docker"
docker info >/dev/null 2>&1 || die "Docker is not running. Run: sudo systemctl start docker"
ok "docker $(docker version --format '{{.Server.Version}}')"

# Oracle Linux images ship podman, not Docker. Podman answers to `docker` via a
# shim on some images and Compose behaves differently enough (rootless port
# binding, volume labels) that a half-working deployment is worse than a clear
# stop.
if command -v podman >/dev/null 2>&1 && [ ! -d /var/lib/docker ]; then
    die "podman detected instead of Docker. Install Docker Engine:
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg
  echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable' | sudo tee /etc/apt/sources.list.d/docker.list
  sudo apt update && sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin"
fi

# ── 1. Architecture check ───────────────────────────────────────────────────
ARCH="$(uname -m)"
say "Host architecture: $ARCH"
case "$ARCH" in
  aarch64|arm64) ok "ARM64 - the Oracle A1 target" ;;
  x86_64)        warn "x86_64 host. Images will build for x86_64; the A1 deployment needs linux/arm64.
     For a local arm64 dry run:  docker buildx create --use && docker buildx build --platform linux/arm64" ;;
  *) die "unsupported architecture: $ARCH" ;;
esac

# ── 2. .env ─────────────────────────────────────────────────────────────────
say "Preparing .env"
if [ ! -f .env ]; then
    cp .env.example .env
    chmod 600 .env
    ok "created .env from .env.example (mode 600)"
else
    ok ".env already exists - leaving it untouched"
fi

# Generate a secret only if the key is present-but-empty. Never overwrite.
gen_secret() {
    local key="$1" bytes="$2"
    local current
    current="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- || true)"
    if [ -n "$current" ]; then
        ok "$key already set (kept)"
        return
    fi
    local value
    value="$(openssl rand -hex "$bytes")"
    # `|` rather than `/` as the sed delimiter, and escape any `&` in the value.
    local escaped
    escaped="$(printf '%s' "$value" | sed -e 's/[&|]/\\&/g')"
    sed -i "s|^${key}=.*|${key}=${escaped}|" .env
    ok "$key generated (${bytes} random bytes)"
}

say "Generating internal secrets"
gen_secret REDIS_PASSWORD 24             # 48 hex chars

chmod 600 .env
ok ".env is mode 600"

# ── 3. Required values ──────────────────────────────────────────────────────
say "Checking required configuration"
REQUIRED=(
  DOCFLOW_DOMAIN
  ACME_EMAIL
  DATABASE_URL
  DATABASE_URL_DIRECT
  DATABASE_URL_WORKER
  VITE_FIREBASE_API_KEY
  VITE_FIREBASE_AUTH_DOMAIN
  VITE_FIREBASE_PROJECT_ID
  VITE_FIREBASE_APP_ID
)
MISSING=()
for key in "${REQUIRED[@]}"; do
    value="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- || true)"
    if [ -z "$value" ]; then
        MISSING+=("$key")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    printf '%s ERROR%s still needs values in %s/.env:\n' "$RED" "$RST" "$(pwd)"
    for key in "${MISSING[@]}"; do
        printf '        - %s\n' "$key"
    done
    cat <<'EOF'

  Where to get them:
    DOCFLOW_DOMAIN / ACME_EMAIL  your domain + admin address
    DATABASE_URL                 Neon console -> the -pooled connection string
    DATABASE_URL_DIRECT          Neon console -> the non-pooled string (migrations)
    DATABASE_URL_WORKER          Neon console -> a SEPARATE role with BYPASSRLS
    VITE_FIREBASE_*              Firebase console -> Project settings -> Your apps

  Note: the VITE_* values are compiled into the browser bundle at BUILD time.
  Fill them in before the first build or the SPA will ship with Firebase
  disabled and auth will silently not work.

EOF
    exit 1
fi
ok "all required values present"

# ── 4. Validate the production invariants before building ───────────────────
say "Validating configuration"
set -a; . ./.env; set +a

if grep -q '^CORS_ORIGIN=\*' .env; then
    die "CORS_ORIGIN=* is not permitted. The deployment is same-origin; leave it empty."
fi
ok "configuration looks valid"

# Neon pooled vs direct confusion is the single most common cause of "it works
# locally, hangs in production": pgbouncer rejects PREPARE and session state.
if [[ "${DATABASE_URL}" == *"pgbouncer=true"* ]] && [[ "${DATABASE_URL}" == *"-pooled"* ]]; then
    warn "DATABASE_URL looks like a pooled URL. That is expected for the api."
fi
if [[ "${DATABASE_URL_WORKER}" == *"pgbouncer=true"* ]]; then
    die "DATABASE_URL_WORKER must be a DIRECT (non-pooled) connection string. BullMQ jobs hold a connection across awaits, which a transaction pool breaks."
fi
ok "database connection strings look consistent"

# ── 5. Storage directories ──────────────────────────────────────────────────
say "Creating storage directories"
sudo mkdir -p /data/docflow/storage
sudo chown -R "$(id -u):$(id -g)" /data/docflow
chmod 700 /data/docflow/storage
ok "/data/docflow/storage ready"

# ── 6. Build ────────────────────────────────────────────────────────────────
say "Building images (this takes 10-20 minutes on a 1-OCPU shape)"
docker compose build --pull
ok "images built"

# ── 7. Migrations ───────────────────────────────────────────────────────────
say "Running database migrations"
docker compose run --rm --no-deps api node backend/dist/db/migrate.js \
    || die "migrations failed. Check DATABASE_URL_DIRECT in .env."
ok "migrations applied"

# ── 8. Start ────────────────────────────────────────────────────────────────
say "Starting the stack"
docker compose up -d
ok "containers started"

say "Waiting for health checks (up to 3 minutes)"
for i in $(seq 1 36); do
    api_state="$(docker inspect -f '{{.State.Health.Status}}' docflow-api-1 2>/dev/null || echo starting)"
    if [ "$api_state" = "healthy" ]; then
        ok "api is healthy"
        break
    fi
    sleep 5
done

docker compose ps

# ── 9. Post-flight report ───────────────────────────────────────────────────
say "Post-flight checks"
DOMAIN="$(grep -E '^DOCFLOW_DOMAIN=' .env | cut -d= -f2-)"
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<unavailable>')"

printf '\n'
printf '  Domain       : %s\n' "$DOMAIN"
printf '  Public IP    : %s\n' "$PUBLIC_IP"
printf '\n'

# Certificate issuance fails silently behind a closed security list, and the
# symptom is a confusing "connection reset" rather than a useful error.
say "Testing TLS"
if curl -fsS --max-time 20 "https://${DOMAIN}/health" >/dev/null 2>&1; then
    ok "https://${DOMAIN}/health responded"
else
    warn "https://${DOMAIN}/health did not respond. Usual causes:"
    printf '         1. DNS A record does not point at %s yet\n' "$PUBLIC_IP"
    printf '         2. Inbound TCP 80 and 443 not open in the VCN security list\n'
    printf '         3. OCI shape firewall (iptables) still blocking\n'
    printf '         4. A domain mismatch means Caddy is still waiting on a cert\n'
    printf '       Check:  docker compose logs caddy | tail -40\n'
fi

say "Readiness report"
curl -fsS --max-time 10 "https://${DOMAIN}/v1/health" 2>/dev/null | sed 's/^/  /' || true
printf '\n'

cat <<EOF

  ==============================================================================
   Setup complete.

   Next:
     1. Point DNS:      ${DOMAIN}.A -> ${PUBLIC_IP}
     2. Open ingress:   TCP 80, TCP 443 (and UDP 443 for HTTP/3)
     3. Restart caddy:  docker compose restart caddy
     4. Verify:         curl -fsS https://${DOMAIN}/v1/health

   Not open by default, and that is deliberate:
      - SSH is restricted to your own IP in the VCN security list.

   Verify worker liveness:  the worker.stale field in /v1/health above
   Logs:                    docker compose logs -f api worker
  ==============================================================================

EOF
