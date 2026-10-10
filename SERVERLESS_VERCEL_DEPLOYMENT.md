# DocFlow — Vercel Serverless Deployment

This document covers the Vercel deployment shape only. It is fully additive:
the existing Docker / Render / OCI deployments are untouched and keep working
with their current environment variables (no `STORAGE_BACKEND` / `QUEUE_BACKEND`
/ `CONVERTER_PROVIDER` set ⇒ disk + BullMQ + local engines, exactly as before).

---

## 1. Architecture on Vercel

| Concern | Long-running deployment | Vercel deployment |
|---|---|---|
| API | Fastify server process | `api/backend.ts` — serverless function that boots the same Fastify app once per cold start and serves every request through `app.inject()`; `vercel.json` rewrites `/v1/*` and `/health` into it |
| File storage | Local disk (`STORAGE_ROOT`) | Cloudflare R2 (`STORAGE_BACKEND=r2`); uploads go browser → presigned R2 PUT (no 4.5MB function-body limit), metadata in Postgres (`uploads` table, migration 005); job artifacts are published to R2 under the same `jobs/{jobId}/...` keys so download URLs and ownership checks are unchanged |
| Queue | BullMQ + Redis | Upstash QStash (`QUEUE_BACKEND=qstash`); `/v1/convert` and `/v1/compress` publish via raw HTTP to QStash instead of `queue.add`; QStash delivers to `api/jobs/convert.ts` / `api/jobs/compress.ts`, which run the **same shared processors** the BullMQ worker uses (extracted from the workers, not duplicated) and persist progress into Postgres — the frontend polls `/v1/jobs/:id` exactly as before |
| Conversion engines | LibreOffice / ffmpeg / ghostscript / 7z / pdftoppm binaries | `CONVERTER_PROVIDER=remote` — binary-dependent pairs are routed by category (`selectRemoteProvider`): documents/images/PDFs → **ConvertAPI**, audio/video/7z pairs → **CloudConvert** (ConvertAPI has zero A/V support and no archive↔archive), zip/tar/tar.gz interconversion → **local pure-JS engine** (`ArchiveJsEngine`, JSZip + zlib, free & instant), raster (`sharp`)/HEIC stay in-process; office→PDF and other multi-step chains handled stepwise; `tsv→pdf` and `avif→pdf` get local pre-steps (delimiter rewrite / sharp rasterize) before the API call |
| Compression | gs / pdftoppm / ffmpeg | Images and ZIP/office archives compress locally (sharp/JSZip); only PDF compression goes to the remote API (`/compress/pdf`) |
| Scheduled cleanup | `setInterval` in the worker | Vercel Cron (`crons` in `vercel.json`) → `api/cron/cleanup.ts`, hourly, authorized with `CRON_SECRET` |
| Redis | Required (rate limits, OTPs, job cache) | Upstash Redis (`REDIS_URL`) — used at a much lower rate: job polling reads Postgres only, health checks skip the queue probe in qstash mode, cache writes are fail-open and size-gated |
| Serverless filesystem | n/a | Ephemeral only: `STORAGE_ROOT=/tmp/docflow-storage`; durable state is R2 + Postgres + Upstash |

**Quotas that shaped this design** (verify current numbers at signup):

- Vercel Hobby function max duration: **300s** (set via `functions` in `vercel.json`).
- Vercel request body cap: **~4.5MB** → all uploads use the presign path.
- Free externals: Cloudflare R2 (10GB storage, egress free), Upstash Redis
  (10k commands/day), Upstash QStash (free tier), Neon Postgres (free tier),
  ConvertAPI / CloudConvert / Resend free tiers.

---

## 2. Account setup (one-time)

1. **Cloudflare R2** — create a bucket, create an API token with
   *Object Read & Write* for that bucket; note Account ID, Access Key ID,
   Secret Access Key, bucket name.
2. **Upstash** — create a Redis database (any region) and a QStash queue.
   Copy the QStash token, **signing key and next signing key** from the
   QStash console.
3. **Neon** (or any Postgres) — create a database; copy the pooled
   connection string (and direct string if provided).
4. **ConvertAPI** — create a free account and secret. Verify the free quota
   covers your expected volume; every heavy conversion bills one unit.
5. **CloudConvert** — create a free account (prepaid credits) and an API key.
   Only needed for audio/video/7z conversions; the key is optional (missing
   key → clear per-job error for those categories only, everything else
   unaffected). Verify free-tier quotas for your expected A/V volume.
6. **Resend** (or keep SMTP) — API key + verified sender domain.
7. **Firebase** — service account JSON for the existing auth layer (base64
   the JSON or paste it as the env var, matching the existing convention).
8. **Vercel** — import the Git repo. Framework preset: **Other**.

---

## 3. Vercel environment variables

Set all of these in the Vercel project (Settings → Environment Variables,
Production). `NODE_ENV` must be `production`.

### Shape switches (what makes this the serverless stack)

| Var | Value | Notes |
|---|---|---|
| `STORAGE_BACKEND` | `r2` | enables R2 branches everywhere |
| `QUEUE_BACKEND` | `qstash` | enables QStash publish + callback functions |
| `CONVERTER_PROVIDER` | `remote` | routes binary-dependent pairs to ConvertAPI |
| `RUN_INLINE_WORKERS` | `false` | required with qstash |
| `SINGLE_CONTAINER` | `false` | keep both false together |
| `STORAGE_ROOT` | `/tmp/docflow-storage` | ephemeral work dirs only |
| `TRUST_PROXY` | `true` | Vercel sits in front |
| `RUN_MIGRATIONS_ON_START` | `false` | run migrations manually (step 4) |

### Core

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled connection string |
| `DATABASE_URL_WORKER` | same as `DATABASE_URL` (single database) |
| `REDIS_URL` | Upstash Redis URL (rediss://…) |
| `CORS_ORIGIN` | empty string (same-origin) |
| `EMAIL_TRANSPORT` | `resend` (or `smtp`) |
| `RESEND_API_KEY` / `EMAIL_FROM` | if using resend |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service account JSON |
| `LOG_LEVEL` | `info` |

### R2

| Var | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET` | bucket name |

### QStash

| Var | Value |
|---|---|
| `QSTASH_TOKEN` | QStash REST token |
| `QSTASH_TARGET_BASE` | public base URL, e.g. `https://docflow.vercel.app` (callbacks go to `{base}/api/jobs/*`) |
| `QSTASH_SIGNING_KEY` | current signing key (callback verification) |
| `QSTASH_SIGNING_KEY_NEXT` | next signing key (rotation-safe verify) |

### Remote conversion + cron

| Var | Value |
|---|---|
| `CONVERTAPI_SECRET` | ConvertAPI secret |
| `CLOUDCONVERT_API_KEY` | CloudConvert API key (optional — audio/video/7z only) |
| `CLOUDCONVERT_BASE_URL` | default `https://api.cloudconvert.com/v2` (override for EU region) |
| `CRON_SECRET` | long random string; Vercel Cron sends it as `Authorization: Bearer …` |

Optional: `GEMINI_API_KEY` (AI features), `MAX_UPLOAD_BYTES`, `JOB_ATTEMPTS`,
`ARTIFACT_TTL_MINUTES`.

Production invariants are enforced at boot (`backend/src/config/env.ts`):
missing R2/QStash/ConvertAPI credentials in the matching mode refuse to start
rather than failing silently at first use.

---

## 4. Deploy

1. **Run migrations once** against the Neon database (before or right after
   the first deploy):

   ```powershell
   $env:DATABASE_URL = "<neon-pooled-url>"
   npm run --prefix backend migrate
   ```

   This applies all 5 migrations including `005_uploads.sql` (the uploads
   metadata table the presign flow depends on). Do **not** set
   `RUN_MIGRATIONS_ON_START=true` on Vercel — migrate manually instead.

2. **Deploy** — push to the production branch (or `vercel --prod`). The build
   command is `npm run build && npm run --prefix backend build`; the frontend
   (`dist/`) is served by Vercel's static layer, everything under `/v1` and
   `/health` is rewritten into `api/backend.ts`.

3. **First invocation** is a cold start (~5–10s: Firebase init, Redis
   handshake with an 8s cap, Fastify bootstrap). Subsequent invocations reuse
   the warm instance.

---

## 5. Post-deploy smoke checklist

Run against the deployed URL, signed in:

1. `GET /health` → `{"status":"ok"}`.
2. Sign-in / OTP email arrives (Resend or SMTP).
3. Upload a `.docx` through the Converter (uses `/v1/files/presign` →
   browser PUT to R2 → `/v1/files/:id/complete`).
4. Convert docx→pdf (office pairs go docx→pdf through the remote API chain;
   job should reach `completed` in the UI poll within ~1–2 minutes).
5. Convert pdf→docx (remote API, single call).
6. Convert pdf→jpg (two-step pdf→images).
7. Convert png→webp and heic→jpg (stay local on sharp — should be fastest).
8. Convert a zip→tar and tar.gz→zip pair (local pure-JS engine — fast, no
   API cost). Convert zip→7z (CloudConvert).
9. Convert tsv→pdf (local delimiter pre-step → ConvertAPI csv→pdf) and
   avif→pdf (local sharp pre-step → ConvertAPI png→pdf).
10. Compress a PDF (remote ConvertAPI `/convert/pdf/to/compress`) and an
    image batch (local sharp).
11. Download an artifact (streams from R2 via the API).
12. *(If using CloudConvert)* convert an mp3→wav and mp4→mp3 pair; confirm
    the job completes and the CloudConvert console shows the job.
13. Check Vercel → Functions: convert/compress invocations show in Logs;
    check Upstash QStash console → no failed deliveries; check the hourly
    cron run in Vercel → Cron Jobs history shows 200s.
14. If a job fails, confirm it retries (QStash console shows redeliveries)
    and the UI eventually shows a terminal failed state (final attempt
    persists failure to Postgres).

Known limits to verify against real accounts: ConvertAPI free-tier quota
per conversion type, Upstash free-tier command/day (polling is Postgres-only
so burn is modest), Neon free-tier compute hours.

---

## 6. What was NOT changed

- Docker / Render / OCI deployment files and their env contracts.
- All existing API routes, auth, validation, job state machine, download
  URLs, and the frontend polling contract.
- Default env values: without the three shape switches the backend runs
  disk + BullMQ + local engines exactly as before (the 36/36 test suite and
  the existing single-container deployments keep passing).
- Git history was not rewritten for this change.

---

## 7. File map (serverless additions)

| File | Role |
|---|---|
| `vercel.json` | builds, static output, function limits, cron, rewrites |
| `api/backend.ts` | Fastify-inject serverless adapter for the whole API |
| `api/jobs/convert.ts` | QStash callback → conversion processor |
| `api/jobs/compress.ts` | QStash callback → compression processor |
| `api/cron/cleanup.ts` | hourly expired-artifact + OTP cleanup |
| `backend/src/serverless/qstash-verify.ts` | JWS HMAC callback verification |
| `backend/src/serverless/http.ts` | tiny shared JSON responder |
| `backend/src/queue/qstash.ts` | QStash REST publisher |
| `backend/src/services/storage-r2.service.ts` | R2 I/O, presign, uploads-table CRUD |
| `backend/src/services/converters/RemoteEngine.ts` | ConvertAPI provider + category routing + tsv/avif pre-steps + remote PDF compress |
| `backend/src/services/converters/CloudConvertEngine.ts` | CloudConvert provider (audio/video/7z) |
| `backend/src/services/converters/ArchiveJsEngine.ts` | pure-JS zip/tar/tar.gz engine (local, free) |
| `backend/src/db/migrations/005_uploads.sql` | uploads metadata table |
| `services/upload.ts` (frontend) | presign upload with FormData fallback |
