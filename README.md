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

Проверка индексов диалоговых коллекций (strict audit):

```bash
npm run audit:indexes:dialogs
```

API работает на `http://localhost:3000/api`.

Схема деплоя на сервере (Docker Compose: API + Node-RED + Nginx):

- `deploy/DEPLOYMENT.md`
- `deploy/PADLHUB_INFRA_BLUEPRINT.md` (привязка под текущие серверы/домены)

Локальная страница UI (готовая HTML-обертка для админ-панели):

- `http://localhost:3000/api/ui/admin`
- с параметрами, например:
  `http://localhost:3000/api/ui/admin?roles=SUPER_ADMIN&userId=local-admin`

## Источник игр и турниров

Игры по-прежнему читаются из ЛК ПадлХаб.

Турниры в `/api/tournaments` сначала грузятся из Viva End-User виджета расписания,
а если Viva недоступна или не отвечает, используется fallback на старый источник ЛК.

Для ЛК ПадлХаб поддерживаются два режима:

- `mock` (по умолчанию, если URL не заданы)
- `http` (данные читаются из ЛК)

Переменные окружения:

- `LK_PADELHUB_MODE=mock|http`
- `LK_PADELHUB_GAMES_URL=https://...`
- `LK_PADELHUB_TOURNAMENTS_URL=https://...`
- `COMMUNITIES_MONGODB_URI=mongodb://...` (предпочтительный боевой источник сообществ; если не задано, используется `GAMES_MONGODB_URI`, затем `MONGODB_URI`)
- `COMMUNITIES_MONGODB_DB=games` (опционально; по умолчанию `GAMES_MONGODB_DB`, затем `MONGODB_DB`, затем `games`)
- `COMMUNITIES_MONGODB_COLLECTION=lk_communities` (опционально; по умолчанию `lk_communities`)
- `COMMUNITIES_INVITE_BASE_URL=https://padlhub.ru/community/invite/` (опционально; база для генерации invite-link, если в документе есть только `inviteCode`)
- `LK_PADELHUB_COMMUNITIES_URL=https://...` (fallback HTTP-источник сообществ, если Mongo для communities не настроен)
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
  - пример: `[{"id":"superadmin-1","login":"superadmin","password":"change_me","roles":["SUPER_ADMIN"],"stationIds":[],"connectorRoutes":[]}]`
  - `connectorRoutes` опционален; если не задан или пустой, сотруднику доступны все коннекторы
- `ADMIN_AUTH_MONGODB_DB=dialog` (опционально; по умолчанию используется `MONGODB_DB`, затем `dialog`)
- `ADMIN_AUTH_MONGODB_COLLECTION=admin_users` (опционально; коллекция админ-учеток)
- `TELEGRAM_BOT_TOKEN=<bot_token>` (для отправки сообщений в TG из коннектора)
- `TELEGRAM_WEBHOOK_SECRET=<secret>` (опционально, проверка вебхука)
- `TELEGRAM_STATION_MAPPINGS=<json>` (опционально, mapping station<->groupChat)
- `TELEGRAM_DELIVERY_MODE=outbox|direct` (по умолчанию `outbox`; рекомендован для Node-RED)
- `TELEGRAM_INTEGRATION_TOKEN=<token>` (опционально, защита outbox API для Node-RED)
- `SUPPORT_INTEGRATION_TOKEN=<token>` (опционально, защита `support` integration endpoint'ов для Node-RED/внешних коннекторов)
- `REQUEST_BODY_LIMIT=20mb` (опционально; лимит JSON body для текстов и фото-вложений в чатах)
- `SUPPORT_MONGODB_URI=mongodb://...` (опционально; primary URI для `support`, иначе используется `MONGODB_URI`)
- `SUPPORT_MONGODB_DB=dialog` (опционально; primary БД для `support`, иначе используется `MONGODB_DB`, затем `dialog`)
- `SUPPORT_WEB_MONGODB_URI=mongodb://...` (опционально; URI backend-а для `LK_WEB_MESSENGER`, если не задан — используется primary URI)
- `SUPPORT_WEB_MONGODB_DB=games` (опционально; отдельная БД для `LK_WEB_MESSENGER`)
- `SUPPORT_MAX_MONGODB_URI=mongodb://...` (опционально; URI backend-а для `MAX_BOT`, если не задан — используется primary URI)
- `SUPPORT_MAX_MONGODB_DB=dialog` (опционально; отдельная БД для `MAX_BOT`; если не задано, `MAX_BOT` пишет в primary backend)
- `SUPPORT_CLIENTS_COLLECTION=support_clients` (опционально; коллекция профилей клиентов)
- `SUPPORT_DIALOGS_COLLECTION=support_dialogs` (опционально; коллекция диалогов)
- `SUPPORT_MESSAGES_COLLECTION=support_messages` (опционально; коллекция сообщений)
- `SUPPORT_RESPONSE_METRICS_COLLECTION=support_response_metrics` (опционально; коллекция метрик ответа)
- `SUPPORT_OUTBOX_COLLECTION=support_outbox` (опционально; коллекция outbox)
- `SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS=0` (опционально; периодический full-resync support-state из Mongo в память. `0` — выключен, если события пишутся напрямую в Mongo — задайте `5000` или больше)
- `HTTP_METRICS_LOG_INTERVAL_MS=60000` (опционально; интервал логирования агрегированных p50/p95 метрик по `/api/messenger/*` и `/api/support/*`; `0` — выключить)
- `WEB_PUSH_ENABLED=true|false` (опционально; по умолчанию `true`)
- `WEB_PUSH_VAPID_PUBLIC_KEY=<base64url_public_key>` (обязательно для web push)
- `WEB_PUSH_VAPID_PRIVATE_KEY=<base64url_private_key>` (обязательно для web push)
- `WEB_PUSH_SUBJECT=mailto:support@your-domain.com` (опционально; по умолчанию `mailto:support@padelhub.local`)
- `WEB_PUSH_CLICK_URL=/` (опционально; куда открывать приложение по клику на push)
- `WEB_PUSH_MONGODB_URI=mongodb://...` (опционально; отдельный URI для хранения push-подписок, иначе `SUPPORT_MONGODB_URI`/`MONGODB_URI`)
- `WEB_PUSH_MONGODB_DB=dialog` (опционально; отдельная БД для push-подписок, иначе `SUPPORT_MONGODB_DB`/`MONGODB_DB`)
- `WEB_PUSH_SUBSCRIPTIONS_COLLECTION=web_push_subscriptions` (опционально; коллекция подписок web push)
- `VIVA_ADMIN_API_BASE_URL=https://api.vivacrm.ru` (опционально; базовый URL Viva Admin API)
- `VIVA_ADMIN_API_TOKEN=<token>` (опционально; если задан, используется как статический Bearer token)
- `VIVA_ADMIN_TOKEN_URL=https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/token` (опционально; URL получения access token)
- `VIVA_ADMIN_CLIENT_ID=React-auth-dev` (опционально; client_id для password grant)
- `VIVA_ADMIN_USERNAME=<login>` (опционально; логин Viva для получения access token)
- `VIVA_ADMIN_PASSWORD=<password>` (опционально; пароль Viva для получения access token)
- `VIVA_ADMIN_CACHE_TTL_MS=600000` (опционально; TTL кэша ссылок на ЛК клиентов)
- `VIVA_ADMIN_TIMEOUT_MS=5000` (опционально; timeout запросов к Viva в миллисекундах)
- `VIVA_END_USER_API_BASE_URL=https://api.vivacrm.ru` (опционально; базовый URL Viva End-User API для вкладки «Турниры»)
- `VIVA_END_USER_WIDGET_ID=iSkq6G` (опционально; идентификатор end-user виджета расписания)
- `VIVA_TOURNAMENT_EXERCISE_TYPE_IDS=839,1013` (опционально; какие `exerciseTypeIds` считать турнирами)
- `VIVA_TOURNAMENT_LOOKAHEAD_DAYS=14` (опционально; на сколько дней вперед грузить турниры)
- `VIVA_END_USER_TIMEOUT_MS=5000` (опционально; timeout запросов к Viva End-User API)
- `TOURNAMENTS_MONGODB_URI=mongodb://...` (опционально; отдельный Mongo URI для кастомных турниров, иначе используется `MONGODB_URI`)
- `TOURNAMENTS_MONGODB_DB=tournaments` (опционально; база кастомных турниров, по умолчанию `tournaments`)
- `TOURNAMENTS_MONGODB_COLLECTION=custom_tournaments` (опционально; коллекция кастомных турниров)
- `TOURNAMENTS_PUBLIC_BASE_URL=https://padlhub.ru/api/tournaments/public/` (опционально; база для генерации публичной ссылки на турнир)

Публичные endpoint'ы кастомных турниров:

- `GET /api/tournaments/public/:slug` - публичная карточка турнира со skin, параметрами, участниками и waitlist
- `POST /api/tournaments/public/:slug/access-check` - проверка допуска по уровню (`levelLabel`); если уровень не передан, сервис вернет статус онбординга
- `POST /api/tournaments/public/:slug/registrations` - запись участника в турнир или waitlist
- `POST /api/tournaments/public/:slug/mechanics-access` - проверка доступа к турнирной механике по номеру телефона

Админские endpoint'ы кастомных турниров:

- `POST /api/tournaments/custom/from-source/:sourceTournamentId` - создать кастомный турнир на основе турнира из Viva
- `GET /api/tournaments/custom/:id` - получить кастомный турнир целиком для редактирования
- `PATCH /api/tournaments/custom/:id` - обновить кастомный турнир, skin, участников, waitlist и телефоны доступа

VAPID ключи для web push можно сгенерировать командой:

```bash
npx web-push generate-vapid-keys
```

Рекомендуемая схема для разделения коннекторов:

- `LK_WEB_MESSENGER` -> `games`
- `MAX_BOT` -> `dialog`
- `LK_ACADEMY_WEB_MESSENGER` -> `games` (или отдельная БД под Academy)
- `MAX_ACADEMY_BOT` -> `dialog` (или отдельная БД под Academy)
- `PROMO_WEB_MESSENGER` -> `games` (чат с сайта/лендинга, станция `promo`)

Пример:

```env
MONGODB_DB=dialog
SUPPORT_MONGODB_DB=dialog
SUPPORT_WEB_MONGODB_DB=games
# SUPPORT_MAX_MONGODB_DB=dialog
```

Для Viva CRM поддерживаются два режима:

- статический токен через `VIVA_ADMIN_API_TOKEN`
- автоматическое получение access token через password grant:
  `VIVA_ADMIN_TOKEN_URL + VIVA_ADMIN_CLIENT_ID + VIVA_ADMIN_USERNAME + VIVA_ADMIN_PASSWORD`

Для `Сообществ` backend сначала читает коллекцию `lk_communities` из MongoDB. HTTP-источник
`LK_PADELHUB_COMMUNITIES_URL` используется только как fallback, если communities-Mongo не
настроен. Mock-данные остаются только как локальный dev fallback.

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
- `x-connector-routes: MAX_ACADEMY_BOT,LK_ACADEMY_WEB_MESSENGER,PROMO_WEB_MESSENGER` или `x-connector-route: MAX_ACADEMY_BOT` (для ограничения доступа сотрудника по видам коннекторов; если заголовка нет, доступны все)

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
- `GET /api/messenger/dialogs`
- `GET /api/messenger/dialogs/:dialogId`
- `GET /api/messenger/dialogs/:dialogId/messages`
- `POST /api/messenger/dialogs/:dialogId/messages`
- `POST /api/messenger/threads`
- `GET /api/messenger/threads/:threadId/messages`
- `POST /api/messenger/threads/:threadId/messages`
- `GET /api/messenger/web-push/config`
- `POST /api/messenger/web-push/subscriptions`
- `DELETE /api/messenger/web-push/subscriptions`
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
- `GET /api/support/clients/resolve?connector=MAX_BOT&phone=79991234567`
- `POST /api/support/dialogs/events`
- `GET /api/support/analytics/dialogs?from=2026-03-01&to=2026-03-31` (выгрузка диалогов за период для `JSON/CSV`-экспорта в админке)
- `GET /api/support/debug/runtime` (staff-only диагностика runtime-состояния support persistence/connector registry)

Для UI-режима диалогов рекомендуется поток:
`GET /api/messenger/dialogs` -> `GET /api/messenger/dialogs/:dialogId/messages` по клику.
Маршруты `threads/*` сохранены для обратной совместимости.

Параметры чтения сообщений:
- `limit` (по умолчанию 100, максимум 500)
- `before` (ISO timestamp; возвращает сообщения строго раньше этого времени)
- `includeService` (`true|false`, по умолчанию `false`)

## Коннекторы мессенджера

Поддерживаемые маршруты:

- `TG_BOT`
- `MAX_BOT`
- `MAX_ACADEMY_BOT`
- `LK_WEB_MESSENGER`
- `LK_ACADEMY_WEB_MESSENGER`

Для каждого коннектора в `messenger/settings/connectors` теперь поддерживается поле `config`
(JSON-объект с runtime-настройками, редактируется во вкладке `Настройки`).

Базовые presets:

- `MAX_BOT`:
  `inboundEnabled`, `outboxEnabled`, `outboxPollIntervalMs`, `outboxPullLimit`,
  `outboxLeaseSec`, `requireIntegrationToken`, `normalizeStationAlias`,
  `allowedMessageKinds`
- `MAX_ACADEMY_BOT`:
  `inboundEnabled`, `outboxEnabled`, `outboxPollIntervalMs`, `outboxPullLimit`,
  `outboxLeaseSec`, `requireIntegrationToken`, `normalizeStationAlias`,
  `allowedMessageKinds`
- `LK_WEB_MESSENGER`:
  `inboundEnabled`, `widgetEnabled`, `ingestPath`, `sourceTag`,
  `syncFromMongoEnabled`, `syncIntervalMs`, `mapAuthorizedAsVerified`,
  `resolveStationAliasByName`
- `LK_ACADEMY_WEB_MESSENGER`:
  `inboundEnabled`, `widgetEnabled`, `ingestPath`, `sourceTag`,
  `syncFromMongoEnabled`, `syncIntervalMs`, `mapAuthorizedAsVerified`,
  `resolveStationAliasByName`

Можно сохранять и дополнительные custom-ключи в `config` для будущих коннекторов.

## План внедрения: Academy коннекторы

Новые route:

- `MAX_ACADEMY_BOT` (бот в MAX Академии будущего)
- `LK_ACADEMY_WEB_MESSENGER` (сообщения из ЛК Академии будущего)

Поддерживаемые alias (ingest `connector`/`channel`):

- `MAX_ACADEMY_BOT`, `MAX_ACADEMY`, `ACADEMY_MAX_BOT`, `AF_MAX_BOT`, `AB_MAX_BOT`
- `LK_ACADEMY_WEB_MESSENGER`, `LK_ACADEMY`, `ACADEMY_WEB`, `ACADEMY_LK`, `AF_LK`, `AB_LK`

## PROMO WEB-коннектор

Route и alias:

- `PROMO_WEB_MESSENGER`
- `PROMO_WEB`, `WEB_PROMO`, `PROMO_WIDGET`, `SITE_WIDGET`, `PROMO`

Для сайта/лендинга используется станция:

- `stationId = promo`
- `stationName = PROMO`

В access rules или `x-station-ids` доступ к PROMO задается как станция `promo`.
В админке и web-виджете для `PROMO_WEB_MESSENGER` поддерживаются фото-вложения (`attachments[]`, `type=IMAGE`, `url` как `https://...` или `data:image/...`).

Этап 1. Подготовка конфигурации (без клиентского трафика):

1. Обновить backend до версии с новыми route.
2. В `messenger/settings/connectors` создать 2 записи (`MAX_ACADEMY_BOT`, `LK_ACADEMY_WEB_MESSENGER`) с `isActive=false`.
3. Настроить access rules для staff ролей (read/write) на новые route и нужные станции.

Точка теста:

- `GET /api/messenger/settings/connectors` и `GET /api/support/connectors` возвращают новые route.
- Существующие `MAX_BOT`/`LK_WEB_MESSENGER` продолжают работать без изменений.

Этап 2. Inbound dry-run:

1. Отправлять тестовые события в `POST /api/support/dialogs/events` с новыми route.
2. Проверить создание диалога, нормализацию клиента/станции и отображение в админке.

Точка теста:

- Диалоги видны в разделе новых route.
- Поиск `GET /api/support/clients/resolve` корректно находит клиента по `connector + externalUserId`.

Этап 3. Outbox и доставка:

1. Включить `isActive=true` для `MAX_ACADEMY_BOT`.
2. Настроить polling `GET /api/support/outbox/pull?connector=MAX_ACADEMY_BOT`.
3. Для `LK_ACADEMY_WEB_MESSENGER` включить прием входящих из ЛК (через integration flow).

Точка теста:

- Ответ из админки (`POST /api/support/dialogs/:dialogId/reply`) создает outbox-команду в нужном route.
- `ack/fail` корректно меняют статус в outbox.

Этап 4. Canary rollout:

1. Включить новые коннекторы для 1-2 станций.
2. Мониторить 24 часа: количество непрочитанных, SLA первого ответа, долю `FAILED` outbox.
3. После стабильности включить остальные станции.

Точка теста:

- Нет роста ошибок ingest/outbox.
- Нет регрессий по текущим коннекторам (`MAX_BOT`, `LK_WEB_MESSENGER`, `TG_BOT`).

Rollback (быстрый):

1. Выключить `isActive` у `MAX_ACADEMY_BOT` и `LK_ACADEMY_WEB_MESSENGER`.
2. Остановить внешние poll/webhook потоки для новых route.
3. Старые route продолжают обслуживать трафик без миграций данных.

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

## Viva CRM -> Support (через Node-RED)

Для входящих служебных событий из Viva CRM добавлен готовый flow:

- `node-red/phab-viva-inbound-flow.json`

Что делает flow:

- поднимает входящий webhook `POST /vivatest` в Node-RED
- принимает payload от Viva вида `{ phone, email, content, notificationType }`
- очищает `email: "null"`
- отправляет событие в `POST /api/support/dialogs/events`
- пишет сообщение в диалог как служебное (`direction=SYSTEM`, `kind=SYSTEM`)
- дополнительно включает `deliverToClient=true`, поэтому сообщение уходит клиенту штатно через `support outbox -> MAX bridge`
- использует `connector=MAX_BOT`, чтобы событие ложилось в MAX-контур клиента

Node-RED env vars:

- `PHAB_API_BASE=http://localhost:3000/api`
- `SUPPORT_INTEGRATION_TOKEN=<optional>`

Пример payload от Viva:

```json
{
  "phone": "79104303190",
  "email": "null",
  "content": "2515",
  "notificationType": "OTP"
}
```

Что будет отправлено из Node-RED в backend:

```json
{
  "connector": "MAX_BOT",
  "phone": "79104303190",
  "displayName": "Viva CRM",
  "direction": "SYSTEM",
  "kind": "SYSTEM",
  "deliverToClient": true,
  "text": "⬇️ код для входа в личный кабинет: 2515",
  "meta": {
    "source": "viva_crm"
  }
}
```

## Academy Future: Node-RED flow templates

Для шага подключения транспортного контура добавлены готовые flow-файлы:

- `node-red/max-academy-support-bridge-flow.json`
  - клон MAX bridge под `connector=MAX_ACADEMY_BOT`
  - webhook path: `POST /integrations/max-academy/webhook`
  - outbox polling: `/api/support/outbox/pull?connector=MAX_ACADEMY_BOT`
  - env: `SUPPORT_API_BASE_URL`, `SUPPORT_INTEGRATION_TOKEN`,
    `MAX_ACADEMY_BOT_WEBHOOK_SECRET`, `MAX_ACADEMY_BOT_ACCESS_TOKEN`
- `node-red/lk-academy-support-ingest-flow.json`
  - входящий webhook для ЛК Академии: `POST /integrations/lk-academy/webhook`
  - нормализация payload и запись в `POST /api/support/dialogs/events`
  - route события: `connector=LK_ACADEMY_WEB_MESSENGER`
  - env: `SUPPORT_API_BASE_URL`, `SUPPORT_INTEGRATION_TOKEN`

Рекомендованный порядок запуска:

1. Импортировать оба flow в Node-RED.
2. Задать env-переменные.
3. Прогнать тестовые payload в оба webhook path.
4. Проверить в backend:
   - `GET /api/support/connectors`
   - `GET /api/support/outbox/pull?connector=MAX_ACADEMY_BOT`

## Клиентский скачиваемый скрипт

Скрипт для сайта клиента лежит в репозитории:

- `client-sdk/phab-client-messenger.js`

Сервер отдает его через:

- `GET /api/client-script/messenger-widget.js` (вставка через `<script src=...>`)
- `GET /api/client-script/messenger-widget.download.js` (скачивание файла)
- `GET /api/client-script/messenger-push-sw.js` (service worker для web push)

Пример подключения на сайт:

```html
<script src="https://YOUR_DOMAIN/api/client-script/messenger-widget.js"></script>
<script>
  window.PHABMessengerWidget.init({
    apiBaseUrl: "https://YOUR_DOMAIN/api",
    connectorRoute: "LK_WEB_MESSENGER",
    clientId: "client-12345",
    pollIntervalMs: 5000,
    enableWebPush: true,
    // webPushServiceWorkerUrl: "/api/client-script/messenger-push-sw.js",
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
- создает диалог с коннектором из `connectorRoute` (по умолчанию `LK_WEB_MESSENGER`)
- отправляет и получает сообщения и фото
- сохраняет сессию диалога в `localStorage`
- регистрирует `service worker` и подписывает устройство на web push (если поддерживается браузером/доменом)

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
    stationIds: ["station-msk-1"],
    connectorRoutes: ["MAX_ACADEMY_BOT", "LK_ACADEMY_WEB_MESSENGER", "PROMO_WEB_MESSENGER"]
  });
</script>
```

Пример PROMO-чата для Zero Block Tilda:

```html
<script src="https://YOUR_DOMAIN/api/client-script/messenger-widget.js"></script>
<script>
  window.PHABMessengerWidget.init({
    apiBaseUrl: "https://YOUR_DOMAIN/api",
    connectorRoute: "PROMO_WEB_MESSENGER",
    clientId: "promo-client-" + Math.random().toString(36).slice(2, 10),
    title: "PROMO",
    launcherText: "Написать",
    stations: [{ id: "promo", name: "PROMO" }]
  });
</script>
```

Если нужно быстро проверить UI локально без Tilda, открывайте:

- `GET /api/ui/admin`
- если включена auth-защита (`ADMIN_AUTH_ENABLED=true`): сначала `GET /api/ui/admin/login`

Эта страница автоматически подключает `admin-panel.js` и монтирует интерфейс.
