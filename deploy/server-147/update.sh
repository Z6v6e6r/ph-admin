#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ph-admin}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-phab-api}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() {
  printf '\n[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

if [ ! -d "$APP_DIR/.git" ]; then
  echo "Repository not found in ${APP_DIR}" >&2
  exit 1
fi

log "Updating source code"
$SUDO git -C "$APP_DIR" fetch --all --prune
$SUDO git -C "$APP_DIR" checkout "$REPO_BRANCH"
$SUDO git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"

log "Installing dependencies and rebuilding"
$SUDO npm --prefix "$APP_DIR" ci
$SUDO npm --prefix "$APP_DIR" run build

log "Restarting service ${SERVICE_NAME}"
$SUDO systemctl restart "$SERVICE_NAME"
$SUDO systemctl status "$SERVICE_NAME" --no-pager || true

log "Health check"
curl -fsS http://127.0.0.1:3000/api/health || true

log "Update completed"
