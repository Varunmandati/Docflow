FROM node:20-bookworm AS base
WORKDIR /app

# --- Build backend ---
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
RUN cd backend && npm run build

# --- Runtime stage ---
FROM node:20-bookworm-slim
WORKDIR /app

# Install only essential conversion dependencies for 512MB RAM free tier
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    poppler-utils \
    ghostscript \
    ffmpeg \
    redis-server \
    python3 \
    python3-venv \
    fonts-liberation \
    fonts-crosextra-carlito \
    fonts-dejavu-core \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Setup lightweight Python venv for pdf2docx
RUN python3 -m venv /opt/pdf2docx-venv && \
    /opt/pdf2docx-venv/bin/pip install --no-cache-dir pdf2docx
ENV PDF_DOCX_PYTHON=/opt/pdf2docx-venv/bin/python3

# Copy pre-built backend code
COPY --from=base /app/backend ./backend

# Install production-only dependencies
RUN cd backend && npm ci --omit=dev

# Symlink scripts directory so cwd doesn't matter
RUN ln -s /app/backend/scripts /app/scripts

# Copy start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Ensure storage directories exist with node ownership
RUN mkdir -p /app/backend/storage/uploads /app/backend/storage/jobs /app/backend/storage/temp && \
    chown -R node:node /app

# Switch to unprivileged user
USER node

# Expose HTTP port
EXPOSE 8080
ENV PORT=8080
ENV HOST=0.0.0.0

# Lightweight liveness healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["./start.sh"]
