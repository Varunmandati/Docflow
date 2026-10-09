# Deploying DocFlow for Free (Render)

One Render **free** web service runs the whole product: the React SPA, the Fastify API, the BullMQ workers (inline in the API process) and an in-container Redis. This repo is already wired for it — `render.yaml` (the Blueprint) + the root `Dockerfile` + `start.sh` do the heavy lifting.

## Architecture

- **Render web service (`docflow-backend`)** — the root `Dockerfile` builds the SPA and the API, installs LibreOffice / poppler / ghostscript / ffmpeg / pdf2docx, and `start.sh` boots a no-persistence in-container Redis plus the API with inline queue workers. Only port `8080` is exposed.
- **Postgres on [Neon](https://neon.tech)** (free) — Render's free plan has no managed Postgres.
- **Email via [Resend](https://resend.com)** (HTTPS) — Render blocks outbound SMTP ports (25/465/587), so the local Gmail SMTP setup **will not work** on Render. OTP and change-email codes are sent through `EMAIL_TRANSPORT=resend`.

The SPA and the API share one origin, so no CORS configuration is needed (`CORS_ORIGIN` stays empty — `*` is rejected by the production boot check).

## Step 1: Provision a free Neon database

1. Create a free project at **neon.tech**.
2. You will need **three** connection strings (all `?sslmode=require`):
   * `DATABASE_URL` — pooled connection for the API
   * `DATABASE_URL_WORKER` — pooled connection for the workers
   * `DATABASE_URL_DIRECT` — unpooled direct connection, used only for running migrations

## Step 2: Create the Render service from the Blueprint

1. Create an account on **render.com**.
2. **New + → Blueprint** and connect this GitHub repository.
3. Render auto-detects `render.yaml` and shows the service it will create (`docflow-backend`, Docker, free plan, health check `/health`).
4. When prompted for the environment variables marked `sync: false`, fill in:

   | Variable | Value |
   | :--- | :--- |
   | `DATABASE_URL` | Neon pooled URL (API) |
   | `DATABASE_URL_WORKER` | Neon pooled URL (workers) |
   | `DATABASE_URL_DIRECT` | Neon direct URL (migrations) |
   | `RESEND_API_KEY` | `re_...` API key from resend.com |
   | `EMAIL_FROM` | e.g. `DocFlow <onboarding@resend.dev>` (must be a verified Resend sender) |
   | `FIREBASE_SERVICE_ACCOUNT` | Minified single-line service-account JSON (Firebase console → Project settings → Service accounts) |
   | `FIREBASE_PRIVATE_KEY` | Leave blank if you use `FIREBASE_SERVICE_ACCOUNT` |
   | `GEMINI_API_KEY` | Optional — AI filename suggestions only |

5. **Still in the Environment tab, add the frontend build variables** (required for login to work end-to-end):

   | Variable | Value |
   | :--- | :--- |
   | `VITE_FIREBASE_API_KEY` | from your local `.env.local` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | from `.env.local` |
   | `VITE_FIREBASE_PROJECT_ID` | from `.env.local` |
   | `VITE_FIREBASE_STORAGE_BUCKET` | from `.env.local` |
   | `VITE_FIREBASE_MESSAGING_SENDER_ID` | from `.env.local` |
   | `VITE_FIREBASE_APP_ID` | from `.env.local` |
   | `VITE_API_BASE_URL` | leave **empty** (same-origin) |

   Render passes service environment variables to `docker build` as build arguments, and the root `Dockerfile` declares every `VITE_*` as an `ARG`, so Vite inlines them into the browser bundle. **Set them before the first deploy**; if you change them later, use *Manual Deploy → Clear build cache & deploy*.

   Why they matter: OTP login makes the backend mint a Firebase **custom token** (`FIREBASE_SERVICE_ACCOUNT`), which the frontend must exchange for an ID token using the `VITE_FIREBASE_*` config. Missing either half → sign-in appears to succeed but every protected API call returns 401.

6. Click **Deploy / Apply**. The first build takes ~8–12 minutes (LibreOffice, fonts, the pdf2docx venv).

Everything else (`PORT`, `NODE_ENV`, `SINGLE_CONTAINER`, `RUN_INLINE_WORKERS`, `LOCAL_REDIS`, `REDIS_URL`, upload/PDF limits, `RUN_MIGRATIONS_ON_START`, Resend transport, `TRUST_PROXY`) is already set by `render.yaml`.

## Step 3: Verify

* `https://<your-service>.onrender.com/health` → `200`
* `https://<your-service>.onrender.com/` → the DocFlow UI
* Sign up with email OTP — the code must arrive (Resend) and log you in.

## 💡 Free-tier notes

*   **Cold starts**: the free instance spins down after ~15 minutes idle; the first request takes **~30–50s** to wake up.
*   **Memory**: 512 MB total for Node + LibreOffice. The blueprint already caps the V8 heap (`--max-old-space-size=192`), concurrency (`1`), and PDF→DOCX (30 pages / 10 MB). Larger conversions may OOM on free — that is the tier's limit, not a bug.
*   **Disk**: the instance disk is ephemeral (wiped on redeploy). Fine for DocFlow: uploads/artifacts are temporary and cleaned after `ARTIFACT_TTL_MINUTES` (15 min).
*   **Database**: Neon's free tier is the durable store (users, jobs metadata).
