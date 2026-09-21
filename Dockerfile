FROM node:20-bookworm AS base
WORKDIR /app

# --- Backend build ---
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
RUN cd backend && npm run build

# --- StreamService build ---
COPY stream-service/package*.json ./stream-service/
RUN cd stream-service && npm ci
COPY stream-service ./stream-service
RUN cd stream-service && npm run build

# --- Runtime ---
# We MUST use bookworm here to install all the system dependencies
# required for document classification, OCR, and PDF->DOCX
FROM node:20-bookworm
WORKDIR /app

# 1. Install all native conversion dependencies (LibreOffice, Ghostscript, FFmpeg, etc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    python3-pip \
    ocrmypdf \
    tesseract-ocr \
    tesseract-ocr-all \
    fonts-liberation \
    fonts-croscore \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-cjk-extra \
    fonts-indic \
    fonts-hosny-amiri \
    && rm -rf /var/lib/apt/lists/*

# Setup Python venv for pdf2docx
RUN python3 -m venv /opt/pdf2docx-venv && \
    /opt/pdf2docx-venv/bin/pip install --no-cache-dir pdf2docx PyMuPDF docx2pdf
ENV PDF_DOCX_PYTHON=/opt/pdf2docx-venv/bin/python3

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    poppler-utils \
    ghostscript \
    ffmpeg \
    p7zip-full \
    fonts-dejavu \
    fonts-liberation \
    fonts-noto \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Copy the pre-built backend and stream-service code
COPY --from=base /app/backend ./backend
COPY --from=base /app/stream-service ./stream-service

# The frontend code and root dist aren't needed here since Vercel hosts the frontend
# but we do need concurrently to run backend and stream-service together
RUN cd backend && npm ci --omit=dev
RUN cd stream-service && npm ci --omit=dev
RUN npm install -g concurrently

# Ensure storage directories exist with proper permissions for document processing
RUN mkdir -p /app/backend/storage/uploads /app/backend/storage/jobs

# Switch to non-root user for security
RUN chown -R node:node /app
USER node

# Backend API runs on 8080 (Matches Render default expectations)
# StreamService stays internal on 127.0.0.1:3002
EXPOSE 8080
ENV PORT=8080

# Use concurrently to run the fastify backend and stream-service in a single container.
# Make sure inline workers are enabled with Render env variables (RUN_INLINE_WORKERS='true').
CMD ["concurrently", "node backend/dist/index.api.js", "STREAM_PORT=3002 node stream-service/dist/server.js"]
