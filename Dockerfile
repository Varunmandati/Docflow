FROM node:20-slim AS base
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
FROM node:20-slim
WORKDIR /app
COPY --from=base /app/backend ./backend
COPY --from=base /app/stream-service ./stream-service
COPY dist ./dist
RUN cd backend && npm ci --omit=dev
RUN cd stream-service && npm ci --omit=dev

# Simple process manager so both services run in one container
RUN npm install -g concurrently

# Backend listens on 8080 (Fly internal_port); stream-service stays on 127.0.0.1:3002.
EXPOSE 8080
# STREAM_PORT=3002 stops stream-service grabbing Fly's injected PORT=8080
CMD ["concurrently", "node backend/dist/index.api.js", "STREAM_PORT=3002 node stream-service/dist/server.js"]

