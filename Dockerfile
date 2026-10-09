# =============================================================================
# DocFlow - one image, the whole product.
#
#   frontend   : builds the React SPA (Fastify serves it from ./dist)
#   backend    : builds the Fastify API + queue workers
#   runtime    : LibreOffice / FFmpeg / pdf2docx + all artifacts
#
# Keeping SPA and API in one container is what makes a single free-tier host
# sufficient: the API serves the SPA itself, so only one port is ever exposed.
# =============================================================================

# --- Stage 1: frontend -------------------------------------------------------
FROM node:20-bookworm AS frontend
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000
COPY . .

# Vite inlines VITE_* values into the browser bundle at BUILD time, so they
# have to be visible to this stage. Docker containers only receive service
# environment variables through ARG -> ENV, so every one of them is declared
# here. When unset (e.g. a bare `docker build .`) they compile to an empty
# string and the app degrades to same-origin API calls + Firebase disabled,
# instead of failing the build.
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID
ARG VITE_API_BASE_URL
ENV VITE_FIREBASE_API_KEY=${VITE_FIREBASE_API_KEY} \
    VITE_FIREBASE_AUTH_DOMAIN=${VITE_FIREBASE_AUTH_DOMAIN} \
    VITE_FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID} \
    VITE_FIREBASE_STORAGE_BUCKET=${VITE_FIREBASE_STORAGE_BUCKET} \
    VITE_FIREBASE_MESSAGING_SENDER_ID=${VITE_FIREBASE_MESSAGING_SENDER_ID} \
    VITE_FIREBASE_APP_ID=${VITE_FIREBASE_APP_ID} \
    VITE_FIREBASE_MEASUREMENT_ID=${VITE_FIREBASE_MEASUREMENT_ID} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# --- Stage 2: backend -------------------------------------------------------
FROM node:20-bookworm AS backend
WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --no-audit --no-fund --fetch-retries=5 --fetch-retry-maxtimeout=120000
COPY backend ./backend
# Prune devDependencies inside the stage: intermediate layers of a build stage
# are not part of the final image, so this costs nothing here - while installing
# again in the runtime stage would add a second full copy of node_modules.
RUN cd backend && npm run build && npm prune --omit=dev

# --- Stage 3: runtime -------------------------------------------------------
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
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*

# Setup lightweight Python venv for pdf2docx.
# pip itself is never imported at runtime - drop it to keep the layer small.
RUN python3 -m venv /opt/pdf2docx-venv && \
    /opt/pdf2docx-venv/bin/pip install --no-cache-dir pdf2docx && \
    rm -rf /opt/pdf2docx-venv/lib/python3*/site-packages/pip
ENV PDF_DOCX_PYTHON=/opt/pdf2docx-venv/bin/python3

# Copy pre-built backend code.
# --chown avoids a recursive `chown -R` afterwards, which would duplicate every
# file into its own layer (hundreds of MB on an image this size). The stage has
# already pruned devDependencies, so no second `npm ci` here - that install used
# to add another full copy of node_modules on top of this one.
COPY --chown=node:node --from=backend /app/backend ./backend

# Built SPA - served by Fastify from path.resolve(cwd(), 'dist')
COPY --chown=node:node --from=frontend /app/dist ./dist

# Symlink scripts directory so cwd doesn't matter
RUN ln -s /app/backend/scripts /app/scripts

# Copy start script
COPY --chown=node:node start.sh ./start.sh
RUN chmod +x ./start.sh

# Writable dirs the processes create at runtime (uploads/jobs).
# Only the directories themselves are chowned - their contents do not exist yet,
# so this stays a tiny layer instead of duplicating /app.
RUN mkdir -p /app/backend/storage/uploads /app/backend/storage/jobs /app/backend/storage/temp && \
    chown node:node /app && \
    chown -R node:node /app/backend/storage

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
