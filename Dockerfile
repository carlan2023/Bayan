# syntax=docker/dockerfile:1
# Single-service image: build the React frontend, install the Node backend,
# then run the backend which also serves the built frontend (one origin).

# ---------- Build stage ----------
FROM node:22-alpine AS build
WORKDIR /app

# Frontend deps (cached until package files change), then build.
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build   # -> frontend/dist

# Backend production deps.
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend/ ./backend/

# ---------- Runtime stage ----------
FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=8080
# Uploaded product images live here; mount a Railway volume at /data to persist them.
ENV UPLOAD_DIR=/data/uploads

# Bring over the built frontend and the backend (with node_modules).
COPY --from=build /app/frontend/dist ../frontend/dist
COPY --from=build /app/backend ./

EXPOSE 8080

# Seed is idempotent (skips if products exist); then start the server.
CMD ["sh", "-c", "node src/seed.js && node src/server.js"]
