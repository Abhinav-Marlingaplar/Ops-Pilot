#!/usr/bin/env bash
# =============================================================================
# teardown.sh
#
# Removes all cicd-platform resources from Minikube.
# Pass --volumes to also delete PersistentVolumeClaims (DATA LOSS).
#
# Usage:
#   ./scripts/teardown.sh              # remove deployments, services, etc.
#   ./scripts/teardown.sh --volumes    # also wipe persistent data
# =============================================================================

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[teardown]${NC} $*"; }
warn()  { echo -e "${YELLOW}[teardown]${NC} $*"; }
error() { echo -e "${RED}[teardown] ERROR:${NC} $*" >&2; exit 1; }

NAMESPACE="cicd"
DELETE_VOLUMES=false

for arg in "$@"; do
  [[ "${arg}" == "--volumes" ]] && DELETE_VOLUMES=true
done

command -v kubectl >/dev/null 2>&1 || error "kubectl not found"

# ── Confirm ──────────────────────────────────────────────────────────────────
warn "This will delete all resources in the '${NAMESPACE}' namespace."
if [[ "${DELETE_VOLUMES}" == "true" ]]; then
  warn "  ⚠️  --volumes flag set: PersistentVolumeClaims will also be deleted (DATA LOSS)"
fi
read -rp "Continue? [y/N] " CONFIRM
[[ "${CONFIRM}" =~ ^[Yy]$ ]] || { info "Aborted."; exit 0; }

# ── Delete Deployments + StatefulSets gracefully ──────────────────────────────
info "Scaling down Deployments..."
kubectl scale deployment backend worker rabbitmq --replicas=0 -n "${NAMESPACE}" 2>/dev/null || true

info "Scaling down StatefulSet postgres..."
kubectl scale statefulset postgres --replicas=0 -n "${NAMESPACE}" 2>/dev/null || true

info "Waiting for pods to terminate..."
kubectl wait --for=delete pod --selector='app.kubernetes.io/part-of=cicd-platform' \
  -n "${NAMESPACE}" --timeout=60s 2>/dev/null || true

# ── Delete all manifest resources ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K8S_DIR="$(cd "${SCRIPT_DIR}/../k8s" && pwd)"

info "Deleting all manifests (reverse order)..."
for MANIFEST in $(ls "${K8S_DIR}"/*.yaml | sort -r); do
  kubectl delete -f "${MANIFEST}" --ignore-not-found=true
done

# ── Optionally delete PVCs ────────────────────────────────────────────────────
if [[ "${DELETE_VOLUMES}" == "true" ]]; then
  warn "Deleting PersistentVolumeClaims..."
  kubectl delete pvc --all -n "${NAMESPACE}" --ignore-not-found=true
fi

# ── Final namespace deletion ──────────────────────────────────────────────────
info "Deleting namespace '${NAMESPACE}'..."
kubectl delete namespace "${NAMESPACE}" --ignore-not-found=true

info "✅  Teardown complete."
