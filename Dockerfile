# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY tsoa.json ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

# Create a non-root user
RUN addgroup -S mergemuse && adduser -S mergemuse -G mergemuse

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist

USER mergemuse

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
