# DocFlow Production Deployment Guide (Free Tier Architecture)

This guide documents the exact steps and architectural considerations for deploying DocFlow to **Render** (Backend Web Service) and **Vercel** (Frontend) under their free hosting tiers ($0/month).

---

## 🏛️ Architecture Overview

- **Frontend**: React + Vite SPA deployed to **Vercel**.
- **Backend API & Queue Worker**: Node.js + Fastify running in a single Docker container on **Render Free Web Service** (512 MB RAM, ~0.1 CPU, spins down after 15 minutes idle).
- **Queue & Rate Limiting**: In-container Redis instance (`LOCAL_REDIS=true`) with a 64 MB cap and zero persistence, preventing Upstash command exhaustion.
- **Database**: PostgreSQL hosted on **Neon** with Row-Level Security (RLS) and connection pooling.
- **Email Delivery**: Resend HTTPS API (`EMAIL_TRANSPORT=resend`), bypassing Render's blocked outbound SMTP ports (25, 465, 587).

---

## 🚨 Free-Tier Realities & Known Limitations

Deploying on free infrastructure entails specific operational constraints:

1. **Outbound SMTP Ports Blocked on Render**:
   - Render's free tier strictly blocks outbound connections to ports `25`, `465`, and `587`.
   - **Solution**: Set `EMAIL_TRANSPORT=resend` and supply `RESEND_API_KEY`. The backend delivers OTP emails over standard HTTPS (`https://api.resend.com/emails`) via native Node `fetch`.

2. **Strict 512 MB Container RAM Limit**:
   - The API server, BullMQ queue, local Redis, and native document conversion engines (LibreOffice, FFmpeg, Python pdf2docx) share 512 MB of physical RAM.
   - **Solution**:
     - `NODE_OPTIONS=--max-old-space-size=192`: Caps V8 heap at 192 MB so native processes have room to execute.
     - `WORKER_CONCURRENCY=1`: Worker picks up 1 job at a time.
     - `HEAVY_JOB_CONCURRENCY=1`: Enforces an in-process semaphore lock so only one heavy engine (LibreOffice, FFmpeg, or pdf2docx) executes at any moment.
     - `STREAM_ENABLED=false`: Disables the heavy WebClient sidecar.
     - `PDF_DOCX_OCR=off`: Disables CPU- and RAM-heavy OCR scanning on free tier. Scanned PDFs with no text layer fail quickly and informatively rather than causing OOM crashes.
     - `MAX_UPLOAD_BYTES=15728640`: Restricts file uploads to ~15 MB.

3. **Ephemeral Storage & 15-Minute Disk Expiration**:
   - Render containers do not have persistent disk storage. Files on disk vanish whenever the service restarts, redeploys, or spins down.
   - **Solution**:
     - `ARTIFACT_TTL_MINUTES=15`: Conversion outputs and uploads are purged after 15 minutes.
     - If a user requests an expired or evicted file, the API responds with standard HTTP 404 (`{"message": "File not found or link expired."}`).

4. **15-Minute Idle Cold Starts**:
   - Render spins down free web services after 15 minutes of inactivity. The next HTTP request will trigger a cold start taking **30–50 seconds**.
   - **Health Check**: Fast, unauthenticated `GET /health` endpoint responds with HTTP 200 without touching Postgres or Redis.

5. **External Redis Quota vs. Local Redis**:
   - Upstash Free provides 500,000 commands/month. BullMQ workers polling at 1–2 commands per second can exhaust this quota within days.
   - **Solution**: Set `LOCAL_REDIS=true`. The container starts a local `redis-server` (capped at 64 MB, policy `noeviction`, no disk persistence) before the Node process boots.

6. **Database Migrations on Pooled Neon**:
   - PostgreSQL migrations that create tables or execute transactional DDL can conflict with PgBouncer connection poolers.
   - **Solution**: Provide `DATABASE_URL_DIRECT` (the unpooled Neon direct connection URL). Setting `RUN_MIGRATIONS_ON_START=true` executes `src/db/migrate.ts` automatically on container boot using the direct connection.

---

## 🛠️ Step-by-Step Deployment Instructions

### Step 1: Provision Free Third-Party Services

1. **PostgreSQL (Neon.tech)**:
   - Create a free project at [neon.tech](https://neon.tech).
   - In the dashboard, obtain both:
     - **Pooled connection string** (ends with `-pooler...`): Use for `DATABASE_URL` and `DATABASE_URL_WORKER`.
     - **Direct connection string** (unpooled): Use for `DATABASE_URL_DIRECT`.

2. **Email API (Resend.com)**:
   - Sign up at [resend.com](https://resend.com) and create an API key.
   - Set `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY=re_...`, and `EMAIL_FROM=DocFlow <onboarding@resend.dev>` (or your verified domain).

3. **Firebase Authentication**:
   - Go to the Firebase Console -> Project Settings -> Service Accounts.
   - Click **Generate new private key** to download the JSON service account.
   - Minify the JSON into a single-line string for `FIREBASE_SERVICE_ACCOUNT`.
   - In **Authentication -> Settings -> Authorized domains**, add:
     - Your Vercel frontend domain (e.g. `your-docflow.vercel.app`).
     - `localhost` (for local development).

---

### Step 2: Deploy Backend to Render

1. Log in to [Render.com](https://render.com).
2. Click **New +** -> **Blueprint** (or **Web Service**).
   - *Option A (render.yaml)*: Connect your repo. Render will automatically read `render.yaml`.
   - *Option B (Manual Web Service)*:
     - Name: `docflow-backend`
     - Runtime: **Docker**
     - Dockerfile Path: `Dockerfile.render`
     - Instance Type: **Free**
     - Health Check Path: `/health`
3. In the **Environment** tab, configure the variables listed in `.env.render.example`:
   - `PORT=8080`
   - `HOST=0.0.0.0`
   - `NODE_ENV=production`
   - `NODE_OPTIONS=--max-old-space-size=192`
   - `LOCAL_REDIS=true`
   - `REDIS_URL=redis://127.0.0.1:6379`
   - `RUN_INLINE_WORKERS=true`
   - `WORKER_CONCURRENCY=1`
   - `HEAVY_JOB_CONCURRENCY=1`
   - `MAX_UPLOAD_BYTES=15728640`
   - `ARTIFACT_TTL_MINUTES=15`
   - `PDF_DOCX_OCR=off`
   - `EMAIL_TRANSPORT=resend`
   - `RESEND_API_KEY=<Your Resend Key>`
   - `EMAIL_FROM=<Your Sender>`
   - `DATABASE_URL=<Your Neon Pooled URL>`
   - `DATABASE_URL_WORKER=<Your Neon Pooled URL>`
   - `DATABASE_URL_DIRECT=<Your Neon Direct URL>`
   - `RUN_MIGRATIONS_ON_START=true`
   - `TRUST_PROXY=true`
   - `STREAM_ENABLED=false`
   - `RATE_LIMIT_EXPENSIVE_FALLBACK=memory`
   - `FIREBASE_SERVICE_ACCOUNT=<Minified JSON>`
   - `CORS_ORIGIN=https://<your-vercel-domain>.vercel.app`
4. Click **Deploy**. Note the URL (e.g. `https://docflow-backend.onrender.com`).

---

### Step 3: Deploy Frontend to Vercel

1. Log in to [Vercel.com](https://vercel.com).
2. Click **Add New** -> **Project** and select your DocFlow repository.
3. Vercel auto-detects Vite. The included `vercel.json` ensures all route requests rewrite to `index.html`.
4. In **Environment Variables**, add:
   - `VITE_API_URL`: `https://docflow-backend.onrender.com`
   - `VITE_API_BASE_URL`: `https://docflow-backend.onrender.com`
   - `VITE_FIREBASE_API_KEY`: `<Your Firebase Web API Key>`
   - `VITE_FIREBASE_AUTH_DOMAIN`: `<Your Project>.firebaseapp.com`
   - `VITE_FIREBASE_PROJECT_ID`: `<Your Project ID>`
   - `VITE_FIREBASE_STORAGE_BUCKET`: `<Your Project>.appspot.com`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`: `<Sender ID>`
   - `VITE_FIREBASE_APP_ID`: `<App ID>`
5. Click **Deploy**.
6. Once deployed, copy your production Vercel URL and update `CORS_ORIGIN` in the Render dashboard.

---

## 🔍 Verification Checklist

- [ ] `GET /health` returns HTTP 200 with `{"status":"ok"}`.
- [ ] OTP login email arrives via Resend.
- [ ] Database migrations execute automatically on boot without errors.
- [ ] Large document conversion does not crash the 512 MB container.
- [ ] Upload tab displays graceful unavailable state when `STREAM_ENABLED=false`.
- [ ] Single-page app navigation on Vercel refreshes without 404 errors.
