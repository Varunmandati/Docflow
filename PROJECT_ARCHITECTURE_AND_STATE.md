# DocFlow Project Architecture & State

This document provides a comprehensive overview of the DocFlow project, including its tech stack, features, architecture, and how different components interact. It is designed to be shared with AI assistants to quickly provide context on the current state of the project.

## 1. Tech Stack overview

### Frontend
*   **Framework:** React 19 (with Hooks: `useState`, `useEffect`, `useCallback`, `Suspense`, `lazy`)
*   **Routing:** React Router DOM v7 (`react-router-dom`)
*   **Build Tool:** Vite v6
*   **Language:** TypeScript
*   **Styling:** Vanilla CSS (`index.css`) utilizing CSS Variables for dynamic theming (Dark/Light mode + custom brand themes).
*   **Icons:** Lucide React
*   **State Management:** Local React State + `StorageManager` (wrapper around `localStorage` for persistence).
*   **Utilities:** `pdf-lib` (PDF manipulation), `docx-preview` (Word doc rendering), `html2canvas`, `react-easy-crop`.

### Backend Architecture (Dual-Server Setup)
The project utilizes two distinct backend processes:

**1. Conversion & API Server (`/backend` directory)**
*   **Runtime:** Node.js
*   **Framework:** Fastify (Port 8080)
*   **Security:** Helmet, rate limiting, and CORS implemented across Fastify API endpoints.
*   **Authentication:** Fully migrated to Firebase Auth (Native SDK in Frontend, Firebase Admin SDK in Backend). Custom OTP and JWT flows have been removed. User profiles are lazily synced to PostgreSQL (`getUserProfile` / `updateUserProfile`).
*   **Architecture:** A robust API server for document conversions, compression, and future authentication. Uses BullMQ for background job processing and integrates with LibreOffice headless and Poppler utilities.

**2. Upload Streaming Server (`upload-server.js`)**
*   **Runtime:** Node.js
*   **Framework:** Express.js (Port 3002)
*   **Upload Engine:** WebClient (`web-client`) and `media-parse`
*   **Architecture:** Exposes HTTP range-based endpoints to stream video directly from upload swarms to the frontend HTML5 video player. Also handles robust native file downloading.

### External / Integrations
*   **AI/Generative:** `@google/genai`
*   **Database/Auth:** Firebase (configured in `firebase.ts`, likely used for extended auth or cloud storage if not mocked locally).

---

## 2. Core Features & How They Work

### A. Document Conversion & Compression
*   **Components:** `ConverterView.tsx`, `CompressorView.tsx`
*   **Flow:** Users upload files via a Drag-and-Drop zone (`FileDropzone.tsx`). Files are processed locally or prepared for upload. 
*   **Logic:** Uses browser-side libraries to manipulate PDFs/images or mock API calls for format conversion. Progress is tracked via `ConversionProgressWithStages.tsx`.
*   **Stats Tracking:** Conversions (Success/Fail) update a global `Stats` object persisted in `localStorage`.

### B. Upload Streaming (StreamService Integration)
*   **Components:** `UploadConverterView.tsx` (Frontend), `upload-server.js` (Backend).
*   **Flow:**
    1.  User enters a Link URL or uploads a `.upload` file in `UploadConverterView.tsx`.
    2.  Frontend sends a request to the local Express backend (`/api/uploads`).
    3.  `upload-server.js` checks the verified cache to see if the upload was fully downloaded previously. If so, it bypasses WebClient hashing entirely and serves directly from the disk cache.
    4.  If not verified, it uses `WebClient` to connect to the swarm, parse metadata, and fetch chunks.
    5.  Backend returns the file list with download progress.
    6.  Users can selectively download individual files to their device, served via native HTTP range requests from `/api/uploads/<infoHash>/files/<fileIndex>`.
*   **Caching & Resiliency:** Uploads and their metadata are cached locally in a `.uploads/` directory to quickly resume sessions. The backend route utilizes comprehensive `try/catch` wrapping and synchronous identifier validation to prevent unhandled node.js exceptions from halting the server and causing frontend proxy timeouts.

### C. Image Extraction
*   **Component:** `ImageExtractorView.tsx`
*   **Flow:** Allows users to upload documents (PDFs, etc.) and extract individual images using canvas rendering (`html2canvas` / `pdfjs-dist`).

### D. User Settings & Theming
*   **Component:** `SettingsView.tsx`
*   **Flow:** Settings are saved to `localStorage` via `StorageManager`.
*   **Features:**
    *   **Theme:** Light, Dark, and System preference. It applies classes to the document root and modifies CSS variables (`--background-main`, `--brand-accent`).
    *   **Language:** Handled by `translations.ts`, supporting English, Hindi, Bengali, and Telugu.
    *   **Aesthetics:** Toggleable animated background (glassmorphism effect) and adjustable font size/family.

### E. User Profile & Authentication
*   **Components:** `ProfileView.tsx`, `AuthView.tsx`, `GoogleAccountChooserModal.tsx`
*   **Flow:** Currently implements a mock/local authentication session.
*   **Logic:** When "logged in", the session state (`authSession`, `userProfile`) is updated in `localStorage`. `App.tsx` reads this on boot to determine if the user is authenticated.

### F. History & Dashboard
*   **Components:** `DashboardView.tsx`, `HistoryView.tsx`
*   **Flow:** All completed actions (conversions, upload additions) log an entry.
*   **Logic:** Displayed in a table/list format. The Dashboard shows recent activity and aggregates statistics (Total, Successful, Failed) using `StatsCardWithTrend.tsx`.

---

## 3. How Everything Connects (Architecture)

1.  **Entry Point (`index.tsx` & `App.tsx`):** 
    *   `App.tsx` is the central orchestrator. It holds the global state (initialized from `StorageManager`) for User Profile, Settings, Stats, and History.
    *   It applies the global theme (`useEffect` hooks modifying the DOM based on Settings).
    *   It defines the React Router (`<Routes>`) wrapping all views in `Suspense` for lazy loading (code-splitting).

2.  **Navigation (`Sidebar.tsx` & `MobileHeader.tsx`):**
    *   Provides routing to `/`, `/upload`, `/compress`, `/upload`, `/extract`, `/history`, `/settings`, and `/profile`.

3.  **Local Storage abstraction (`storageManager.ts`):**
    *   Acts as the single source of truth for persistent frontend state across sessions. Every time a setting, history item, or stat changes, it is written back to `localStorage`.

4.  **Backend Integration:**
    *   The frontend runs on a Vite dev server (usually port 5173).
    *   It communicates with TWO concurrent backend services:
        *   **Fastify API (Port 8080):** Handles heavy document conversions and authentication (`backend/src/index.api.ts`).
        *   **Express Upload Server (Port 3002):** Handles WebClient swarms and streaming (`upload-server.js`).
    *   API calls from the frontend are either proxy-routed via `vite.config.ts` (e.g., `/api/uploads` routes to 3002) or called directly using absolute URLs.

5.  **Extensibility:**
    *   **New Tools:** Can be easily added by creating a new `View` component in `/components` and adding a new route in `App.tsx`.
    *   **New Languages:** Managed centrally in `translations.ts`.
    *   **New Themes:** Add new CSS variable groups in `index.css` and map them in `App.tsx`'s theme effect.

## 4. Current State & Immediate Next Steps
* - [x] **Phase 1: Secrets & Configuration** (Backend config strict validation with Zod, dotenv on all entrypoints).
* - [x] **Phase 2: Authentication & Authorization** (Migrated to Firebase Native Auth; deleted custom OTP/JWT routes).
* - [x] **Phase 3: Data Layer Migration** (Settings, Stats, History migrated from localStorage to Firestore for cross-device sync).
*   **Aesthetics:** The UI is built with a strong focus on modern aesthetics (animations, glass effects, custom theming).
*   **Architecture Split:** The Upload streaming backend (Express on 3002) and Document Conversion backend (Fastify on 8080) are fully functional.
*   **Security & Config (Production Ready):** Environment configuration is hardened. Both backends enforce strict synchronous validation of required `.env` variables at boot time and will fail fast if misconfigured.
*   **Storage:** `StorageManager` continues to provide a fast, synchronous cache via `localStorage`, but is now backed by a real-time Firestore sync (`onSnapshot`). User metadata (history, settings, stats) persists natively across devices.
