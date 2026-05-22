#!/usr/bin/env bash
# scripts/build-images.sh
#
# Builds all three Docker images directly into Minikube's Docker daemon so
# K8s can use them with imagePullPolicy: Never (no registry needed).
#
# Usage:
#   ./scripts/build-images.sh                        # build all
#   ./scripts/build-images.sh --only frontend        # build one
#
# Requirements:
#   - Minikube must be running
#   - VITE_JWT_TOKEN must be set in frontend/.env (read below)

set -euo pipefail

# ── Colour output ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[build]${NC} $*"; }
success() { echo -e "${GREEN}[build]${NC} $*"; }
warn()    { echo -e "${YELLOW}[build]${NC} $*"; }
error()   { echo -e "${RED}[build]${NC} $*"; exit 1; }

# ── Parse args ────────────────────────────────────────────────────────────────
ONLY=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --only) ONLY="$2"; shift 2 ;;
    *) error "Unknown argument: $1" ;;
  esac
done

# ── Point Docker CLI at Minikube's daemon ─────────────────────────────────────
info "Pointing Docker CLI at Minikube daemon..."
eval "$(minikube docker-env)" || error "Failed to connect to Minikube. Is it running?"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."

# ── Read frontend env vars for build args ─────────────────────────────────────
FRONTEND_ENV="$ROOT/frontend/.env"
VITE_BACKEND_URL="http://localhost:3000"
VITE_JWT_TOKEN="changeme"

if [[ -f "$FRONTEND_ENV" ]]; then
  # shellcheck disable=SC2002
  VITE_BACKEND_URL=$(grep -E '^VITE_BACKEND_URL=' "$FRONTEND_ENV" | cut -d= -f2- | tr -d '"' || echo "http://localhost:3000")
  VITE_JWT_TOKEN=$(grep -E '^VITE_JWT_TOKEN=' "$FRONTEND_ENV" | cut -d= -f2- | tr -d '"' || echo "changeme")
  info "Read frontend env: VITE_BACKEND_URL=$VITE_BACKEND_URL"
else
  warn "frontend/.env not found — using defaults for build args"
fi

# ── Build functions ───────────────────────────────────────────────────────────

build_backend() {
  info "Building cicd-backend:latest..."
  docker build -t cicd-backend:latest "$ROOT/backend"
  success "cicd-backend:latest built"
}

build_worker() {
  info "Building cicd-worker:latest..."
  docker build -t cicd-worker:latest "$ROOT/worker"
  success "cicd-worker:latest built"
}

build_frontend() {
  info "Building cicd-frontend:latest..."
  docker build \
    --build-arg VITE_BACKEND_URL="$VITE_BACKEND_URL" \
    --build-arg VITE_JWT_TOKEN="$VITE_JWT_TOKEN" \
    -t cicd-frontend:latest \
    "$ROOT/frontend"
  success "cicd-frontend:latest built"
}

# ── Run builds ────────────────────────────────────────────────────────────────

case "$ONLY" in
  backend)  build_backend  ;;
  worker)   build_worker   ;;
  frontend) build_frontend ;;
  "")
    build_backend
    build_worker
    build_frontend
    ;;
  *) error "Unknown --only value: $ONLY. Use backend, worker, or frontend." ;;
esac

echo ""
success "All images built successfully into Minikube daemon:"
docker images | grep -E "cicd-(backend|worker|frontend)" | awk '{printf "  %-30s %s\n", $1":"$2, $3}'