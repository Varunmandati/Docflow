# DocFlow - Current Project State & Future Opportunities

DocFlow is a robust, full-stack document processing and conversion suite. It handles a wide variety of file operations (conversion, compression, image manipulation) securely and concurrently using a modern job-queue architecture.

## 🏗 Current Architecture & Implemented Features

### 1. Core Platform 
- **Frontend**: Developed with React, Vite, and a custom component library. Features a sleek, responsive design with dark/light themes and internationalization (`translations.ts`).
- **Backend API**: Node.js + Fastify serving as a high-performance REST API.
- **Job/Worker System**: BullMQ powered by Redis manages asynchronous background processing, handled by a separate Node.js worker instance (`backend/src/workers/`).
- **Database**: PostgreSQL (Neon) tracks user accounts, jobs, and audit logs. Database migrations are set up securely (`backend/src/db/migrate.ts`).

### 2. Security & Authentication
- **Firebase Identity**: Primary authentication using Firebase tokens, verified seamlessly in the Fastify middleware.
- **Custom OTP Flow**: Fallback/secondary OTP-based login and email-change workflows leveraging NodeMailer and Redis-backed rate limiting.
- **Robust Rate Limiting**: Endpoint-specific rate limiting (`security.middleware.ts`) that correctly accounts for abuse while employing a "fail-open" strategy if Redis disconnects to preserve base functionality.
- **Artifact Ownership**: RLS (Row Level Security) and application-level checks ensure artifacts/jobs are accessible only by the user who created them.

### 3. Conversion Engine (`conversion-matrix.ts`)
- Explicitly defined format matrices to ensure quality and compatibility.
- Specialized backend converters (`ConverterEngine.ts`):
  - **LibreOfficeEngine**: Seamless MS Office (DOCX, PPTX, XLSX) and ODT/RTF conversions.
  - **SharpEngine**: High-speed raster image transcoding, aware of alpha transparency (preserves PNG/WebP, downgrades BMP/TIFF safely to JPEG).
  - **FfmpegEngine**: Transcodes Audio/Video formats (MP4, MP3, WAV, MKV).
  - **ArchiveEngine**: Zip, Tar, 7z un/re-packaging.
  - **PdfEngine**: Handled via `pdf-lib` and ghostscript/cairo backend processes.

### 4. Advanced Compression
- Smart optimization heuristics for quality scaling based on file type.
- Presets available: `optimize`, `web`, `email`, `whatsapp`, `print`.
- Detects whether a PDF is text-heavy or scanned to adjust DPI reduction appropriately.

### 5. Feature-Rich Frontend Views
- **Dashboard**: Quick conversion stats and unified file drops.
- **Compressor & Converter Views**: Tailored UX per conversion type showing live progress status indicators synced via Fastify.
- **Image Extractor & Page Manager**: Client-side parsing capability to rip images rapidly out of arrays of documents.

---

## 🚀 Potential Features & Improvements

Below are several avenues to expand and improve the platform further:

### 1. AI & Intelligent Document Processing
- **Document Summarization**: Add an endpoint utilizing the existing AI route pattern (currently handling Gemini filename suggestion) to summarize long PDFs or Word documents automatically.
- **Document Q&A / Chat**: Allow users to query the AI about the contents of their uploaded research papers or books.
- **Optical Character Recognition (OCR)**: Integrate Tesseract.js or Cloud Vision APIs to extract raw text from image-only / scanned PDFs.

### 2. Advanced Output Manipulation
- **Watermarking**: Hook into the `EngineOptions` to add visual watermarking for PDFs and images securely onto output files.
- **Bespoke PDF Editing**: Provide tools for users to split PDFs, merge multiple PDFs, or delete specific pages visually. (Currently, the app handles "Image Extractor", but outright PDF manipulation is highly demanded).

### 3. Cloud Storage Integrations
- **Cloud Extractors**: Integrate Google Drive Picker and Dropbox Chooser APIs. Allowing users to pull files directly from the cloud rather than downloading locally only to re-upload.
- **Direct-to-Cloud Exports**: Save finished conversions straight into the user's Google Drive.

### 4. Premium Tiers & Monetization
- Introduce a "Pro" token in the Firebase JWT or Postgres user table.
- Modify the `security.middleware.ts` to apply less aggressive rate limits and bypass filesize limits for premium accounts.

### 5. Infrastructure Observability
- Add a Prometheus/Grafana or Datadog hook in the BullMQ worker to track queue depth, processing latency per Engine (e.g. how fast is LibreOffice compared to FFmpeg), and failure thresholds.
- Build an admin-only React View for platform health (Active Jobs, Failed Jobs).

### 6. Notifications
- Integrate WebSocket or SSE (Server-Sent Events) in the backend to push real-time conversion job updates to the frontend instead of relying purely on interval polling.
- Web Push notifications or email alerts when large/long conversions (like Video re-encoding) finally finish.