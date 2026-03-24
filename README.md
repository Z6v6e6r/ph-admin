# Admin Panel Backend (NestJS)

Стартовый backend для админ-панели с ролевой моделью и мессенджером с клиентами.

Игры и турниры берутся из ЛК ПадлХаб и в админке доступны в режиме чтения.

Текущая целевая модель интеграций:

- NestJS = ядро (RBAC, диалоги, UI API, AI, настройки)
- Node-RED = транспортный слой коннекторов (Telegram/MAX/прочие каналы)

## Роли

- `SUPER_ADMIN`
- `TOURNAMENT_MANAGER`
- `GAME_MANAGER`
- `STATION_ADMIN` (админ станции)
- `MANAGER` (управляющий)
- `SUPPORT`
- `CLIENT`

## Быстрый запуск

```bash
npm install
npm run build
npm run start
```

API работает на `http://localhost:3000/api`.

Схема деплоя на сервере (Docker Compose: API + Node-RED + Nginx):

- `deploy/DEPLOYMENT.md`
- `deploy/PADLHUB_INFRA_BLUEPRINT.md` (привязка под текущие серверы/домены)

Локальная страница UI (готовая HTML-обертка для админ-панели):

- `http://localhost:3000/api/ui/admin`
- с параметрами, например:
  `http://localhost:3000/api/ui/admin?roles=SUPER_ADMIN&userId=local-admin`

## Источник игр и турниров (ЛК ПадлХаб)

Поддерживаются два режима:

- `mock` (по умолчанию, если URL не заданы)
- `http` (данные читаются из ЛК)

Переменные окружения:

- `LK_PADELHUB_MODE=mock|http`
- `LK_PADELHUB_GAMES_URL=https://...`
- `LK_PADELHUB_TOURNAMENTS_URL=https://...`
- `LK_PADELHUB_API_TOKEN=<token>` (опционально, передается как Bearer)
- `MONGODB_DB=dialog` (опционально; база для диалогов/чатов, по умолчанию `dialog`)
- `GAMES_SOURCE=lk|mongo` (по умолчанию `lk`; для Mongo-источника игр укажите `mongo`)
- `GAMES_MONGODB_URI=mongodb://...` (опционально; если не задано, используется `MONGODB_URI`)
- `GAMES_MONGODB_DB=games` (опционально; по умолчанию `games`)
- `GAMES_MONGODB_COLLECTION=lk_games` (опционально; по умолчанию `lk_games`)
- `ADMIN_AUTH_ENABLED=true|false` (по умолчанию `true`)
- `ADMIN_AUTH_REQUIRE_STAFF_TOKEN=true|false` (по умолчанию `true`)
- `ADMIN_AUTH_SECRET=<strong_secret>`
- `ADMIN_AUTH_TTL_HOURS=12`
- `ADMIN_AUTH_USERS_JSON=<json-array>` (логины админов/сотрудников)
  - пример: `[{"id":"superadmin-1","login":"superadmin","password":"change_me","roles":["SUPER_ADMIN"],"stationIds":[]}]`
- `ADMIN_AUTH_MONGODB_DB=dialog` (опционально; по умолчанию используется `MONGODB_DB`, затем `dialog`)
- `ADMIN_AUTH_MONGODB_COLLECTION=admin_users` (опционально; коллекция админ-учеток)
- `TELEGRAM_BOT_TOKEN=<bot_token>` (для отправки сообщений в TG из коннектора)
- `TELEGRAM_WEBHOOK_SECRET=<secret>` (опционально, проверка вебхука)
- `TELEGRAM_STATION_MAPPINGS=<json>` (опционально, mapping station<->groupChat)
- `TELEGRAM_DELIVERY_MODE=outbox|direct` (по умолчанию `outbox`; рекомендован для Node-RED)
- `TELEGRAM_INTEGRATION_TOKEN=<token>` (опционально, защита outbox API для Node-RED)
- `VIVA_ADMIN_API_BASE_URL=https://api.vivacrm.ru` (опционально; базовый URL Viva Admin API)
- `VIVA_ADMIN_API_TOKEN=<token>` (опционально; если задан, используется как статический Bearer token)
- `VIVA_ADMIN_TOKEN_URL=https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/token` (опционально; URL получения access token)
- `VIVA_ADMIN_CLIENT_ID=React-auth-dev` (опционально; client_id для password grant)
- `VIVA_ADMIN_USERNAME=<login>` (опционально; логин Viva для получения access token)
- `VIVA_ADMIN_PASSWORD=<password>` (опционально; пароль Viva для получения access token)
- `VIVA_ADMIN_CACHE_TTL_MS=600000` (опционально; TTL кэша ссылок на ЛК клиентов)
- `VIVA_ADMIN_TIMEOUT_MS=5000` (опционально; timeout запросов к Viva в миллисекундах)

Для Viva CRM поддерживаются два режима:

- статический токен через `VIVA_ADMIN_API_TOKEN`
- автоматическое получение access token через password grant:
  `VIVA_ADMIN_TOKEN_URL + VIVA_ADMIN_CLIENT_ID + VIVA_ADMIN_USERNAME + VIVA_ADMIN_PASSWORD`

## Аутентификация в MVP

Поддерживаются два режима:

- staff-пользователи (админка): логин через `POST /api/auth/login`, затем Bearer token/cookie
- тех. и клиентские интеграции: заголовки `x-user-*` (обратная совместимость)

Если `ADMIN_AUTH_ENABLED=true` и `ADMIN_AUTH_REQUIRE_STAFF_TOKEN=true`, staff-доступ
(`SUPER_ADMIN`, `MANAGER`, `SUPPORT`, `STATION_ADMIN`, `TOURNAMENT_MANAGER`, `GAME_MANAGER`)
разрешается только по токену.

Параметры staff-входа:

- login page: `GET /api/ui/admin/login`
- admin page: `GET /api/ui/admin` (без токена редиректит на login)
- `POST /api/auth/login`
- `POST /api/auth/logout`

Источник staff-учеток:

- если доступен `MONGODB_URI`, auth читает учетки из Mongo-коллекции `admin_users`
- если Mongo-коллекция пуста, но задан `ADMIN_AUTH_USERS_JSON`, пользователи автоматически сидируются в Mongo при старте
- если Mongo недоступен, используется `ADMIN_AUTH_USERS_JSON`

Dev fallback:

- если в Mongo нет учеток, `ADMIN_AUTH_USERS_JSON` пуст и `NODE_ENV != production`, создается временный пользователь:
  `login=admin`, `password=admin12345`
- в production при отсутствии учеток и в Mongo, и в `ADMIN_AUTH_USERS_JSON` приложение завершается с ошибкой запуска

Для обратной совместимости пользователь может передаваться заголовками:

- `x-user-id: <id>`
- `x-user-roles: ROLE_1,ROLE_2` или `x-user-role: ROLE`
- `x-station-ids: station_1,station_2` или `x-station-id: station_1` (для ограничения доступа сотрудника по станциям)

Пример:

```bash
curl http://localhost:3000/api/games \
  -H "x-user-id: manager-1" \
  -H "x-user-roles: GAME_MANAGER"
```

## Основные endpoint'ы

- `GET /api/auth/me`
- `GET /api/auth/permissions`
- `GET /api/auth/config`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/games`
- `GET /api/games/:id`
- `GET /api/tournaments`
- `GET /api/tournaments/:id`
- `GET /api/messenger/threads`
- `GET /api/messenger/threads?connector=TG_BOT&stationId=station-msk-1`
- `POST /api/messenger/threads`
- `GET /api/messenger/threads/:threadId/messages`
- `POST /api/messenger/threads/:threadId/messages`
- `GET /api/messenger/threads/:threadId/response-metrics`
- `PATCH /api/messenger/threads/:threadId/close`
- `GET /api/messenger/connectors`
- `GET /api/messenger/connectors/:connector/stations`
- `GET /api/messenger/connectors/:connector/stations/:stationId/dialogs`
- `GET /api/messenger/settings`
- `GET /api/messenger/settings/viva`
- `PATCH /api/messenger/settings/viva`
- `GET /api/messenger/settings/stations`
- `POST /api/messenger/settings/stations`
- `PATCH /api/messenger/settings/stations/:stationId`
- `GET /api/messenger/settings/connectors`
- `POST /api/messenger/settings/connectors`
- `PATCH /api/messenger/settings/connectors/:connectorId`
- `GET /api/messenger/settings/access-rules`
- `POST /api/messenger/settings/access-rules`
- `PATCH /api/messenger/settings/access-rules/:ruleId`
- `POST /api/integrations/telegram/webhook`
- `GET /api/integrations/telegram/stations`
- `GET /api/integrations/telegram/outbox/pull?limit=20&leaseSec=30`
- `POST /api/integrations/telegram/outbox/:id/ack`
- `POST /api/integrations/telegram/outbox/:id/fail`
- `GET /api/integrations/telegram/outbox?limit=100`

## Коннекторы мессенджера

Поддерживаемые маршруты:

- `TG_BOT`
- `MAX_BOT`
- `LK_WEB_MESSENGER`

При создании диалога (`POST /api/messenger/threads`) обязательно передаются:

- `connector`
- `stationId`

Дополнительно можно передать `stationName`, `subject`, `assignedSupportId`, `aiMode`.

## AI-коннектор в мессенджере

AI-коннектор базово:

- классифицирует диалоги (`topic`)
- оценивает тональность (`sentiment`) и срочность (`urgency`)
- дает оценку качества обработки (`qualityScore`)
- генерирует подсказку сотруднику
- может отправлять автоответ клиенту (если включен `AUTO_REPLY`)

Режимы AI по диалогу:

- `DISABLED`
- `SUGGEST`
- `AUTO_REPLY`

По умолчанию диалог создается с `SUGGEST`. Для клиента режим фиксируется как `SUGGEST`,
изменение режима (`PATCH /ai-mode`) доступно только сотрудникам.

AI endpoint'ы:

- `GET /api/messenger/threads/:threadId/ai-insight`
- `POST /api/messenger/threads/:threadId/ai-analyze`
- `GET /api/messenger/threads/:threadId/ai-suggestions`
- `POST /api/messenger/threads/:threadId/ai-suggest`
- `GET /api/messenger/threads/:threadId/ai-mode`
- `PATCH /api/messenger/threads/:threadId/ai-mode`

## Telegram Connector (bridge)

Добавлен bridge-коннектор для Telegram:

- входящие из личного чата клиента -> `connector=TG_BOT`, тред по клиенту/станции
- сообщения клиента автоматически транслируются в station group chat
- ответы администратора из station group (reply) автоматически отправляются клиенту
- ответы администратора из web-панели по `TG_BOT` также уходят клиенту в Telegram
- для каждой станции формируется свой список диалогов в админке

Webhook endpoint:

- `POST /api/integrations/telegram/webhook`
- `GET /api/integrations/telegram/stations`
- `GET /api/integrations/telegram/outbox/pull`
- `POST /api/integrations/telegram/outbox/:id/ack`
- `POST /api/integrations/telegram/outbox/:id/fail`
- `GET /api/integrations/telegram/outbox`

Важно:

- для станций используется mapping `callback_key -> stationId -> groupChatId`
- по умолчанию в коде зашиты ключи из текущего flow (`yas`, `nagat`, `nagat_p`, `tereh`, `kuncev`, `sochi`, `seleger`, `t-sbora`)
- при необходимости mapping можно полностью переопределить через `TELEGRAM_STATION_MAPPINGS` (JSON-массив)
- при `TELEGRAM_DELIVERY_MODE=outbox` исходящие сообщения не отправляются напрямую в Telegram API, а складываются в outbox для доставки через Node-RED

### Node-RED (рекомендуемый контур)

Inbound (Telegram -> Nest):

1. `telegram receiver` (или ваш текущий `Padel recive`)
2. `http request` -> `POST /api/integrations/telegram/webhook`
3. Передавать сырой `update` из Telegram как JSON body
4. Если включен секрет, передать заголовок `x-telegram-bot-api-secret-token`

Outbound (Nest outbox -> Telegram -> ack/fail):

1. `inject` (каждые 1-2 сек)
2. `http request` -> `GET /api/integrations/telegram/outbox/pull?limit=20&leaseSec=30`
3. `split` по `commands[]`
4. `switch` по `msg.payload.method`:
   - `sendMessage`
   - `answerCallbackQuery`
5. Для каждого метода `http request` к Telegram Bot API:
   - `POST https://api.telegram.org/bot<TOKEN>/sendMessage`
   - `POST https://api.telegram.org/bot<TOKEN>/answerCallbackQuery`
6. При успехе -> `POST /api/integrations/telegram/outbox/:id/ack`
7. При ошибке -> `POST /api/integrations/telegram/outbox/:id/fail` (можно `requeue=true`)

Если задан `TELEGRAM_INTEGRATION_TOKEN`, добавляйте его в заголовок:

- `x-integration-token: <token>`

## Клиентский скачиваемый скрипт

Скрипт для сайта клиента лежит в репозитории:

- `client-sdk/phab-client-messenger.js`

Сервер отдает его через:

- `GET /api/client-script/messenger-widget.js` (вставка через `<script src=...>`)
- `GET /api/client-script/messenger-widget.download.js` (скачивание файла)

Пример подключения на сайт:

```html
<script src="https://YOUR_DOMAIN/api/client-script/messenger-widget.js"></script>
<script>
  window.PHABMessengerWidget.init({
    apiBaseUrl: "https://YOUR_DOMAIN/api",
    clientId: "client-12345",
    pollIntervalMs: 5000,
    stations: [
      { id: "station-msk-1", name: "Москва #1" },
      { id: "station-spb-1", name: "Санкт-Петербург #1" }
    ]
  });
</script>
```

Что делает скрипт:

- рендерит чат-виджет на сайте
- дает клиенту выбрать станцию
- создает диалог с коннектором `LK_WEB_MESSENGER`
- отправляет и получает сообщения
- сохраняет сессию диалога в `localStorage`

## Встраиваемый админ-скрипт (Tilda)

Админ-скрипт:

- `client-sdk/phab-admin-panel.js`

После `npm run build` копия доступна в:

- `dist/phab-admin-panel.js`
- `dist/client-sdk/phab-admin-panel.js`

Сервер отдает его через:

- `GET /api/client-script/admin-panel.js` (вставка через `<script src=...>`)
- `GET /api/client-script/admin-panel.download.js` (скачивание файла)

Текущие разделы в UI:

- `Переписка`
- `Игры`
- `Турниры`
- `Настройки` (станции, коннекторы, права доступа)

Пример подключения на Tilda:

```html
<div id="phab-admin-root"></div>
<script src="https://YOUR_DOMAIN/api/client-script/admin-panel.js"></script>
<script>
  window.PHABAdminPanel.init({
    mountSelector: "#phab-admin-root",
    apiBaseUrl: "https://YOUR_DOMAIN/api",
    userId: "superadmin-1",
    roles: ["SUPER_ADMIN"],
    stationIds: [],
    pollIntervalMs: 8000
  });
</script>
```

Для сотрудника станции:

```html
<script>
  window.PHABAdminPanel.init({
    mountSelector: "#phab-admin-root",
    apiBaseUrl: "https://YOUR_DOMAIN/api",
    userId: "station-admin-1",
    roles: ["STATION_ADMIN"],
    stationIds: ["station-msk-1"]
  });
</script>
```

Если нужно быстро проверить UI локально без Tilda, открывайте:

- `GET /api/ui/admin`
- если включена auth-защита (`ADMIN_AUTH_ENABLED=true`): сначала `GET /api/ui/admin/login`

Эта страница автоматически подключает `admin-panel.js` и монтирует интерфейс.
