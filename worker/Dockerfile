# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder (prod-only node_modules)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runtime
#   The worker needs git and docker CLI to clone repos and build images.
#   docker CLI is installed but the socket must be mounted at runtime
#   (hostPath /var/run/docker.sock) — we never bundle the daemon.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# dumb-init + git + docker CLI
RUN apk add --no-cache dumb-init git docker-cli

WORKDIR /app

# Use node user (uid=1000) — note: docker socket access requires the container
# to run with supplemental group matching the host docker gid (handled in the
# K8s manifest via securityContext.runAsGroup / supplementalGroups).
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/

# Workers don't expose HTTP ports; no EXPOSE needed.
# Liveness is checked by the consumer heartbeat loop (see K8s manifest).

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]