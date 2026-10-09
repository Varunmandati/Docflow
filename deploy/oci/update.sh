#!/usr/bin/env bash
# =============================================================================
# DocFlow - update to a new version in place.
#
#   ./update.sh              # pull, rebuild, restart
#   ./update.sh --no-pull    # rebuild from the working tree as-is
#
# Preserves: .env, the storage/redis volumes, and Caddy's certificates.
# Those live in named volumes and a 600-mode file, none of which are touched by
# a rebuild.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YLW=$'\033[0;33m'; CYN=$'\033[0;36m'; RST=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$CYN" "$RST" "$*"; }
ok()   { printf '%s  ok%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s  !!%s %s\n' "$YLW" "$RST" "$*"; }
die()  { printf '%s ERROR%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

PULL=true
[ "${1:-}" = "--no-pull" ] && PULL=false

[ -f .env ] || die ".env not found. Run ./setup.sh on a fresh instance first."

# ── Preflight ───────────────────────────────────────────────────────────────
say "Preflight"
docker info >/dev/null 2>&1 || die "Docker is not running"

# Rebuilding while a migration is pending is how a deployment ends up serving a
# frontend that calls an API expecting a column that does not exist yet.
if grep -qE '^RUN_MIGRATIONS_ON_START=(1|true)$' .env; then
    warn "RUN_MIGRATIONS_ON_START is enabled. Two containers will race to migrate on boot."
    warn "Recommended: run migrations explicitly (step 4) and set it to false."
fi

# Record what is running now, so a failed update can be rolled back to a known
# image rather than to "whatever was there before".
say "Current images"
CURRENT_API="$(docker inspect -f '{{.Image}}' docflow-api-1 2>/dev/null || echo none)"
CURRENT_WORKER="$(docker inspect -f '{{.Image}}' docflow-worker-1 2>/dev/null || echo none)"
printf '  api    : %s\n  worker : %s\n' "$CURRENT_API" "$CURRENT_WORKER"

# Warn if the working tree is dirty. `git pull` with local edits either fails or
# merges silently, and both are worse than being told.
if [ "$PULL" = true ]; then
    if command -v git >/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        if [ -n "$(git status --porcelain)" ]; then
            warn "working tree has uncommitted changes:"
            git status --short | sed 's/^/        /'
            die "commit or stash them before updating"
        fi
    fi
fi

# ── 1. Pull ─────────────────────────────────────────────────────────────────
if [ "$PULL" = true ]; then
    say "Pulling latest code"
    git pull --ff-only || die "git pull failed. Resolve manually, then re-run with --no-pull."
    ok "at $(git rev-parse --short HEAD)"
else
    ok "skipping pull (--no-pull)"
fi

# ── 2. Record schema state ──────────────────────────────────────────────────
# Migrations are forward-only here. Capture the current highest migration so a
# failure can be diagnosed, and so we never silently re-run 001 against a
# database that already has it.
say "Database state before upgrade"
BEFORE_MIGRATIONS="$(docker compose run --rm --no-deps -T api node backend/dist/db/migrate.js --status 2>/dev/null || echo 'unknown')"
printf '  %s\n' "$BEFORE_MIGRATIONS" | sed 's/^/  /'

# ── 3. Build ────────────────────────────────────────────────────────────────
say "Building images"
docker compose build --pull
ok "images built"

# ── 4. Migrations ───────────────────────────────────────────────────────────
say "Applying migrations"
# `--no-deps` so migrations do not wait on redis being up: they only
# need the database. Running them against a live stack this way avoids the
# window where the new api is serving against an old schema.
if docker compose run --rm --no-deps -T api node backend/dist/db/migrate.js; then
    ok "migrations applied"
else
    die "migrations failed. The previous images are still running - fix the migration and re-run.
     If a migration is not backward compatible, roll back with:
       docker compose up -d --no-build  # after restoring the old images"
fi

# ── 5. Restart ──────────────────────────────────────────────────────────────
say "Restarting services"
# Recreate in dependency order so caddy never points at a container that is not
# listening yet. Compose handles the ordering via depends_on.
docker compose up -d --remove-orphans
ok "containers recreated"

say "Waiting for health checks"
HEALTHY=false
for i in $(seq 1 36); do
    api_state="$(docker inspect -f '{{.State.Health.Status}}' docflow-api-1 2>/dev/null || echo starting)"
    if [ "$api_state" = "healthy" ]; then
        HEALTHY=true
        break
    fi
    sleep 5
done

if [ "$HEALTHY" != true ]; then
    printf '\n'
    docker compose ps
    printf '\n'
    warn "services did not all become healthy. Recent logs:"
    docker compose logs --tail=60 api worker caddy 2>&1 | sed 's/^/  /'
    die "update incomplete"
fi

# ── 6. Verify ───────────────────────────────────────────────────────────────
say "Post-update verification"
DOMAIN="$(grep -E '^DOCFLOW_DOMAIN=' .env | cut -d= -f2-)"

# 200 rather than just "responded": /v1/health returns 503 when the database,
# redis or the worker heartbeat is down, and a fresh deploy that answers 503 is
# not a successful deploy.
HEALTH_CODE="$(curl -o /tmp/docflow_health.json -w '%{http_code}' --max-time 20 "https://${DOMAIN}/v1/health" 2>/dev/null || echo 000)"
if [ "$HEALTH_CODE" = "200" ]; then
    ok "/v1/health -> 200"
elif [ "$HEALTH_CODE" = "503" ]; then
    warn "/v1/health -> 503 (degraded). Details:"
    cat /tmp/docflow_health.json 2>/dev/null | sed 's/^/        /'
    printf '\n'
    warn "  A 503 here usually means the worker heartbeat is stale:"
    warn "    docker compose logs --tail=80 worker"
    warn "  or the database/redis is unreachable."
else
    warn "/v1/health -> $HEALTH_CODE (expected 200). Is DNS resolving and 443 open?"
fi

docker compose images
docker compose ps

cat <<EOF

  ==============================================================================
   Update complete. Current images:

     api    : $(docker inspect -f '{{.Image}}' docflow-api-1 2>/dev/null | cut -c1-19)
     worker : $(docker inspect -f '{{.Image}}' docflow-worker-1 2>/dev/null | cut -c1-19)

   Previous image ids, for rollback:
     api    : ${CURRENT_API:0:19}
     worker : ${CURRENT_WORKER:0:19}

   Roll back:
     docker tag <previous-image-id> docflow/api:latest
     docker compose up -d --no-build api
  ==============================================================================

EOF
