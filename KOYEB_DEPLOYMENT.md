# DocFlow Production Deployment Guide: Koyeb (Backend) + Vercel (Frontend)

This guide documents the step-by-step process for deploying DocFlow completely free ($0/month) using **Koyeb** (Docker Backend Web Service) and **Vercel** (React Frontend).

---

## 🏛️ Architecture Overview

- **Frontend**: React + Vite SPA deployed on **Vercel** (Free global CDN, automatic SSL, SPA routing).
- **Backend API & Queue Worker**: Fastify + Node.js running inside a Docker container on **Koyeb Free Instance** (512 MB RAM, 0.1 vCPU, scales down after 1 hour idle, no credit card required).
- **Queue & Rate Limiting**: In-container Redis instance (`LOCAL_REDIS=true`, 64 MB cap, noeviction policy, no disk writes), avoiding external Redis quota limits.
- **Database**: PostgreSQL on **Neon** (Free serverless Postgres with pooling).
- **Email Delivery**: Resend HTTPS API (`EMAIL_TRANSPORT=resend`), bypassing cloud firewall port restrictions.

---

## 🚀 Step-by-Step Deployment

### Step 1: Deploy Backend to Koyeb

1. Go to **[app.koyeb.com](https://app.koyeb.com/)** and sign up with your **GitHub** account (no credit card required).
2. Click **Create Service** (or **Deploy**).
3. Under **Deployment method**, select **GitHub**.
4. Choose your repository: `Varunmandati/Docflow` (or `Varun879/docflow`) and select the `main` branch.
5. In the **Build and deployment settings**:
   - **Builder**: Select **Dockerfile**.
   - **Dockerfile location**: Leave as `/Dockerfile` (Koyeb will use our hardened root Dockerfile).
6. Under **Instance type**:
   - Select **Free** (Nano: 512 MB RAM, 0.1 vCPU).
   - Choose a region close to your database (e.g., **Frankfurt (fra)** or **Washington, D.C. (was)**).
7. Under **Ports & Exposing your service**:
   - Set **Port**: `8080`
   - **Protocol**: `HTTP`
   - **Route**: `/`
8. Under **Health checks**:
   - **Type**: `HTTP`
   - **Path**: `/health`
   - **Port**: `8080`
9. Under **Environment variables**, click **Add variable** (or **Bulk edit**) and paste the following keys (see [`.env.koyeb.example`](.env.koyeb.example)):

| Variable | Value | Notes |
| :--- | :--- | :--- |
| `PORT` | `8080` | Required |
| `HOST` | `0.0.0.0` | Required |
| `NODE_ENV` | `production` | Required |
| `NODE_OPTIONS` | `--max-old-space-size=192` | Prevents V8 heap from starving LibreOffice |
| `LOCAL_REDIS` | `true` | Starts in-container Redis instance |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Internal Redis address |
| `RUN_INLINE_WORKERS` | `true` | Processes BullMQ conversion jobs in-process |
| `WORKER_CONCURRENCY` | `1` | 1 job processed at a time |
| `HEAVY_JOB_CONCURRENCY` | `1` | Limits LibreOffice/pdf2docx to 1 concurrent process |
| `MAX_UPLOAD_BYTES` | `15728640` | ~15 MB upload limit |
| `ARTIFACT_TTL_MINUTES` | `15` | Purges converted files after 15 min |
| `PDF_DOCX_OCR` | `off` | Fast PDF-to-DOCX without memory-heavy OCR |
| `TRUST_PROXY` | `1` | Trusts Koyeb upstream proxy |
| `RATE_LIMIT_EXPENSIVE_FALLBACK` | `memory` | In-memory limiter if Redis ever faults |
| `RUN_MIGRATIONS_ON_START` | `true` | Automatically sets up database tables on boot |
| `DATABASE_URL` | `<Your Neon Pooled URL>` | `postgresql://...@ep-...-pooler.../neondb?sslmode=require` |
| `DATABASE_URL_WORKER` | `<Your Neon Pooled URL>` | Same pooled URL |
| `DATABASE_URL_DIRECT` | `<Your Neon Direct URL>` | Unpooled direct connection URL |
| `EMAIL_TRANSPORT` | `resend` | HTTPS email transport |
| `RESEND_API_KEY` | `re_...` | From [resend.com](https://resend.com) |
| `EMAIL_FROM` | `DocFlow <noreply@yourdomain.com>` | Or `onboarding@resend.dev` for testing |
| `FIREBASE_SERVICE_ACCOUNT` | `{"type":"service_account",...}` | Minified single-line JSON |
| `CORS_ORIGIN` | `*` | Temporary wildcard for Stage 1 |

10. Click **Deploy**.
11. Wait for the build to complete. When active, Koyeb will give you a public URL:
    `https://<your-app-name>-<org>.koyeb.app`
12. Test the health endpoint:
    `https://<your-app-name>-<org>.koyeb.app/health`
    It should return: `{"status":"ok","timestamp":"..."}`.

---

### Step 2: Deploy Frontend to Vercel

1. Log into **[vercel.com](https://vercel.com/)** and click **Add New...** $\rightarrow$ **Project**.
2. Select and import your `Docflow` repository.
3. Configure the build settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `./`
   - **Build Command**: `vite build` (or default `npm run build`)
   - **Output Directory**: `dist`
4. In the **Environment Variables** section, add:
   - `VITE_API_URL` = `https://<your-app-name>-<org>.koyeb.app`
   - `VITE_API_BASE_URL` = `https://<your-app-name>-<org>.koyeb.app`
5. Click **Deploy**.
6. Once deployed, copy your live Vercel URL (e.g. `https://docflow-xxx.vercel.app`).

---

### Step 3: Lock Down `CORS_ORIGIN` on Koyeb

1. Return to the **Koyeb Control Panel** $\rightarrow$ your Service $\rightarrow$ **Settings** $\rightarrow$ **Environment variables**.
2. Edit `CORS_ORIGIN`:
   - Change `*` to your production Vercel URL: `https://<your-app>.vercel.app`.
3. Click **Save** to redeploy with the strict origin restriction.

---

### Step 4: Add Vercel Domain to Firebase Auth

1. Open the **[Firebase Console](https://console.firebase.google.com/)** $\rightarrow$ select your DocFlow project.
2. Go to **Authentication** $\rightarrow$ **Settings** $\rightarrow$ **Authorized domains**.
3. Click **Add domain** and enter your Vercel domain (e.g., `<your-app>.vercel.app`).

---

## 🔍 Verification Checklist

- [ ] Koyeb health check responds: `GET /health` returns `200 OK`.
- [ ] Vercel frontend loads cleanly with no console CORS errors.
- [ ] OTP login email is received via Resend.
- [ ] Single file conversion (Word, PDF, Image) converts and downloads cleanly.
- [ ] App stays idle for up to 1 hour before sleeping (wakes up automatically on next visit).
