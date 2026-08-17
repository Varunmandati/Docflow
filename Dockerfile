FROM node:20-slim AS base
WORKDIR /app

# --- Backend build ---
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend ./backend
RUN cd backend && npm run build

# --- Streamtor build ---
COPY streamtor/package*.json ./streamtor/
RUN cd streamtor && npm ci
COPY streamtor ./streamtor
RUN cd streamtor && npm run build

# --- Runtime ---
FROM node:20-slim
WORKDIR /app
COPY --from=base /app/backend ./backend
COPY --from=base /app/streamtor ./streamtor
COPY dist ./dist
RUN cd backend && npm ci --omit=dev
RUN cd streamtor && npm ci --omit=dev

# Simple process manager so both services run in one container
RUN npm install -g concurrently

# Backend listens on 8080 (Fly internal_port); streamtor stays on 127.0.0.1:3002.
EXPOSE 8080
# STREAMTOR_PORT=3002 stops streamtor grabbing Fly's injected PORT=8080
CMD ["concurrently", "node backend/dist/index.api.js", "STREAMTOR_PORT=3002 node streamtor/dist/server.js"]

