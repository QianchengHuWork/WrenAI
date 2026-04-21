#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$SCRIPT_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-$SCRIPT_DIR/docker-compose.customer.yaml}"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env.customer}"
EXAMPLE_ENV_FILE="$SCRIPT_DIR/.env.customer.example"
HEALTHCHECK_TIMEOUT="${HEALTHCHECK_TIMEOUT:-180}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

find_bundle() {
  local matches=("$SCRIPT_DIR"/images-*.tar.gz)
  if [[ ! -e "${matches[0]}" ]]; then
    echo "Could not find images-*.tar.gz in $SCRIPT_DIR" >&2
    exit 1
  fi
  printf '%s\n' "${matches[0]}"
}

wait_for_stack() {
  local elapsed=0
  while (( elapsed < HEALTHCHECK_TIMEOUT )); do
    if compose exec -T wren-ui curl -fsS "http://127.0.0.1:3000/api/config" >/dev/null 2>&1 \
      && compose exec -T wren-ui curl -fsS "http://wren-ai-service:${WREN_AI_SERVICE_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
    elapsed=$((elapsed + 5))
  done
  return 1
}

require_command docker
require_command gzip

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_ENV_FILE" "$ENV_FILE"
fi

if grep -q '^PACKAGE_TAG=replace-with-package-tag$' "$ENV_FILE"; then
  echo "PACKAGE_TAG is still a placeholder in $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${CUSTOMER_SHARED_ETC_DIR:=./data/shared}"
: "${CUSTOMER_LOCAL_STORAGE_DIR:=./data/local-storage}"
: "${CUSTOMER_UI_DATA_DIR:=./data/ui}"
: "${CUSTOMER_QDRANT_STORAGE_DIR:=./data/qdrant}"
: "${WREN_AI_SERVICE_PORT:=5555}"

mkdir -p \
  "$CUSTOMER_SHARED_ETC_DIR" \
  "$CUSTOMER_LOCAL_STORAGE_DIR" \
  "$CUSTOMER_UI_DATA_DIR" \
  "$CUSTOMER_QDRANT_STORAGE_DIR"

BUNDLE_FILE="${BUNDLE_FILE:-$(find_bundle)}"
echo "Loading bundled images from $BUNDLE_FILE"
gzip -dc "$BUNDLE_FILE" | docker load

echo "Starting customer stack"
compose up -d

echo "Waiting for UI and AI service to become reachable"
if ! wait_for_stack; then
  echo "Customer stack failed health checks" >&2
  compose ps >&2 || true
  compose logs --tail=200 >&2 || true
  exit 1
fi

echo "Customer stack is ready"
echo "UI: http://127.0.0.1:${HOST_PORT:-3000}"
