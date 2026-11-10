# Deploy on 147 server (systemd + existing nginx)

This profile is for your current infra where nginx and Node-RED already run on server `147.45.103.3`.

## 1) First install

```bash
cd /tmp
git clone https://github.com/Z6v6e6r/ph-admin.git
cd ph-admin
bash deploy/server-147/install.sh
```

If you need a specific Linux user for systemd service:

```bash
APP_USER=ubuntu bash deploy/server-147/install.sh
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
- для communities предпочтительно `COMMUNITIES_MONGODB_URI`, `COMMUNITIES_MONGODB_DB`, `COMMUNITIES_MONGODB_COLLECTION`
- если communities идут по HTTP fallback: `LK_PADELHUB_COMMUNITIES_LIST_URL`
- чтобы разрезать communities list/detail в HTTP fallback: `LK_PADELHUB_COMMUNITY_BY_ID_URL_TEMPLATE`
- `SUPPORT_MONGODB_DB=dialog` (primary backend для support)
- `SUPPORT_WEB_MONGODB_DB=games` (чтобы `LK_WEB_MESSENGER` читал/писал в `games`)
- при необходимости явно закрепить `MAX_BOT`: `SUPPORT_MAX_MONGODB_DB=dialog`
- `GAMES_SOURCE=mongo`, `GAMES_MONGODB_DB=games`, `GAMES_MONGODB_COLLECTION=lk_games`
- `GAMES_CHAT_MONGODB_DB=games_chat`, `GAMES_CHAT_MESSAGES_COLLECTION=chat_messages`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_INTEGRATION_TOKEN` (must match Node-RED)
- keep `PORT=3000` and `HOST=0.0.0.0`
- `TELEGRAM_STATION_MAPPINGS` уже заполнен всеми станциями из текущего TG PadlHub flow
- в JSON поддерживаются оба поля: `key` и `callbackKey`

After changes:

```bash
sudo systemctl restart phab-api
```

## 3) Nginx changes

Use snippet from:
- `deploy/server-147/nginx-api-snippet.conf`

### Request body limit for uploads

The `location ^~ /api/` block must carry `client_max_body_size 20m;`. Ubuntu nginx defaults to
`1m` and answers every larger request with `413 Request Entity Too Large` as `text/html` before it
reaches ph-admin. Before this change the ЦУП panel showed only the fallback
`PadlHub Admin API: HTTP 413` for that response, so station photos, gallery covers and
event-showcase images could not be uploaded at all. The snippet in this repository already contains
the directive; `sites-enabled` entries are commonly symlinks, so keep the preimage of the resolved
regular file and record its digest:

```bash
# 1) Read the active limit and keep a reproducible preimage of the real file.
sudo nginx -T | grep -nE "server_name padlhub.su|client_max_body_size"
SITE=$(readlink -f /etc/nginx/sites-enabled/padlhub.su)
PREIMAGE="/root/$(basename "$SITE").before-body-limit.$(date -u +%Y%m%dT%H%M%SZ)"
sudo cp -a --no-clobber "$SITE" "$PREIMAGE" && sudo sha256sum "$SITE" "$PREIMAGE"

# 2) Add `client_max_body_size 20m;` inside `location ^~ /api/`, then validate and reload.
sudo nginx -t && sudo systemctl reload nginx

# 3) Prove the boundary: a 13 MiB body must leave nginx (JSON 401/403 from ph-admin), not 413.
head -c 13631488 /dev/zero > /tmp/phab-body-probe.bin
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: image/jpeg' -H 'Expect:' \
  --data-binary @/tmp/phab-body-probe.bin \
  https://padlhub.su/api/ui/padlhub-admin/<tenantKey>/location-media
```

The probe passes when the answer is `401`/`403` with `Content-Type: application/json` or any JSON
response from ph-admin; a `413` with `Server: nginx` and `Content-Type: text/html` means the
directive is still missing or not inside the `/api/` location. After the current panel release the
operator additionally sees the actionable `Файл слишком большой…` text instead of the bare status.
Edit `$SITE`, not the `sites-enabled` symlink: an editor that replaces it with a regular file
leaves nginx reading the old target. Rollback in a fresh shell re-derives both paths and checks the
restored digest:

```bash
SITE=$(readlink -f /etc/nginx/sites-enabled/padlhub.su)
PREIMAGE=$(ls -1t /root/*.before-body-limit.* | head -1)
sudo cp -a "$PREIMAGE" "$SITE" && sudo sha256sum "$SITE" "$PREIMAGE"
sudo nginx -t && sudo systemctl reload nginx
```

The two digests must match, and the probe above must now answer the pre-change `413 text/html`;
that inverted result is what proves the rollback took effect.

The production `location ^~ /api/tournaments/public/` compatibility block must be
patched from an audited server preimage before reload. Build a candidate first:

```bash
node scripts/patch-tournament-public-nginx.mjs build \
  --source /etc/nginx/sites-enabled/padlhub.su \
  --output /tmp/padlhub.su.candidate \
  --expected-source-sha256 <audited-source-sha256>
```

Run `nginx -t` against a temporary config that includes the candidate, inspect the
diff, and only during the separately approved deploy stage apply it with an unused
sibling backup path and the printed candidate SHA-256. The managed block preserves
the exact legacy card redirect while proxying nested public tournament API routes
such as `/join` to ph-admin with the same CORS/auth headers as `/api/`.

Add it into your `server { listen 443 ssl; ... }` block, then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Mobile resident check (`/admin/residency/check`) is an optional pretty alias for
the existing CUP route `/api/ui/admin/residency/check`. It is a separate opt-in
location patch: `deploy/server-147/nginx-residency-check-location.conf`. See
`docs/residency-check.md`. Routing/domain changes are not applied by this source
branch and require explicit deployment approval.
Permanent QR links (`/q/<code>`) and CUP deep links (`/admin/qr`) are a separate
opt-in location patch: `deploy/server-147/nginx-qr-links-location.conf`, with an
optional edge rate limit in `nginx-qr-links-rate-limit-http.conf`. See
`docs/qr-links-admin.md` for the full enable/verify/rollback procedure.

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
