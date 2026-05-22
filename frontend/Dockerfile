# ─────────────────────────────────────────────────────────────────────────────
# Stage 1 — deps
# Install ALL dependencies (including devDeps needed for the Vite build).
# Cached separately so a source-only change doesn't re-run npm ci.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2 — builder
# Copy source, inject build-time env vars, run vite build.
#
# VITE_BACKEND_URL and VITE_JWT_TOKEN are baked into the JS bundle at build
# time by Vite (import.meta.env.*). Pass them as --build-arg in CI or set
# them in your build pipeline secrets.
#
# In K8s the backend is reachable at http://backend-service:3000 from within
# the cluster, but the browser needs the external URL. The nginx proxy in
# Stage 3 handles in-cluster routing, so VITE_BACKEND_URL can point to the
# Ingress hostname.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Build args — override at build time:
#   docker build --build-arg VITE_BACKEND_URL=https://cicd.local ...
ARG VITE_BACKEND_URL=http://localhost:3000
ARG VITE_JWT_TOKEN=changeme

ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_JWT_TOKEN=$VITE_JWT_TOKEN

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3 — runtime
# Serve the static Vite output with Nginx.
# Final image is ~25 MB (nginx:alpine base) with zero Node.js runtime.
# ─────────────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove the default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our production Nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy the Vite build output
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx runs on port 80
EXPOSE 80

# Nginx starts in foreground (required for Docker/K8s)
CMD ["nginx", "-g", "daemon off;"]