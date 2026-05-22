# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
#   Install ALL dependencies (including devDependencies) and compile / prune.
#   Nothing from this stage leaks into the final image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy manifests first — layer is cached as long as package*.json don't change
COPY package.json package-lock.json ./

# Install everything (dev + prod) so we can run any build steps if needed
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder
#   Prune devDependencies so the final node_modules is production-only.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./

# Re-run ci in production mode to get a clean, prod-only node_modules
RUN npm ci --omit=dev --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runtime
#   Minimal image: only prod node_modules + application source.
#   Runs as non-root user (node uid=1000).
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install dumb-init so Node.js is NOT PID 1 (proper signal handling)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Drop to non-root before copying anything
USER node

# Copy prod node_modules from builder stage
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=node:node package.json ./
COPY --chown=node:node src/ ./src/

# Document the port the app listens on (informational)
EXPOSE 3000

# Health-check: curl is not present in alpine-node; use node itself
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# dumb-init wraps node so SIGTERM is forwarded correctly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]