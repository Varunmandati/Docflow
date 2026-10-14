<div align="center">

# 📄 DocFlow

### All-in-One Document Processing Platform

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

**Convert documents • Compress files • Extract images — all from one beautiful UI.**

---

</div>

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📄 **Document Converter** | Convert between DOC, DOCX, PDF, TXT, XLSX, PPTX, and more using LibreOffice headless |
| 📦 **File Compressor** | Intelligent compression with quality presets and format-specific optimization via Sharp |
| 🖼️ **Image Extractor** | Extract images from PDFs and documents with page-level precision |
| 📊 **Dashboard** | Real-time statistics, recent activity feed, and conversion history at a glance |
| 🔐 **Authentication** | Email OTP + Google OAuth via Firebase — secure, passwordless login |
| 👤 **Profile Management** | Customizable user profiles with avatar cropping and character-based avatars |
| 🌙 **Theme System** | Light, Dark, and System-adaptive themes with smooth transitions |
| 🌐 **Multi-Language** | Full i18n support — English, Hindi, Bengali, and Telugu |
| 📱 **Responsive Design** | Pixel-perfect on desktop, tablet, and mobile viewports |

---

## 🏗️ Architecture

```
docflow/
├── 🎨 Frontend (React 19 + TypeScript + Vite)
│   ├── App.tsx                    # Root application with routing & state
│   ├── components/                # 40+ React components
│   │   ├── DashboardView.tsx      # Stats & activity overview
│   │   ├── ConverterView.tsx      # Document conversion UI
│   │   ├── CompressorView.tsx     # File compression UI
│   │   ├── ImageExtractorView.tsx # PDF image extraction
│   │   ├── AuthView.tsx           # Login (OTP + Google)
│   │   ├── ProfileView.tsx        # User profile editor
│   │   └── ...                    # Sidebar, Toast, Theme, Icons, etc.
│   ├── hooks/                     # Custom React hooks
│   ├── services/                  # Client-side services
│   ├── translations.ts           # i18n strings (EN/HI/BN/TE)
│   └── firebase.ts               # Firebase auth configuration
│
├── ⚙️ Backend (Node.js + Fastify + BullMQ)
│   ├── src/
│   │   ├── api/
│   │   │   ├── routes.ts         # 22+ REST API endpoints
│   │   │   └── server.ts         # Fastify server bootstrap
│   │   ├── services/             # 20 business logic services
│   │   │   ├── compression.service.ts
│   │   │   ├── otp-auth.service.ts
│   │   │   ├── profile.service.ts
│   │   │   └── ...
│   │   ├── workers/              # Background job processors
│   │   │   ├── conversion.worker.ts
│   │   │   ├── compression.worker.ts
│   │   │   └── cleanup.worker.ts
│   │   ├── db/                   # PostgreSQL integration
│   │   │   ├── client.ts         # Connection pool (pg)
│   │   │   ├── migrate.ts        # Migration runner
│   │   │   └── migrations/       # SQL migration files
│   │   ├── config/env.ts         # Zod-validated env config
│   │   ├── middleware/           # Auth, validation middleware
│   │   ├── models/               # Data models
│   │   ├── queue/                # BullMQ job definitions
│   │   └── types/                # TypeScript type definitions
│   └── docker-compose.yml        # Local Postgres + Redis for development
```

---

## 🚀 Quick Start

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Node.js](https://nodejs.org/) | ≥ 18 | JavaScript runtime |
| [Redis](https://redis.io/) | ≥ 7 | Job queue & session store |
| [PostgreSQL](https://www.postgresql.org/) | ≥ 16 | Primary database |
| [LibreOffice](https://www.libreoffice.org/) | ≥ 7 | Document conversion engine |
| [Docker](https://www.docker.com/) | *(optional)* | Container orchestration |

### 1. Clone & Install

```bash
git clone https://github.com/<your-username>/docflow.git
cd docflow

# Install frontend dependencies
npm install

# Install backend dependencies
cd backend && npm install
```

### 2. Configure Environment

```bash
# Root (frontend)
cp .env.example .env

# Backend
cp backend/.env.example backend/.env
```

Edit both `.env` files with your actual credentials:

| Variable | Where to Get It |
|----------|----------------|
| `VITE_FIREBASE_*` | [Firebase Console](https://console.firebase.google.com/) → Project Settings |
| `GOOGLE_CLIENT_ID/SECRET` | [Google Cloud Console](https://console.cloud.google.com/) → OAuth 2.0 |
| `SMTP_USER/PASS` | Gmail → [App Passwords](https://myaccount.google.com/apppasswords) (requires 2FA) |
| `AUTH_TOKEN_SECRET` | Generate with `openssl rand -hex 32` |
| `DATABASE_URL` | Your PostgreSQL connection string |

### 3. Start Services

#### Option A: Docker (Recommended)

```bash
cd backend
docker compose up -d
```

This starts PostgreSQL, Redis, the API server, and the worker — all pre-configured.

#### Option B: Manual (4 Terminals)

```bash
# Terminal 1 — Redis
redis-server

# Terminal 2 — Backend API
cd backend && npm run dev:api

# Terminal 3 — Background Worker
cd backend && npm run dev:worker

# Terminal 4 — Frontend Dev Server
npm run dev
```

### 4. Open the App

```
🌐  http://localhost:5173
```

---

## 🔌 API Reference

The backend exposes **22+ RESTful endpoints** on port `8080`:

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/send-otp` | Send OTP to email |
| `POST` | `/api/auth/verify-otp` | Verify OTP & get tokens |
| `POST` | `/api/auth/google` | Google OAuth login |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/logout` | Revoke session |

### Document Processing
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/convert` | Upload & convert document |
| `GET` | `/api/jobs/:id` | Check conversion job status |
| `GET` | `/api/jobs/:id/download` | Download converted file |
| `POST` | `/api/compress` | Upload & compress file |

### User Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profile` | Get user profile |
| `PUT` | `/api/profile` | Update profile |
| `POST` | `/api/profile/avatar` | Upload avatar image |

---

## ⚖️ Lawful use

DocFlow hosts, publishes, and indexes **no content itself**: it is a
general-purpose document tool, and files you process are under your control.
You may only use it for material you own, are licensed to access, or that is
otherwise lawful where you live. Deployments must follow the acceptable-use
policy of their hosting provider.

### License

No open-source license is granted. Copyright © DocFlow contributors,
**all rights reserved**. Contact the repository owner for licensing or reuse
inquiries.

---

## 🚀 Deployment

DocFlow deploys to **Vercel** (serverless).

### Vercel (serverless, this repo's default)

The React SPA is the frontend and the Fastify API runs as a serverless function
(`/api/backend`). `vercel.json` rewrites `/v1/*` and `/health` to the backend,
and every other path — including the clean routes `/dashboard`, `/converter`,
`/compress`, `/extract`, `/history`, `/settings`, `/profile` — to the SPA, so
each page is a real shareable URL.

```bash
npm install
vercel --prod --yes        # build + deploy from the repo root
```

Serverless mode is toggled with `USE_REMOTE_ENGINE=true` and
`IS_QSTASH_QUEUE=true` (Vercel project environment); jobs are queued via QStash
and converted files are stored in the remote bucket set by `STORAGE_ROOT`.
Scale-to-zero means the first request after idle is a cold start.

### Environment variables

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL`, `DATABASE_URL_WORKER` | yes | Neon Postgres; set `RUN_MIGRATIONS_ON_START=true` |
| `FIREBASE_SERVICE_ACCOUNT` | yes | single-line JSON, powers Google sign-in |
| `VITE_FIREBASE_API_KEY` … `_APP_ID` (6) | yes | public browser identifiers, inlined into the bundle |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | OTP + transactional email over HTTPS |
| `QSTASH_TOKEN`, `QSTASH_SIGNING_KEY`, `QSTASH_SIGNING_KEY_NEXT` | Vercel | QStash queue for background jobs |
| `CONVERTAPI_SECRET`, `CLOUDCONVERT_API_KEY` | yes | 3rd-party conversion / compression APIs |
| `PDF_SERVICES_CLIENT_ID`, `PDF_SERVICES_CLIENT_SECRET` | optional | Adobe PDF Services — high-fidelity PDF → DOCX (see below) |
| `STORAGE_BACKEND=r2` + `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | optional | Cloudflare R2; required by the Adobe PDF → DOCX pipeline |

### Adobe PDF → DOCX pipeline (`/api/pdf-to-docx/*`)

A dedicated, high-fidelity PDF → DOCX path backed by the **Adobe PDF Services**
Export API and **Cloudflare R2**. It is optional: set the two Adobe credentials
(and `STORAGE_BACKEND=r2`) to enable it. When unset, the endpoints answer `501`
and the converter falls back to the existing pipeline (`/v1/convert` →
ConvertAPI/CloudConvert) and then to the in-browser structure-preserving
builder, so behaviour is unchanged.

```bash
# 1. Reserve a job + presigned upload URL        (Authorization: Bearer <idToken>)
POST /api/pdf-to-docx/init      { name, size, mimeType }  -> { jobId, uploadUrl, ... }
# 2. Browser PUTs the PDF straight to R2 (the presigned URL is the credential).
#    If the bucket has no CORS rule, POST the raw PDF to the same-origin fallback:
#    POST /api/pdf-to-docx/upload?jobId=...   (body = PDF bytes, bodyParser off)
# 3. Run the conversion (server-side, server-to-server with Adobe)
POST /api/pdf-to-docx/start     { jobId }                 -> { job, completed }
# 4. Poll; returns a short-lived presigned download URL when done
GET  /api/pdf-to-docx/status?jobId=...                    -> { job, downloadUrl? }
#    Fallback when the presigned GET is CORS-blocked:
#    GET  /api/pdf-to-docx/download?jobId=...   -> DOCX bytes (attachment)
```

Job states: `uploading → processing → completed | failed`. Jobs, staged inputs
(`pdf-docx/input/…`) and outputs (`pdf-docx/output/…`) live under R2 keys
derived from an unguessable UUID and are owner-scoped; metadata is swept by the
daily cron after `PDF_DOCX_JOB_TTL_MINUTES`. Uploads bypass the ~4.5MB function
body cap (browser → R2 direct). Credentials never reach the browser.

**R2 bucket configuration**

- **CORS** must allow `PUT` (with `Content-Type: application/pdf`) and `GET` from
  the SPA origin, e.g. `AllowedOrigins: ["https://<your-app>"]`,
  `AllowedMethods: ["GET","PUT"]`, `AllowedHeaders: ["*"]`. Without it the browser
  cannot use the presigned URLs and transparently falls back to the same-origin
  `/api/pdf-to-docx/upload` and `/download` endpoints (subject to the serverless
  request/response body cap, so configure CORS to support large files).
- **Lifecycle rule** on prefixes `pdf-docx/input/` and `pdf-docx/output/`
  (expire after `PDF_DOCX_JOB_TTL_MINUTES`) reaps staged objects from abandoned
  uploads that never produced job metadata.

**Verification status:** unit-tested with a mocked Adobe API and mocked R2, and
verified live end-to-end (real Adobe PDF Services export + real R2 stage/download)
with a real `PDF_SERVICES_*` credential: init → browser-direct R2 PUT → start →
status → presigned DOCX download returned a valid OOXML package. Credentials are
server-only and never shipped to the browser.

---

## 🐳 Local development stack

`backend/docker-compose.yml` provides PostgreSQL + Redis (and optionally the API
and worker) for local development:

```yaml
# backend/docker-compose.yml
services:
  postgres:    # PostgreSQL 16 Alpine
  redis:       # Redis 7 Alpine with AOF persistence
  api:         # Fastify API server (port 8080)
  worker:      # BullMQ background job processor
```

```bash
# Build and start all services
cd backend
docker compose up -d --build

# Run database migrations
docker compose exec api npm run migrate

# View logs
docker compose logs -f api worker

# Stop everything
docker compose down
```

---

## 🛠️ Tech Stack

### Frontend
- **React 19** — UI library with hooks
- **TypeScript 5.8** — Type safety
- **Vite 6** — Lightning-fast dev server & bundler
- **Firebase Auth** — Google OAuth provider
- **Lucide React** — Modern icon library
- **PDF.js** — Client-side PDF rendering
- **pdf-lib** — PDF manipulation
- **html2canvas** — DOM-to-image conversion
- **react-easy-crop** — Avatar image cropping

### Backend
- **Fastify 4** — High-performance HTTP framework
- **BullMQ** — Redis-backed job queue
- **PostgreSQL + pg** — Relational database with connection pooling
- **Redis (ioredis)** — Queue broker, session store, OTP storage
- **Sharp** — High-performance image processing
- **Nodemailer** — SMTP email delivery
- **Zod** — Runtime schema validation
- **Pino** — Structured JSON logging
- **LibreOffice (headless)** — Document format conversion
- **jsonwebtoken** — JWT-based auth tokens

### DevOps
- **Vercel** — serverless hosting for the SPA + API
- **Docker + Docker Compose** — local PostgreSQL + Redis for development

---

## 📁 Environment Variables

### Frontend (`.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_FIREBASE_API_KEY` | ✅ | Firebase API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | ✅ | Firebase auth domain |
| `VITE_FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | ✅ | Firebase storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | ✅ | Firebase messaging sender ID |
| `VITE_FIREBASE_APP_ID` | ✅ | Firebase app ID |
| `VITE_API_BASE_URL` | ✅ | Backend API URL |

### Backend (`backend/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | ❌ | `8080` | API server port |
| `REDIS_URL` | ❌ | `redis://localhost:6379` | Redis connection URL |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection (API) |
| `DATABASE_URL_WORKER` | ✅ | — | PostgreSQL connection (Worker) |
| `SMTP_USER` | ✅ | — | Email for OTP delivery |
| `SMTP_PASS` | ✅ | — | SMTP password / App Password |
| `AUTH_TOKEN_SECRET` | ✅ | — | JWT signing secret |
| `REFRESH_TOKEN_SECRET` | ✅ | — | Refresh token secret |

> ⚠️ **Never commit `.env` files.** Use `.env.example` as a template.

---

## 🧪 Development

```bash
# Frontend development server (hot reload)
npm run dev

# Backend API with file watching
cd backend && npm run dev:api

# Backend worker with file watching
cd backend && npm run dev:worker

# Type-check frontend
npm run lint

# Type-check backend
cd backend && npm run lint

# Build frontend for production
npm run build

# Build backend
cd backend && npm run build

# Run database migrations
cd backend && npm run migrate
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📜 License

This project is private and not currently licensed for public distribution.

---

<div align="center">

**Built with ❤️ using React, Fastify, and TypeScript**

</div>
