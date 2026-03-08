#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-}"
APP_DIR="${APP_DIR:-/opt/ph-admin}"
REPO_URL="${REPO_URL:-https://github.com/Z6v6e6r/ph-admin.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-phab-api}"
NODE_MAJOR="${NODE_MAJOR:-22}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() {
  printf '\n[%s] %s\n' "$(date +'%Y-%m-%d %H:%M:%S')" "$*"
}

if [ -z "$APP_USER" ]; then
  if [ "$(id -u)" -ne 0 ]; then
    APP_USER="$(id -un)"
  elif [ -n "${SUDO_USER:-}" ] && id "$SUDO_USER" >/dev/null 2>&1; then
    APP_USER="$SUDO_USER"
  elif id ubuntu >/dev/null 2>&1; then
    APP_USER="ubuntu"
  else
    APP_USER="root"
  fi
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "User '${APP_USER}' not found, fallback to root"
  APP_USER="root"
fi

log "Using APP_USER=${APP_USER}"

log "Installing OS dependencies"
$SUDO apt-get update -y
$SUDO apt-get install -y ca-certificates curl gnupg git build-essential

if ! command -v node >/dev/null 2>&1; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

NODE_VERSION="$(node -v 2>/dev/null || true)"
if [[ -z "$NODE_VERSION" || "$NODE_VERSION" != v${NODE_MAJOR}.* ]]; then
  log "Node.js current version is '${NODE_VERSION:-none}', expected ${NODE_MAJOR}.x"
  log "Re-installing Node.js ${NODE_MAJOR}.x"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi

log "Ensuring app directory ${APP_DIR}"
$SUDO mkdir -p "$(dirname "$APP_DIR")"
if [ ! -d "$APP_DIR/.git" ]; then
  $SUDO git clone "$REPO_URL" "$APP_DIR"
fi

log "Updating source code"
$SUDO git -C "$APP_DIR" fetch --all --prune
$SUDO git -C "$APP_DIR" checkout "$REPO_BRANCH"
$SUDO git -C "$APP_DIR" pull --ff-only origin "$REPO_BRANCH"

log "Installing dependencies and building project"
$SUDO npm --prefix "$APP_DIR" ci
$SUDO npm --prefix "$APP_DIR" run build

if [ ! -f "$APP_DIR/.env" ]; then
  log "Creating .env from template"
  $SUDO cp "$APP_DIR/deploy/server-147/env.147.example" "$APP_DIR/.env"
  $SUDO chown "$APP_USER":"$APP_USER" "$APP_DIR/.env" || true
  log "Edit $APP_DIR/.env before production launch"
fi

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
log "Writing systemd service ${SERVICE_FILE}"
$SUDO tee "$SERVICE_FILE" >/dev/null <<SERVICE
[Unit]
Description=PH Admin Nest API
After=network.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node ${APP_DIR}/dist/main.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
SERVICE

log "Enabling and starting service ${SERVICE_NAME}"
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "$SERVICE_NAME"
$SUDO systemctl status "$SERVICE_NAME" --no-pager || true

log "Done"
echo "Next steps:"
echo "1) Edit ${APP_DIR}/.env (ADMIN_AUTH_SECRET, ADMIN_AUTH_USERS_JSON, MONGODB_URI, tokens)"
echo "2) Restart service: sudo systemctl restart ${SERVICE_NAME}"
echo "3) Check health: curl -sS http://127.0.0.1:3000/api/health"
