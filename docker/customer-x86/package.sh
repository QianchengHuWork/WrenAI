#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
DIST_DIR="${DIST_DIR:-$SCRIPT_DIR/dist}"
PLATFORM="${PLATFORM:-linux/amd64}"

PACKAGE_SHA=$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)
FULL_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
PACKAGE_TAG="${PACKAGE_TAG:-$PACKAGE_SHA}"
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

WREN_UI_IMAGE_REPO="${WREN_UI_IMAGE_REPO:-wrenai-customer/wren-ui}"
WREN_AI_SERVICE_IMAGE_REPO="${WREN_AI_SERVICE_IMAGE_REPO:-wrenai-customer/wren-ai-service}"
WREN_UI_IMAGE="${WREN_UI_IMAGE_REPO}:${PACKAGE_TAG}"
WREN_AI_SERVICE_IMAGE="${WREN_AI_SERVICE_IMAGE_REPO}:${PACKAGE_TAG}"

WREN_BOOTSTRAP_IMAGE="${WREN_BOOTSTRAP_IMAGE:-ghcr.io/canner/wren-bootstrap:0.1.5}"
WREN_ENGINE_IMAGE="${WREN_ENGINE_IMAGE:-ghcr.io/canner/wren-engine:0.22.0}"
IBIS_SERVER_IMAGE="${IBIS_SERVER_IMAGE:-ghcr.io/canner/wren-engine-ibis:0.22.0}"
QDRANT_IMAGE="${QDRANT_IMAGE:-qdrant/qdrant:v1.11.0}"

SOURCE_WREN_BOOTSTRAP_IMAGE="ghcr.io/canner/wren-bootstrap:0.1.5"
SOURCE_WREN_ENGINE_IMAGE="ghcr.io/canner/wren-engine:0.22.0"
SOURCE_IBIS_SERVER_IMAGE="ghcr.io/canner/wren-engine-ibis:0.22.0"
SOURCE_NODE_BASE_IMAGE="node:18-bookworm-slim"
SOURCE_PYTHON_BUILD_IMAGE="python:3.12.0-bookworm"
SOURCE_PYTHON_RUNTIME_IMAGE="python:3.12.0-slim-bookworm"

LOCAL_NODE_BASE_IMAGE="wrenai-customer/base-node:18-bookworm-slim"
LOCAL_PYTHON_BUILD_IMAGE="wrenai-customer/base-python-build:3.12.0-bookworm"
LOCAL_PYTHON_RUNTIME_IMAGE="wrenai-customer/base-python-runtime:3.12.0-slim-bookworm"
LOCAL_SOURCE_WREN_BOOTSTRAP_IMAGE="wrenai-customer/source-wren-bootstrap:0.1.5"
LOCAL_SOURCE_WREN_ENGINE_IMAGE="wrenai-customer/source-wren-engine:0.22.0"
LOCAL_SOURCE_IBIS_SERVER_IMAGE="wrenai-customer/source-wren-engine-ibis:0.22.0"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

checksum_file() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file"
  else
    shasum -a 256 "$file"
  fi
}

render_env_file() {
  local output="$1"
  sed \
    -e "s/^PACKAGE_TAG=.*/PACKAGE_TAG=${PACKAGE_TAG}/" \
    -e "s/^WREN_UI_VERSION=.*/WREN_UI_VERSION=${PACKAGE_TAG}/" \
    -e "s/^WREN_AI_SERVICE_VERSION=.*/WREN_AI_SERVICE_VERSION=${PACKAGE_TAG}/" \
    "$SCRIPT_DIR/.env.customer.example" > "$output"
}

prepare_ai_context() {
  local target_dir="$1"
  mkdir -p "$target_dir"
  tar \
    -C "$REPO_ROOT/wren-ai-service" \
    --exclude='.env.dev' \
    --exclude='.venv' \
    --exclude='.pytest_cache' \
    --exclude='__pycache__' \
    --exclude='.mypy_cache' \
    -cf - . | tar -C "$target_dir" -xf -
  cp "$SCRIPT_DIR/config.customer.yaml" "$target_dir/config.customer.yaml"
}

docker_pull_with_retry() {
  local image="$1"
  local attempts=3
  local i

  for i in $(seq 1 "$attempts"); do
    if docker pull --platform "$PLATFORM" "$image"; then
      return 0
    fi
    if [[ "$i" -lt "$attempts" ]]; then
      sleep 2
    fi
  done

  echo "Failed to pull image after ${attempts} attempts: $image" >&2
  return 1
}

rebundle_dependency_image() {
  local source_image="$1"
  local target_image="$2"
  local context_dir="$TMP_DIR/$(echo "$target_image" | tr '/:' '_')"

  mkdir -p "$context_dir"
  cat > "$context_dir/Dockerfile" <<EOF
ARG SOURCE_IMAGE
FROM \${SOURCE_IMAGE}
EOF

  docker buildx build \
    --platform "$PLATFORM" \
    --pull=false \
    --build-arg SOURCE_IMAGE="$source_image" \
    --load \
    -t "$target_image" \
    "$context_dir"
}

require_command docker
require_command git
require_command tar
require_command gzip

if ! docker buildx version >/dev/null 2>&1; then
  echo "docker buildx is required." >&2
  exit 1
fi

if [[ -z "${SILICONFLOW_API_KEY:-}" ]]; then
  echo "SILICONFLOW_API_KEY must be exported before packaging." >&2
  exit 1
fi

if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "Tracked files are dirty. Commit or stash changes before packaging." >&2
  exit 1
fi

mkdir -p "$DIST_DIR"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wrenai-customer.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

AI_CONTEXT="$TMP_DIR/wren-ai-service"
prepare_ai_context "$AI_CONTEXT"

echo "Pulling base images for local offline-tagged builds"
docker_pull_with_retry "$SOURCE_NODE_BASE_IMAGE"
docker_pull_with_retry "$SOURCE_PYTHON_BUILD_IMAGE"
docker_pull_with_retry "$SOURCE_PYTHON_RUNTIME_IMAGE"

docker tag "$SOURCE_NODE_BASE_IMAGE" "$LOCAL_NODE_BASE_IMAGE"
docker tag "$SOURCE_PYTHON_BUILD_IMAGE" "$LOCAL_PYTHON_BUILD_IMAGE"
docker tag "$SOURCE_PYTHON_RUNTIME_IMAGE" "$LOCAL_PYTHON_RUNTIME_IMAGE"

echo "Building $WREN_AI_SERVICE_IMAGE"
docker buildx build \
  --platform "$PLATFORM" \
  --pull=false \
  --load \
  --build-arg AI_CONFIG_FILE=config.customer.yaml \
  --build-arg PYTHON_BUILD_IMAGE="$LOCAL_PYTHON_BUILD_IMAGE" \
  --build-arg PYTHON_RUNTIME_IMAGE="$LOCAL_PYTHON_RUNTIME_IMAGE" \
  --build-arg SILICONFLOW_API_KEY="$SILICONFLOW_API_KEY" \
  --label "org.opencontainers.image.revision=$FULL_SHA" \
  --label "org.opencontainers.image.created=$BUILD_TIME" \
  -t "$WREN_AI_SERVICE_IMAGE" \
  -f "$AI_CONTEXT/docker/Dockerfile" \
  "$AI_CONTEXT"

echo "Building $WREN_UI_IMAGE"
docker buildx build \
  --platform "$PLATFORM" \
  --pull=false \
  --load \
  --build-arg NODE_BASE_IMAGE="$LOCAL_NODE_BASE_IMAGE" \
  --label "org.opencontainers.image.revision=$FULL_SHA" \
  --label "org.opencontainers.image.created=$BUILD_TIME" \
  -t "$WREN_UI_IMAGE" \
  -f "$REPO_ROOT/wren-ui/Dockerfile" \
  "$REPO_ROOT/wren-ui"

echo "Pulling bundled dependency images"
docker_pull_with_retry "$SOURCE_WREN_BOOTSTRAP_IMAGE"
docker_pull_with_retry "$SOURCE_WREN_ENGINE_IMAGE"
docker_pull_with_retry "$SOURCE_IBIS_SERVER_IMAGE"
docker_pull_with_retry "$QDRANT_IMAGE"

docker tag "$SOURCE_WREN_BOOTSTRAP_IMAGE" "$LOCAL_SOURCE_WREN_BOOTSTRAP_IMAGE"
docker tag "$SOURCE_WREN_ENGINE_IMAGE" "$LOCAL_SOURCE_WREN_ENGINE_IMAGE"
docker tag "$SOURCE_IBIS_SERVER_IMAGE" "$LOCAL_SOURCE_IBIS_SERVER_IMAGE"

echo "Rebundling dependency images into customer-local tags"
rebundle_dependency_image "$LOCAL_SOURCE_WREN_BOOTSTRAP_IMAGE" "$WREN_BOOTSTRAP_IMAGE"
rebundle_dependency_image "$LOCAL_SOURCE_WREN_ENGINE_IMAGE" "$WREN_ENGINE_IMAGE"
rebundle_dependency_image "$LOCAL_SOURCE_IBIS_SERVER_IMAGE" "$IBIS_SERVER_IMAGE"

IMAGES_ARCHIVE="$DIST_DIR/images-${PACKAGE_SHA}.tar.gz"
SOURCE_ARCHIVE="$DIST_DIR/source-${PACKAGE_SHA}.tar.gz"
MANIFEST_FILE="$DIST_DIR/images.manifest.txt"
CHECKSUM_FILE="$DIST_DIR/checksums.txt"

echo "Saving bundled images to $IMAGES_ARCHIVE"
docker save \
  "$WREN_UI_IMAGE" \
  "$WREN_AI_SERVICE_IMAGE" \
  "$WREN_BOOTSTRAP_IMAGE" \
  "$WREN_ENGINE_IMAGE" \
  "$IBIS_SERVER_IMAGE" \
  "$QDRANT_IMAGE" | gzip > "$IMAGES_ARCHIVE"

echo "Archiving tracked source at $SOURCE_ARCHIVE"
git -C "$REPO_ROOT" archive --format=tar.gz --output "$SOURCE_ARCHIVE" HEAD

cat > "$MANIFEST_FILE" <<EOF
package_sha=${PACKAGE_SHA}
full_sha=${FULL_SHA}
build_time=${BUILD_TIME}
platform=${PLATFORM}
ui_image=${WREN_UI_IMAGE}
ai_image=${WREN_AI_SERVICE_IMAGE}
bootstrap_image=${WREN_BOOTSTRAP_IMAGE}
engine_image=${WREN_ENGINE_IMAGE}
ibis_image=${IBIS_SERVER_IMAGE}
qdrant_image=${QDRANT_IMAGE}
EOF

{
  checksum_file "$IMAGES_ARCHIVE"
  checksum_file "$SOURCE_ARCHIVE"
  checksum_file "$MANIFEST_FILE"
} > "$CHECKSUM_FILE"

cp "$SCRIPT_DIR/docker-compose.customer.yaml" "$DIST_DIR/"
cp "$SCRIPT_DIR/README.customer.md" "$DIST_DIR/"
cp "$SCRIPT_DIR/config.customer.yaml" "$DIST_DIR/"
cp "$SCRIPT_DIR/.env.customer.example" "$DIST_DIR/"
cp "$SCRIPT_DIR/install.sh" "$DIST_DIR/"
render_env_file "$DIST_DIR/.env.customer"

chmod +x "$DIST_DIR/install.sh"

echo "Customer bundle is ready in $DIST_DIR"
