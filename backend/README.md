# DocFlow Conversion Backend

Production-oriented document conversion backend using rendering-first architecture:

Input file -> LibreOffice Headless -> PDF (source of truth) -> optional outputs (images, HTML, split pages)

## Features

- Rendering-based conversion with LibreOffice (no text-only parsers)
- Queue-based async processing with BullMQ + Redis
- Batch-ready worker architecture
- Retries, progress tracking, structured status
- PDF post-processing: split pages and per-page images
- HTML preview generation from PDF
- Dockerized runtime for isolation and reproducibility

## Supported Inputs

- DOC, DOCX
- PPT, PPTX
- XLS, XLSX
- ODT, ODP, ODS
- RTF, TXT

## API Endpoints

- POST /v1/files/upload
- POST /v1/convert
- GET /v1/jobs/:jobId
- GET /v1/jobs/:jobId/result
- GET /v1/previews/:jobId
- GET /v1/files/:fileId/download
- GET /v1/files/download?path=<relativePath>

## Local Run

1. Copy .env.example to .env
2. Install dependencies: npm install
3. Start API: npm run dev:api
4. Start Worker: npm run dev:worker

## Docker Run

1. Copy .env.example to .env
2. docker compose up --build

## Notes on Fidelity

- PDF is treated as the layout source of truth.
- Install required corporate fonts in container/host for pixel-accurate output.
- For enterprise fidelity, keep consistent locale, fonts, and LibreOffice version across environments.
