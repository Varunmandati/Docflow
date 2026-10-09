#!/usr/bin/env bash
# =============================================================================
# DocFlow - Oracle A1 ARM64 Backup Script
#
# Creates a timestamped, compressed backup of all persistent data:
#   - Document storage (api/worker shared)
#   - Redis data (BullMQ queues)
#   - Caddy certificates
#
# Usage:  ./backup.sh [--destination /path/to/backups]
#         BACKUP_DEST=/mnt/backups ./backup.sh
#         ./backup.sh --destination s3://bucket/path (requires aws-cli)
#
# The script uses `docker compose` volume mounts so it must be run from the
# deploy/oci directory (or COMPOSE_PROJECT_NAME=docflow docker compose ...).
# =============================================================================

set -euo pipefail

# Default backup destination (local directory)
BACKUP_DEST="${BACKUP_DEST:-/var/backups/docflow}"
S3_DEST="${S3_DEST:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-docflow}"
COMPOSE_FILE="docker-compose.yml"

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --destination|-d)
            BACKUP_DEST="$2"
            shift 2
            ;;
        --s3)
            S3_DEST="$2"
            shift 2
            ;;
        --retention)
            RETENTION_DAYS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Timestamped archive name
TIMESTAMP="$(date -u +'%Y%m%d-%H%M%S')"
ARCHIVE_NAME="docflow-backup-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_DEST}/${ARCHIVE_NAME}"

echo "[backup] Starting DocFlow backup at $(date -u)"
echo "[backup] Project: ${COMPOSE_PROJECT_NAME}"
echo "[backup] Destination: ${ARCHIVE_PATH}"
echo "[backup] Retention: ${RETENTION_DAYS} days"

# Ensure destination exists
mkdir -p "${BACKUP_DEST}"

# Create a temporary directory for the backup
TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

echo "[backup] Stopping services for consistent snapshot..."
docker compose -p "${COMPOSE_PROJECT_NAME}" -f "${COMPOSE_FILE}" stop

echo "[backup] Copying volumes..."
# Use docker run with volume mounts to copy data out
docker run --rm \
    -v docflow_storage:/source:ro \
    -v "${TMPDIR}:/backup" \
    alpine:latest \
    sh -c "cd /source && tar -czf /backup/storage.tar.gz ."

docker run --rm \
    -v docflow_redis:/source:ro \
    -v "${TMPDIR}:/backup" \
    alpine:latest \
    sh -c "cd /source && tar -czf /backup/redis.tar.gz ."

docker run --rm \
    -v caddy_data:/source:ro \
    -v "${TMPDIR}:/backup" \
    alpine:latest \
    sh -c "cd /source && tar -czf /backup/caddy.tar.gz ."

# Include the .env file (secrets) if it exists - WARNING: contains secrets
if [[ -f .env ]]; then
    cp .env "${TMPDIR}/env.backup"
fi

# Create the final archive
echo "[backup] Creating final archive: ${ARCHIVE_PATH}"
tar -czf "${ARCHIVE_PATH}" -C "${TMPDIR}" .

# Restart services
echo "[backup] Restarting services..."
docker compose -p "${COMPOSE_PROJECT_NAME}" -f "${COMPOSE_FILE}" start

# Upload to S3 if configured
if [[ -n "${S3_DEST}" ]]; then
    echo "[backup] Uploading to ${S3_DEST}..."
    aws s3 cp "${ARCHIVE_PATH}" "${S3_DEST}/${ARCHIVE_NAME}"
fi

# Cleanup old local backups
echo "[backup] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DEST}" -type f -name 'docflow-backup-*.tar.gz' -mtime +"${RETENTION_DAYS}" -delete

# Report size
ARCHIVE_SIZE="$(du -h "${ARCHIVE_PATH}" | cut -f1)"
echo "[backup] Done. Archive: ${ARCHIVE_PATH} (${ARCHIVE_SIZE})"
echo "[backup] Completed at $(date -u)"