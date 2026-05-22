#!/usr/bin/env bash
# scripts/deploy.sh
#
# Applies all K8s manifests in order and waits for each rollout to complete.
# Run after build-images.sh.
#
# Usage:
#   ./scripts/deploy.sh

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
error()   { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$SCRIPT_DIR/../k8s"
NAMESPACE="cicd"

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v kubectl   &>/dev/null || error "kubectl not found"
command -v minikube  &>/dev/null || error "minikube not found"

minikube status | grep -q "Running" || error "Minikube is not running. Start it with: minikube start"

# ── Enable required addons ────────────────────────────────────────────────────
info "Enabling Minikube addons..."
minikube addons enable metrics-server &>/dev/null && info "  metrics-server enabled"
minikube addons enable ingress        &>/dev/null && info "  ingress enabled"

# ── Apply manifests in order ──────────────────────────────────────────────────
MANIFESTS=(
  "00-namespace.yaml"
  "01-configmap.yaml"
  "02-secrets.yaml"
  "03-postgres-init-configmap.yaml"
  "04-postgres.yaml"
  "05-rabbitmq.yaml"
  "06-backend.yaml"
  "07-worker.yaml"
  "08-worker-hpa.yaml"
  "09-ingress.yaml"
  "10-frontend.yaml"
)

for manifest in "${MANIFESTS[@]}"; do
  path="$K8S_DIR/$manifest"
  if [[ -f "$path" ]]; then
    info "Applying $manifest..."
    kubectl apply -f "$path"
  else
    warn "Skipping $manifest (not found)"
  fi
done

# ── Wait for rollouts ─────────────────────────────────────────────────────────
info "Waiting for rollouts..."

kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=120s
success "postgres ready"

kubectl rollout status deployment/rabbitmq  -n "$NAMESPACE" --timeout=120s
success "rabbitmq ready"

kubectl rollout status deployment/backend   -n "$NAMESPACE" --timeout=120s
success "backend ready"

kubectl rollout status deployment/worker    -n "$NAMESPACE" --timeout=120s
success "worker ready"

kubectl rollout status deployment/frontend  -n "$NAMESPACE" --timeout=120s
success "frontend ready"

# ── Print access URLs ─────────────────────────────────────────────────────────
echo ""
success "=== Deployment complete ==="
echo ""
echo -e "  ${CYAN}Dashboard:${NC}        $(minikube service frontend-nodeport  -n cicd --url 2>/dev/null)"
echo -e "  ${CYAN}Backend API:${NC}      $(minikube service backend-nodeport   -n cicd --url 2>/dev/null)"
echo -e "  ${CYAN}RabbitMQ UI:${NC}      $(minikube service rabbitmq-management -n cicd --url 2>/dev/null)"
echo ""
echo -e "  ${CYAN}HPA status:${NC}"
kubectl get hpa -n "$NAMESPACE"
echo ""
echo -e "  ${CYAN}All pods:${NC}"
kubectl get pods -n "$NAMESPACE"