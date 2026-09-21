FROM node:20-bookworm

# PDF->DOCX dependencies
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

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN mkdir -p /app/storage/uploads /app/storage/jobs

EXPOSE 8080
CMD ["node", "dist/index.api.js"]
