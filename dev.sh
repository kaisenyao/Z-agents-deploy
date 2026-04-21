#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/Z-App"
UI_DIR="$ROOT_DIR/Z-UI"

pids=()

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' is not installed or not in PATH." >&2
    exit 1
  fi
}

require_dir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    echo "Error: required directory '$dir' does not exist." >&2
    exit 1
  fi
}

cleanup() {
  local pid
  trap - EXIT INT TERM

  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for _ in 1 2 3 4 5; do
    local any_running=0

    for pid in "${pids[@]:-}"; do
      if kill -0 "$pid" 2>/dev/null; then
        any_running=1
        break
      fi
    done

    if [[ "$any_running" -eq 0 ]]; then
      return
    fi

    sleep 1
  done

  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

start_service() {
  local name="$1"
  shift

  (
    exec "$@"
  ) &

  local pid=$!
  pids+=("$pid")
  echo "Started $name (pid $pid)"
}

require_command uv
require_command npm
require_command cloudflared

require_dir "$APP_DIR"
require_dir "$UI_DIR"

trap cleanup EXIT INT TERM

echo "Installing backend dependencies..."
(
  cd "$APP_DIR"
  uv sync
)

echo "Starting services..."
start_service "Z-App" bash -lc "cd \"$APP_DIR\" && exec uv run langgraph dev"
start_service "Z-UI" bash -lc "cd \"$UI_DIR\" && exec npm run dev"
start_service "cloudflared" cloudflared tunnel run clearpath

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      if wait "$pid"; then
        exit_code=0
      else
        exit_code=$?
      fi
      if [[ "$exit_code" -ne 0 ]]; then
        echo "Error: a service exited with status $exit_code. Shutting down the rest." >&2
      else
        echo "A service exited normally. Shutting down the rest." >&2
      fi
      exit "$exit_code"
    fi
  done

  sleep 1
done
