# Персональный пропуск резидента и выдача услуг

## Статус

Контур реализован внутри существующего подписочного домена ЦУП. Он не создаёт
новый склад, платёжный механизм, отдельную базу или новую систему подписок:
используются те же MongoDB-кластер и база, что у подписочного контура, а
резидентство определяется по уже существующим `subscription_instances`,
`subscription_policy_publications` и `subscription_provider_mappings`.

Модуль выключен по умолчанию (`RESIDENT_SERVICES_ENABLED=false`). Включение —
отдельный шаг после применения индексов и выдачи прав ролям.

## Что реализовано

- Клиент создаёт персональный пропуск на срок **не более 120 секунд** и **не
  дальше подтверждённого `activeTo`** резидентства.
- QR-код содержит **только случайный токен** (`rsp1_<32 random bytes base64url>`).
  В нём нет персональных данных, идентификаторов подписки и утверждения
  «подписка активна».
- Сервер хранит только HMAC-SHA256-хеш токена. Сам токен нигде не сохраняется.
- Сотрудник ЦУП проверяет токен и подтверждает выдачу из-под своей авторизации,
  с правом и доступом к станции. Проверка (scan/preview) ничего не списывает.
- При подтверждении выдачи заново проверяются: состояние резидентства и срок,
  актуальность сведений (freshness), состояние и срок пропуска, станция
  (правила станций политики и scope сотрудника), правила услуги и лимиты.
- Использование пропуска, списание лимита и сохранение выдачи выполняются одной
  транзакцией. Повтор запроса после потери ответа возвращает тот же
  `issuanceId`, а не создаёт вторую выдачу.
- Полотенце и ракетка выдаются одной операцией. Ракетка может быть возвращаемой;
  возврат принимается даже после окончания резидентства.
- Ведётся минимальный журнал (`cup_resident_service_journal`) и аудит
  административных изменений (существующий admin audit).
- Явная настройка преимуществ: правило задаётся администратором ЦУП для типа
  подписки, услуги, станции и периода лимита. Без правила резидентство
  подтверждается, но выдача **не разрешается**.

## Чего здесь намеренно нет

- Нет складского учёта, остатков, залогов и платежей за выдачу.
- Нет автоматических правил вида «полотенце бесплатно» или «одна ракетка в
  день». Эти значения появляются только после явного создания правила.
- Нет нового типа подписки, новой коллекции подписок или второго источника
  резидентства.
- Выдача не восстанавливает израсходованный лимит при возврате: лимит
  списывается в момент выдачи. Это осознанное решение, а не настройка.

## Резидентство и свежесть

Подтверждение резидентства повторяет проверки существующего runtime-context
контура:

1. LK Bearer проверяется `LkIdentityService` (RS256, доверенный issuer, tenant,
   `clientId`).
2. Инстанс ищется по `tenantId + providerClientId + clientSubscriptionId` и
   сверяется с `clientRefHash`.
3. Политика выбирается по `purchasedAt` и полной истории публикаций; версия,
   digest и mapping должны совпадать с инстансом.
4. Provider mapping должен быть `VERIFIED`, соответствовать tenant/типу/продукту
   и быть свежим.
5. `reconciliation.state` инстанса должен быть `CURRENT`, `asOf` — в пределах
   `RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS`.
6. Инстанс должен быть `ACTIVE`, а текущее время — внутри
   `[activeFrom, activeTo)`.

Если Viva недоступна и проекция инстанса устарела, протухла или отсутствует,
создание пропуска и подтверждение выдачи возвращают `503`
(`RESIDENT_EVIDENCE_STALE` и т.п.). Автоматического разрешения при
недоступном/устаревшем источнике нет.

## Лимиты

Лимит привязан к **клиенту и услуге**, а не к конкретному пропуску или станции
выдачи. Поэтому несколько разных QR одного клиента не обходят лимит: все они
увеличивают один и тот же счётчик
`cup_resident_service_usage` по ключу
`(tenantId, clientRefHash, serviceKind, limitPeriod, periodKey)`.

Периоды (`Europe/Moscow`): `DAY`, `WEEK` (ISO), `MONTH`, `SUBSCRIPTION`
(без сброса в пределах инстанса). Лимит проверяется и увеличивается атомарно
условным `findOneAndUpdate` внутри транзакции.

## API

### Внутренний маршрут для авторизованного клиента (LK-шлюз)

```http
POST /api/internal/subscriptions/resident-passes
Authorization: Bearer <LK user token>
X-Resident-Services-Integration-Token: <server token>
Content-Type: application/json

{"clientSubscriptionId":"<exact Viva client subscription id>"}
```

Ответ (единственный раз возвращает токен):

```json
{
  "schemaVersion": 1,
  "passId": "resident_pass:<uuid>",
  "token": "rsp1_<random>",
  "issuedAt": "<ISO>",
  "expiresAt": "<ISO, <= 120s and <= activeTo>",
  "subscriptionInstanceId": "subscription_instance:...",
  "residency": {
    "subscriptionTypeId": "...",
    "subscriptionTypeTitle": "...",
    "activeFrom": "<ISO>",
    "activeTo": "<ISO>"
  }
}
```

Ответ отдаётся с `Cache-Control: no-store` и `Referrer-Policy: no-referrer`.
Клиент рисует QR из `token`; сервер не хранит токен.

### Маршруты сотрудника ЦУП

| Метод | Маршрут | Право |
| --- | --- | --- |
| POST | `/api/v1/admin/resident-services/passes/preview` | `resident-services:issue` |
| POST | `/api/v1/admin/resident-services/issuances` | `resident-services:issue` |
| POST | `/api/v1/admin/resident-services/issuances/:issuanceId/returns` | `resident-services:return` |
| GET | `/api/v1/admin/resident-services/issuances/:issuanceId` | `resident-services:read` |
| GET | `/api/v1/admin/resident-services/journal` | `resident-services:read` |
| GET | `/api/v1/admin/resident-services/benefit-rules` | `resident-services:read` |
| POST | `/api/v1/admin/resident-services/benefit-rules` | `resident-services:configure` |
| PATCH | `/api/v1/admin/resident-services/benefit-rules/:ruleId` | `resident-services:configure` |

Все обязательные мутации требуют `Idempotency-Key` (16..128 символов) и
возвращают `Idempotency-Replayed: true|false`. Все ответы — `no-store`.
Изменяющие cookie-запросы проверяют `Origin` по
`RESIDENT_SERVICES_ADMIN_ORIGINS`; Bearer-запросы проверку Origin не требуют.

### Проверка пропуска (scan/preview)

```http
POST /api/v1/admin/resident-services/passes/preview
{"token":"rsp1_...","stationId":"<station>"}
```

Возвращает подтверждённое резидентство, срок и доступность услуг на станции
(лимит, остаток, возвратность). **Ничего не списывает и не меняет.**

### Подтверждение выдачи

```http
POST /api/v1/admin/resident-services/issuances
Idempotency-Key: <16..128>
X-Correlation-Id: <optional>

{
  "token":"rsp1_...",
  "stationId":"<station>",
  "items":[
    {"serviceKind":"TOWEL","quantity":1},
    {"serviceKind":"RACKET","quantity":1}
  ]
}
```

Ответ содержит `issuanceId` (= `operationId`), состояние, станцию, срок
резидентства и по каждой позиции: возвратность, лимит, период и остаток.
Повтор с тем же `Idempotency-Key` и тем же телом возвращает тот же
`issuanceId`; другой intent под тем же ключом — `409`
`RESIDENT_SERVICES_IDEMPOTENCY_CONFLICT`.

Две параллельные выдачи по одному пропуску дают ровно одну: пропуск
переводится `ACTIVE → CONSUMED` условным CAS внутри транзакции, проигравший
получает `409 RESIDENT_PASS_ALREADY_USED`.

### Возврат

```http
POST /api/v1/admin/resident-services/issuances/:issuanceId/returns
Idempotency-Key: <16..128>

{"items":[{"serviceKind":"RACKET","quantity":1}]}
```

Возврат не проверяет резидентство и принимается после окончания подписки.
Проверяются: существование выдачи, возвратность позиции (снимок на момент
выдачи), станция выдачи и scope сотрудника. Повтор идемпотентен.

### Явная настройка преимуществ

```http
POST /api/v1/admin/resident-services/benefit-rules
Idempotency-Key: <16..128>

{
  "subscriptionTypeId":"<type>",
  "serviceKind":"RACKET",
  "stationIds":["<station>"],
  "limitPeriod":"DAY",
  "limitQuantity":1,
  "returnable":true,
  "enabled":true
}
```

`stationIds` не задан или пуст — правило действует на все станции (требуется
глобальный scope сотрудника). Правило уникально по
`(tenantId, subscriptionTypeId, serviceKind, stationScopeKey)`.
Изменение использует `expectedRevision` (409 при конфликте).

## Хранение и индексы

Используется существующая MongoDB ЦУП; имена коллекций настраиваются.

- `cup_resident_passes` — `passId`, `tenantId`, `subscriptionInstanceId`,
  `clientRefHash`, `tokenHash`, `state`, `issuedAt`, `expiresAt`,
  `consumedAt/By/StationId/OperationId`, `revision`.
- `cup_resident_benefit_rules` — правило преимущества (см. выше).
- `cup_resident_service_usage` — счётчик `(tenantId, clientRefHash, serviceKind,
  limitPeriod, periodKey)`, `used`, `revision`.
- `cup_resident_service_issuances` — операция выдачи с `idempotency.keyHash`,
  `requestHash`, снимком решения и срока резидентства.
- `cup_resident_service_returns` — операция возврата с идемпотентностью и
  снимком состояния выдачи на момент возврата.
- `cup_resident_service_journal` — append-only журнал
  `ISSUANCE_CONFIRMED` / `ITEM_RETURNED`.

TTL-индекс `resident_pass_expires_ttl` удаляет пропуски через 24 часа после
`expiresAt`; просроченный пропуск до этого момента отклоняется по времени.

Приложение не создаёт индексы в production. Проверка и применение:

```bash
npm run resident-services:indexes:check
RESIDENT_SERVICES_INDEX_APPLY=CONFIRM npm run resident-services:indexes:apply
npm run resident-services:indexes:check
```

## Права

Новые права не выдаются ролям автоматически. Суперадмин получает их через
`['*']`; остальным ролям их назначает администратор в разделе «Роли и права
доступа».

- `resident-services:read` — журнал, карточка выдачи, список правил;
- `resident-services:issue` — проверка пропуска и подтверждение выдачи;
- `resident-services:return` — приём возврата;
- `resident-services:configure` — настройка правил преимуществ.

Ограничение по станциям действует как у остальных прав: пустой список станций
означает все станции, иначе сотрудник работает только со своими станциями.

## Конфигурация

```text
RESIDENT_SERVICES_ENABLED=false
RESIDENT_SERVICES_INTEGRATION_TOKEN=          # >= 32 байт
RESIDENT_SERVICES_TOKEN_PEPPER=               # >= 32 байт
RESIDENT_SERVICES_TENANT_ID=                  # fallback: SUBSCRIPTIONS_RUNTIME_TENANT_ID
RESIDENT_SERVICES_MAX_EVIDENCE_AGE_SECONDS=   # fallback: SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS
RESIDENT_SERVICES_PASS_TTL_SECONDS=120        # 30..120
RESIDENT_SERVICES_MONGODB_URI=                # fallback: SUBSCRIPTIONS_MONGODB_URI, MONGODB_URI
RESIDENT_SERVICES_MONGODB_DB=                 # fallback: SUBSCRIPTIONS_MONGODB_DB, MONGODB_DB
RESIDENT_SERVICES_AUTO_CREATE_INDEXES=false
RESIDENT_SERVICES_PASSES_COLLECTION=cup_resident_passes
RESIDENT_SERVICES_BENEFIT_RULES_COLLECTION=cup_resident_benefit_rules
RESIDENT_SERVICES_USAGE_COLLECTION=cup_resident_service_usage
RESIDENT_SERVICES_ISSUANCES_COLLECTION=cup_resident_service_issuances
RESIDENT_SERVICES_RETURNS_COLLECTION=cup_resident_service_returns
RESIDENT_SERVICES_JOURNAL_COLLECTION=cup_resident_service_journal
RESIDENT_SERVICES_ADMIN_ORIGINS=https://padlhub.su
```

Для hashing `clientRefHash` используется существующий
`SUBSCRIPTIONS_RUNTIME_HASH_PEPPER` (>= 32 байт) — тот же, что у инстансов
подписок, иначе владение инстансом не сойдётся.

## Подключение

1. Собрать и раскатать образ обычным процессом выпуска.
2. Проверить и применить аддитивные индексы (команды выше).
3. Задать переменные окружения и включить модуль
   (`RESIDENT_SERVICES_ENABLED=true`), затем перезапустить сервис штатным
   способом.
4. Выдать `resident-services:*` нужным ролям.
5. Создать явные правила преимуществ для типов подписки, услуг и станций. Пока
   правил нет, выдача запрещена.
6. Подключить LK-шлюз к внутреннему маршруту создания пропуска.

## Проверка

```bash
npm run test:resident-services
npx tsc -p tsconfig.build.json --noEmit --incremental false
npm run build
```

Gated Mongo-проверка (только одноразовая БД, никогда production):

```bash
RESIDENT_SERVICES_TEST_MONGODB_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0' \
RESIDENT_SERVICES_TEST_MONGODB_DB=phab_resident_ci_$_<32 hex> \
npm run test:resident-services:mongo
```

## Откат

1. Выключить `RESIDENT_SERVICES_ENABLED` и вернуть предыдущий образ.
2. Коллекции и индексы аддитивны: не удалять их при откате приложения.
3. Сохранить журнал и результаты read-back для разбора. Удаление данных — только
   отдельным reviewed repair после backup и dry-run.
