# Deploy on 147 server (systemd + existing nginx)

This profile is for your current infra where nginx and Node-RED already run on server `147.45.103.3`.

## 1) First install

```bash
cd /tmp
git clone https://github.com/Z6v6e6r/ph-admin.git
cd ph-admin
bash deploy/server-147/install.sh
```

The script will:
- install Node.js 22 and build tools
- clone/update app to `/opt/ph-admin`
- run `npm ci && npm run build`
- create systemd unit `phab-api.service`
- start service
- create `/opt/ph-admin/.env` from `deploy/server-147/env.147.example` (if missing)

## 2) Configure env

Edit:

```bash
nano /opt/ph-admin/.env
```

Required changes:
- `ADMIN_AUTH_SECRET`
- `ADMIN_AUTH_USERS_JSON`
- `MONGODB_URI`, `MONGODB_DB`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_INTEGRATION_TOKEN` (must match Node-RED)

After changes:

```bash
sudo systemctl restart phab-api
```

## 3) Nginx changes

Use snippet from:
- `deploy/server-147/nginx-api-snippet.conf`

Add it into your `server { listen 443 ssl; ... }` block, then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 4) Checks

```bash
curl -sS http://127.0.0.1:3000/api/health
curl -I https://padlhub.su/api/health
curl -I https://padlhub.su/api/client-script/admin-panel.js
curl -I https://padlhub.su/admin
```

## 5) Update flow

```bash
cd /opt/ph-admin
bash deploy/server-147/update.sh
```

## 6) Logs

```bash
sudo journalctl -u phab-api -f
```
