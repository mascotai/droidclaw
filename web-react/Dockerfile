# ── Stage 1: Build ──
FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build client SPA (Vite → dist/)
RUN npm run build

# Build server (TypeScript → dist/server/)
RUN npx tsc -p tsconfig.server.json

# ── Stage 2: Production ──
FROM node:22-slim

WORKDIR /app

# Copy built client assets
COPY --from=builder /app/dist ./dist

# Copy package files and install production deps only
COPY --from=builder /app/package.json .
COPY --from=builder /app/package-lock.json* .
RUN npm ci --omit=dev

# Include Drizzle schema + config for automatic DB migrations on startup
COPY --from=builder /app/server/schema.ts ./server/schema.ts
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Entrypoint for migrations + startup
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

EXPOSE 3000
ENV PORT=3000

ENTRYPOINT ["./entrypoint.sh"]
