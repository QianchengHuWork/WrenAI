#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="$ROOT_DIR/docker"

ENV_FILE="$DOCKER_DIR/.env"
ENV_EXAMPLE="$DOCKER_DIR/.env.example"
CONFIG_FILE="$DOCKER_DIR/config.yaml"
CONFIG_EXAMPLE="$DOCKER_DIR/config.example.yaml"

MODE="prod"
ACTION="up"
SERVICE=""
SKIP_INIT="false"
BUILD="false"

print_help() {
  cat <<'EOF'
WrenAI 一键拉起脚本

用法:
  ./scripts/wren-one-click.sh [action] [--mode prod|local|dev] [--service <name>] [--skip-init]

action:
  up         启动服务 (默认)
  down       停止并删除容器
  restart    重启服务
  logs       查看日志 (可配合 --service)
  ps         查看容器状态
  pull       拉取镜像 (仅 prod/local 模式有效)

参数:
  --mode       选择 compose 文件
               prod  -> docker/docker-compose.yaml
               local -> docker/docker-compose-local.yaml
               dev   -> docker/docker-compose-dev.yaml
  --service    指定服务名 (logs/restart/up/down 可用)
  --skip-init  跳过初始化 .env/config.yaml
  --build      启动时重建镜像 (仅 up 生效，适合本地代码改动后)
  -h, --help   显示帮助
EOF
}

err() {
  echo "[ERROR] $*" >&2
}

info() {
  echo "[INFO] $*"
}

check_prerequisites() {
  command -v docker >/dev/null 2>&1 || { err "未找到 docker，请先安装 Docker Desktop"; exit 1; }
  docker info >/dev/null 2>&1 || { err "Docker 未运行，请先启动 Docker Desktop"; exit 1; }

  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
  else
    err "未找到 docker compose 或 docker-compose"
    exit 1
  fi
}

init_files() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    info "已创建 $ENV_FILE（来自 .env.example）"
  fi

  if [[ ! -f "$CONFIG_FILE" ]]; then
    cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
    info "已创建 $CONFIG_FILE（来自 config.example.yaml）"
  fi

  if ! rg -q '^OPENAI_API_KEY=.+$' "$ENV_FILE"; then
    info "请编辑 $ENV_FILE 填写 OPENAI_API_KEY（否则 AI 功能不可用）"
  fi
}

compose_file_by_mode() {
  case "$MODE" in
    prod) echo "docker-compose.yaml" ;;
    local) echo "docker-compose-local.yaml" ;;
    dev) echo "docker-compose-dev.yaml" ;;
    *)
      err "不支持的 mode: $MODE"
      exit 1
      ;;
  esac
}

run_compose() {
  local compose_file="$1"
  shift
  (
    cd "$DOCKER_DIR"
    "${COMPOSE_BIN[@]}" --env-file .env -f "$compose_file" "$@"
  )
}

parse_args() {
  if [[ $# -gt 0 ]]; then
    case "$1" in
      up|down|restart|logs|ps|pull)
        ACTION="$1"
        shift
        ;;
      -h|--help)
        print_help
        exit 0
        ;;
    esac
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        MODE="${2:-}"
        shift 2
        ;;
      --service)
        SERVICE="${2:-}"
        shift 2
        ;;
      --skip-init)
        SKIP_INIT="true"
        shift
        ;;
      --build)
        BUILD="true"
        shift
        ;;
      -h|--help)
        print_help
        exit 0
        ;;
      *)
        err "未知参数: $1"
        print_help
        exit 1
        ;;
    esac
  done
}

main() {
  parse_args "$@"
  check_prerequisites

  local compose_file
  compose_file="$(compose_file_by_mode)"
  info "当前模式: $MODE ($compose_file)"

  if [[ "$SKIP_INIT" != "true" ]]; then
    init_files
  fi

  case "$ACTION" in
    up)
      local up_args=("up" "-d")
      if [[ "$BUILD" == "true" ]]; then
        up_args+=("--build")
      fi
      if [[ -n "$SERVICE" ]]; then
        run_compose "$compose_file" "${up_args[@]}" "$SERVICE"
      else
        run_compose "$compose_file" "${up_args[@]}"
      fi
      info "启动完成，UI 默认访问地址: http://localhost:3000"
      ;;
    down)
      if [[ -n "$SERVICE" ]]; then
        run_compose "$compose_file" stop "$SERVICE"
      else
        run_compose "$compose_file" down
      fi
      ;;
    restart)
      if [[ -n "$SERVICE" ]]; then
        run_compose "$compose_file" restart "$SERVICE"
      else
        run_compose "$compose_file" restart
      fi
      ;;
    logs)
      if [[ -n "$SERVICE" ]]; then
        run_compose "$compose_file" logs -f "$SERVICE"
      else
        run_compose "$compose_file" logs -f
      fi
      ;;
    ps)
      run_compose "$compose_file" ps
      ;;
    pull)
      if [[ "$MODE" == "dev" ]]; then
        err "dev 模式使用本地构建，不建议执行 pull"
        exit 1
      fi
      run_compose "$compose_file" pull
      ;;
  esac
}

main "$@"
