# DocFlow - Oracle A1 ARM64 Deployment

Production deployment for DocFlow on Oracle Cloud Infrastructure "Always Free" A1.Flex (ARM64) instances.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Oracle A1 Instance                           │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │   Caddy      │    │   API        │    │   Worker             │  │
│  │   :80/:443   │───▶│   :8080      │    │   (conversions)      │  │
│  │  (TLS +      │    │  (Fastify +  │    │  (LibreOffice,       │  │
│  │   Reverse    │    │   Static)    │    │   ffmpeg, 7z,        │  │
│  │   Proxy)     │    │              │    │   pdf2docx)          │  │
│  └──────────────┘    └──────┬───────┘    └──────────┬────────────┘  │
│                             │                       │              │
│                             └───────────┬───────────┘              │
│                              ┌──────────▼──────────┐               │
│                              │   Redis  :6379      │               │
│                              │  (BullMQ broker)    │               │
│                              └─────────────────────┘               │
│                                                                     │
│  Volumes:                                                         │
│  /data/docflow/storage  (documents, shared API+Worker)           │
│  /data/docflow/redis    (BullMQ queue persistence)               │
│  /data/caddy            (ACME certificates)                      │
└─────────────────────────────────────────────────────────────────────┘
```

**Key properties:**
- Only Caddy publishes ports (80, 443 TCP + 443 UDP for HTTP/3)
- All internal communication on Docker `backend` bridge network
- ARM64 native images (no x86 emulation)

---

## Quick Start

### Prerequisites
- Oracle Cloud account with A1.Flex instance provisioned (4 OCPU / 24 GB or 1 OCPU / 6 GB)
- Domain name with A record pointing to the instance public IP
- Docker 24+ and Docker Compose v2 installed on the instance
- Neon PostgreSQL database, Firebase project, Resend account (or SMTP)

### 1. Clone and Configure

```bash
git clone <your-fork> docflow
cd docflow/deploy/oci
cp .env.example .env
chmod 600 .env
```

Edit `.env` with your values (see [Environment Variables](#environment-variables)).

### 2. Run Setup

```bash
./setup.sh
```

This will:
- Generate all secrets (tokens, passwords)
- Build all Docker images (ARM64 native)
- Run database migrations
- Start all services via `docker compose up -d`
- Configure Caddy with automatic HTTPS via Let's Encrypt

### 3. Verify

```bash
# Check all services healthy
docker compose ps

# Test HTTPS
curl -I https://your-domain.com/health

# Test API
curl -H "Authorization: Bearer <firebase-id-token>" \
     https://your-domain.com/v1/health
```

---

## Environment Variables

### Required (no defaults - `setup.sh` generates or prompts)

| Variable | Description |
|----------|-------------|
| `DOCFLOW_DOMAIN` | Public domain (e.g., `docflow.example.com`) |
| `ACME_EMAIL` | Email for Let's Encrypt expiry notices |
| `REDIS_PASSWORD` | Redis auth password (generated) |
| `FIREBASE_SERVICE_ACCOUNT` | Full JSON service account (single line) |
| `RESEND_API_KEY` | Or SMTP credentials if using SMTP |
| `EMAIL_FROM` | Sender address (e.g., `DocFlow <noreply@docflow.example.com>`) |
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_DIRECT` | Neon direct (non-pooled) for migrations |
| `DATABASE_URL_WORKER` | Worker connection string (needs BYPASSRLS) |

### Optional (have safe defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_CONCURRENCY` | `1` | BullMQ worker parallelism |
| `WORKER_MEMORY_LIMIT` | `3g` | Docker memory limit |
| `REDIS_MEMORY_LIMIT` | `512m` | Docker memory limit |
| `LOG_LEVEL` | `info` | `fatal\|error\|warn\|info\|debug\|trace` |

---

## Service Details

### Caddy (TLS Termination + Reverse Proxy)
- Automatic HTTPS via Let's Encrypt (HTTP-01 + TLS-ALPN-01)
- Access logs: JSON, filtered (no Authorization, no query strings)
- Request body limit: 512 MB
- Long-lived connections: no read/write timeout, 120s response header timeout

### API (Fastify + Static SPA)
- Firebase ID token verification on all routes except `/health`
- Rate limiting: per-IP + per-user
- Same-origin: `CORS_ORIGIN=""` (no CORS headers)

### Worker (BullMQ + LibreOffice/ffmpeg/7z)
- Exactly 1 replica (memory-bound on A1)
- Healthcheck: verifies conversion toolchain presence
- Toolchain: LibreOffice, ffmpeg, Ghostscript, 7z, pdf2docx (best-effort on ARM64)

### Redis (BullMQ Broker)
- AOF persistence (appendonly)
- Password auth (required)
- Maxmemory 384 MB, `volatile-lru` eviction
- Healthcheck: authenticated PING

---

## Operations

### Health Checks
```bash
# Overall stack
docker compose ps

# Individual services
curl -s http://localhost:8080/health      # API liveness
curl -s http://localhost:8080/v1/health   # API readiness (DB/Redis/worker)
```

### Logs
```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f caddy
```

### Backup
```bash
./backup.sh                    # Local backup to /var/backups/docflow
BACKUP_DEST=/mnt/backups ./backup.sh
S3_DEST=s3://my-bucket/docflow ./backup.sh  # Requires aws-cli
```
Backups include: document storage, Redis data, Caddy certs.
Retention: 30 days default (`BACKUP_RETENTION_DAYS`).

### Update / Rolling Deploy
```bash
./update.sh              # Pull, build, migrate, rolling restart
./update.sh --status     # Show migration status without applying
```
- Runs migrations before API restart
- Graceful shutdown (60s) for in-flight conversions
- Single-replica worker: no blue/green, brief downtime

### Migration Status
```bash
docker compose run --rm api node backend/dist/db/migrate.js --status
```
Shows applied vs pending migrations without modifying the database.

### Scaling Notes
- **Worker**: Do NOT scale beyond 1 on A1 (LibreOffice memory)
- **API**: Can scale if Redis fallback `memory` enabled and sticky sessions configured

---

## ARM64 Notes

- Base images: `node:20-bookworm-slim`, `redis:7-alpine`, `caddy:2-alpine` — all multi-arch
- `pdf2docx` (PyMuPDF/numpy) may lack ARM64 wheels
  - Installed with `--only-binary=:all:`; missing wheel = marker file
  - API returns clear error if PDF→DOCX requested but unavailable

---

## Security Checklist

- [ ] `.env` is `chmod 600` and **never committed**
- [ ] `REDIS_PASSWORD` is URL-safe hex (no special chars)
- [ ] `FIREBASE_SERVICE_ACCOUNT` is single-line JSON
- [ ] Caddy logs redact Authorization headers and query strings
- [ ] `backup.sh` destination is encrypted/off-site

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `503` from `/v1/health` | Worker heartbeat stale / Redis down | Check worker logs, Redis health |
| `413` on upload | File > `MAX_UPLOAD_BYTES` (100 MB) | Increase or split |
| `pdf2docx` unavailable | No ARM64 wheel | Expected on ARM64; use LibreOffice path |
| Caddy cert renewal fails | Port 80 blocked in OCI security list | Open 80 + 443 for ACME |

---

## File Layout

```
deploy/oci/
├── README.md              # This file
├── docker-compose.yml     # Stack definition
├── Caddyfile              # TLS + reverse proxy
├── .env.example           # Template (copy to .env)
├── setup.sh               # Bootstrap: secrets, build, migrate, up
├── update.sh              # Rolling update with migration
├── backup.sh              # Backup all volumes (+ optional S3)
├── redis.conf.template    # Redis config (rendered at startup)
├── redis-entrypoint.sh    # Renders config, starts Redis with auth
└── Dockerfile.backend     # API + Worker (multi-stage)
```

---

## License & Compliance

- Ensure compliance with:
  - Oracle Cloud Terms of Service
  - Local copyright law
  - Your organization's acceptable use policy
- Only lawful content you are authorized to process should be handled