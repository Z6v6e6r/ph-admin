# Server Deployment Scheme (NestJS + Node-RED)

This runbook deploys the app on one Linux VM with Docker Compose.

For mapping to current PadlHub infra (IP/domain/limits), see:
- `deploy/PADLHUB_INFRA_BLUEPRINT.md`

Architecture:
- `phab-api` (NestJS core)
- `phab-nodered` (connector transport and flow orchestration)
- `phab-nginx` (public reverse proxy to API)

Public endpoints:
- `http://<server>/api/...`
- `http://<server>/api/ui/admin`
- `http://<server>/api/ui/admin/login`

## 1) Server prerequisites

Install on server:
- Docker Engine 24+
- Docker Compose plugin
- Open TCP 80 in firewall/security group

Recommended host sizing (MVP):
- 2 vCPU
- 4 GB RAM
- 20+ GB disk

## 2) Upload project and prepare env

```bash
cd /opt
sudo git clone <YOUR_REPO_URL> ph-ab
cd /opt/ph-ab/deploy

cp .env.app.example .env.app
cp .env.nodered.example .env.nodered
```

Edit `.env.app` and `.env.nodered`:
- set `TELEGRAM_BOT_TOKEN`
- set same `TELEGRAM_INTEGRATION_TOKEN` in both files
- keep `TELEGRAM_DELIVERY_MODE=outbox`
- set `ADMIN_AUTH_SECRET`
- set `ADMIN_AUTH_USERS_JSON` (at least one staff user)
- set LK source envs (`LK_PADELHUB_MODE`, URLs, token) as needed
- for communities prefer `COMMUNITIES_MONGODB_URI`/`COMMUNITIES_MONGODB_DB`; if using HTTP fallback, set `LK_PADELHUB_COMMUNITIES_LIST_URL`
- to split communities list/detail in HTTP fallback, also set `LK_PADELHUB_COMMUNITY_BY_ID_URL_TEMPLATE`

## 3) Start services

```bash
cd /opt/ph-ab/deploy
docker compose up -d --build
docker compose ps
```

Health checks:
```bash
curl -sS http://127.0.0.1/api/health || true
curl -sS http://127.0.0.1/api || true
```

Container logs:
```bash
docker compose logs -f phab-api
docker compose logs -f nodered
```

## 4) Access Node-RED safely

In this setup Node-RED binds to localhost only (`127.0.0.1:1880`).
Use SSH tunnel from your workstation:

```bash
ssh -L 1880:127.0.0.1:1880 <user>@<server>
```

Then open locally:
- `http://127.0.0.1:1880`

## 5) Import PHAB flows/subflows into Node-RED

Files in repo:
- `/opt/ph-ab/node-red/phab-telegram-bridge-subflow.json`
- `/opt/ph-ab/node-red/phab-telegram-outbox-subflow.json`
- `/opt/ph-ab/node-red/phab-telegram-outbox-flow.json` (full standalone tab)
- `/opt/ph-ab/node-red/phab-viva-inbound-flow.json` (Viva CRM -> Support standalone tab)

Recommended for existing bot flow:
1. Import `phab-telegram-bridge-subflow.json`
2. Import `phab-telegram-outbox-subflow.json`
3. In your current Telegram receiver flow, connect second branch from receiver to `PHAB Telegram Bridge In`
4. Add `inject` (every 2 sec) -> `PHAB Telegram Outbox Worker`
5. Deploy

## 6) Configure Telegram webhook

Set webhook to your server public URL:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://<YOUR_DOMAIN>/api/integrations/telegram/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

If you use HTTP only (no TLS), Telegram webhook will not work reliably in production. Put HTTPS in front (Cloudflare/Nginx+certbot/LB certificate).

## 7) Update and restart

```bash
cd /opt/ph-ab
git pull
cd /opt/ph-ab/deploy
docker compose up -d --build
```

## 8) Backup strategy

Critical data in current version:
- Node-RED data volume: `phab-nodered-data`

Backup example:
```bash
docker run --rm \
  -v phab-nodered-data:/source \
  -v /opt/backups:/backup \
  alpine tar czf /backup/nodered-data-$(date +%F).tar.gz -C /source .
```

## 9) Known production caveat

Current messenger storage in `phab-api` is in-memory. After container restart, threads/messages/settings reset.

For production persistence, next step is to move messenger state to PostgreSQL (and optionally Redis for queues).
