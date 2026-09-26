<div align="center">

# 📄 DocFlow

### All-in-One Document Processing & Peer-to-Peer (BinaryTransfer) File Delivery Platform

[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Fastify](https://img.shields.io/badge/Fastify-4-000000?style=for-the-badge&logo=fastify&logoColor=white)](https://fastify.dev/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

**Convert documents • Compress files • Transfer files peer-to-peer • Extract images — all from one beautiful UI.**

---

</div>

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📄 **Document Converter** | Convert between DOC, DOCX, PDF, TXT, XLSX, PPTX, and more using LibreOffice headless |
| 📦 **File Compressor** | Intelligent compression with quality presets and format-specific optimization via Sharp |
| 📥 **Peer-to-Peer Transfer** | Add `.upload` files for content you own or are licensed to access, browse metadata, select files, and download as ZIP archives |
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
│   │   ├── UploadConverterView.tsx # Upload download manager
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
│   │   │   ├── upload.service.ts
│   │   │   ├── otp-auth.service.ts
│   │   │   ├── profile.service.ts
│   │   │   └── ...
│   │   ├── workers/              # Background job processors
│   │   │   ├── conversion.worker.ts
│   │   │   ├── compression.worker.ts
│   │   │   ├── upload.worker.ts
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
│   ├── Dockerfile                # Production container image
│   └── docker-compose.yml        # Full stack orchestration
│
└── 🌊 StreamService (Upload Streaming Service)
    ├── server.ts                 # WebClient-based streaming server
    └── src/                      # Client-side upload UI
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

### Upload
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload/parse` | Parse upload metadata |
| `POST` | `/api/upload/download` | Start upload download |
| `GET` | `/api/upload/status/:id` | Check download progress |
| `GET` | `/api/upload/download/:id` | Download completed archive |

### User Profile
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profile` | Get user profile |
| `PUT` | `/api/profile` | Update profile |
| `POST` | `/api/profile/avatar` | Upload avatar image |

---

## ⚖️ Lawful use

DocFlow includes a peer-to-peer (BinaryTransfer/WebClient) transfer feature.
Peer-to-peer is lawful technology — it is how distributions ship Linux ISOs,
how researchers share open datasets, and how creators share Creative Commons
work (this repository's own test fixture is *the sample fixture*, CC-BY 3.0).

The software hosts, publishes, and indexes **no content itself**: it is a
general-purpose tool, and what you ask it to fetch is under your control.
You may only use it for material you own, are licensed to access, or that is
otherwise lawful where you live.

**[Content & Acceptable Use Policy](CONTENT_POLICY.md)** — prohibited uses,
hosting-provider rules, and abuse/takedown contact. Deployments must follow
the acceptable-use policy of their hosting provider.

### License

No open-source license is granted. Copyright © DocFlow contributors,
**all rights reserved**. Contact the repository owner for licensing or reuse
inquiries.

---

## 🚀 Deployment (one container, one port)

One Docker image carries the React SPA, the Fastify API with inline queue
workers, and StreamService (WebClient), so a single service runs the whole
product. The API serves the SPA itself and reverse-proxies `/api/uploads` to
StreamService over `127.0.0.1`, so only port `8080` is ever exposed. The stack is
wired up by [`docker-compose.yml`](docker-compose.yml) and configured by
[`.env.production.example`](.env.production.example).

### Option A — own VM, always-on, $0/month (recommended)

Oracle Cloud **Always Free** gives an Ubuntu VM (2 OCPU / 12 GB ARM, ~10 TB
egress per month) that never sleeps — right for upload downloads and
conversion jobs that must keep running unattended. The card at signup is
verification only; Always Free resources are never charged.

```bash
ssh ubuntu@<your-vm-ip>
sudo bash deploy/oracle/setup.sh      # 1st run: installs Docker, writes .env, stops
nano /opt/docflow/.env                # fill in Neon / Resend / Firebase
sudo bash deploy/oracle/setup.sh      # 2nd run: builds the image and starts
```

Full walkthrough (VM shape, firewall rules, HTTPS, cost guardrails):
[ORACLE_DEPLOYMENT.md](ORACLE_DEPLOYMENT.md)

### Option B — Koyeb free instance

[![Deploy to Koyeb](https://www.koyeb.com/static/images/deploy/button.svg)](https://app.koyeb.com/deploy?type=git&builder=dockerfile&repository=github.com%2FVarunmandati%2FDocflow&branch=main&name=docflow)

1. Click the button (Koyeb builds the repo's root `Dockerfile`).
2. Open **Settings → Environment Variables** and paste every entry from
   [`.env.production.example`](.env.production.example).
3. **Redeploy.** `VITE_*` values are read at *build* time, so the first build
   (which has no variables yet) has to be rebuilt once they exist.

Details in [KOYEB_DEPLOYMENT.md](KOYEB_DEPLOYMENT.md).

### Environment variables both paths need

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL`, `DATABASE_URL_WORKER` | yes | Neon Postgres; set `RUN_MIGRATIONS_ON_START=true` |
| `FIREBASE_SERVICE_ACCOUNT` | yes | single-line JSON, powers Google sign-in |
| `VITE_FIREBASE_API_KEY` … `_APP_ID` (6) | yes | public browser identifiers, inlined into the bundle |
| `RESEND_API_KEY`, `EMAIL_FROM` | yes | OTP + transactional email over HTTPS |
| `LOCAL_REDIS=true` | yes | in-container Redis, no external quota |
| `STREAM_ENABLED` | no | default `true`; set `false` to reclaim ~100 MB if the instance OOMs |
| `STREAM_INTERNAL_TOKEN` | no | minted at boot when unset, so the upload API is never open |
| `STREAM_PORT` | no | default `3002`, internal only |

Behaviour worth knowing:

- On a VM the app runs 24/7 (`restart: unless-stopped`); Koyeb free instances
  scale down after about an hour of idle, so the first request after idle is a
  cold start.
- Inbound BinaryTransfer peer traffic is not reachable from outside the container;
  outbound connections still work (open TCP/UDP 6881-6891 on the VM to allow
  inbound peers too).
- The existing `render.yaml` and `vercel.json` are unchanged — deploying the
  SPA on Vercel and the API elsewhere still works if you want the split: set
  `VITE_API_BASE_URL` to the API URL and `CORS_ORIGIN` to the Vercel URL.

---

## 🐳 Docker Deployment

The project includes production-ready Docker configuration:

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
- **media-parse + legacy-stream** — Upload metadata & downloading
- **jsonwebtoken** — JWT-based auth tokens

### DevOps
- **Docker + Docker Compose** — Container orchestration
- **Multi-stage Dockerfile** — Optimized production images

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
