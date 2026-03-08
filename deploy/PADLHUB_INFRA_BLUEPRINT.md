# PadlHub Admin Portal - Infra Blueprint (Target)

## 1. End-to-end user flow

1. User opens Tilda page.
2. Tilda block loads admin script from `https://padlhub.su/api/client-script/admin-panel.js`.
3. User authenticates at `https://padlhub.su/api/ui/admin/login`.
4. After login user enters admin panel with 4 sections:
   - `Настройки`
   - `Переписка`
   - `Игры`
   - `Турниры`
5. Access to chats/stations/connectors is filtered by role model and station access rules.

## 2. Current infrastructure mapping

- Telegram core bot + Bitrix24 logic:
  - `http://80.78.255.203:2606/zver/`
- Node-RED (LK and connector endpoints):
  - `http://147.45.103.3:1880/`
- Public scripts/domain:
  - `https://padlhub.su`
- MongoDB:
  - `147.45.254.160:27017`

## 3. Connector model

Base connector routes in backend:
- `TG_BOT`
- `MAX_BOT`
- `LK_WEB_MESSENGER`

Connector responsibilities:
- capture inbound and outbound messages from source channels
- create/update threads in admin backend
- allow sending from admin panel to source channels
- keep station-specific dialog queues

## 4. Data persistence

MongoDB persistence is enabled through env:
- `MONGODB_URI`
- `MONGODB_DB`

Persisted entities:
- threads
- messages (inbound + outbound)
- station configs
- connector configs
- access rules
- AI configs/insights/suggestions
- response metrics

Collections (default):
- `messenger_threads`
- `messenger_messages`
- `messenger_station_configs`
- `messenger_connector_configs`
- `messenger_access_rules`
- `messenger_response_metrics`
- `messenger_ai_configs`
- `messenger_ai_insights`
- `messenger_ai_suggestions`

## 5. Dialog loading behavior

Dialog list for station/connector:
- unread dialogs first
- then by latest message time descending

Dialog view:
- full chronological message history for selected thread

## 6. Deployment profile for your servers

Recommended deployment role split:
- `padlhub.su` (API + static script endpoints + admin UI)
- existing Node-RED and TG bot servers stay as connector/orchestration and bot-core layers
- MongoDB remains central storage for admin portal chat data

Mandatory env profile for production:
- `ADMIN_AUTH_ENABLED=true`
- `ADMIN_AUTH_REQUIRE_STAFF_TOKEN=true`
- strong `ADMIN_AUTH_SECRET`
- non-empty `ADMIN_AUTH_USERS_JSON`
- `TELEGRAM_DELIVERY_MODE=outbox`
- shared `TELEGRAM_INTEGRATION_TOKEN` between backend and Node-RED

## 7. Capacity limit and constraints (<=100 admin users)

With current infrastructure, practical limit for admin portal is **up to 100 users**.

Main constraints:
1. Single Node.js app instance (no horizontal scaling in current setup).
2. Node-RED single-instance orchestration for connector delivery.
3. MongoDB network latency (DB is on a separate server).
4. Client polling model in admin panel (periodic refresh) increases read load.
5. No Redis queue/cache layer for burst smoothing.
6. No websocket fanout for realtime updates (polling only).

## 8. What to add when growing above 100 users

1. Redis for queueing and transient state.
2. Dedicated message broker / job workers for connector delivery.
3. WebSocket channel for admin updates instead of polling.
4. Horizontal scaling for API with sticky-free stateless auth.
5. MongoDB replica set and query-level optimization.
