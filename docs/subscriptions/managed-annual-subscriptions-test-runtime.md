# Управляемая годовая подписка — изолированный test runtime

## Назначение

Этот срез позволяет проверить цепочку `ЦУП → тестовый оффер → резерв партии → fake-оплата` до подключения Viva и настоящего эквайринга.

Контур имеет явные ограничения:

- работает только при `SUBSCRIPTIONS_TEST_RUNTIME_ENABLED=true`;
- не публикует и не изменяет `DRAFT`-тип, версию правил или программу выпуска;
- не вызывает Viva, ЛК, Node-RED или платёжного провайдера;
- не списывает деньги и не выпускает клиентский экземпляр подписки;
- принимает только `clientRef` с префиксом `synthetic:`;
- хранит только HMAC-SHA-256 идентификатора тестера с отдельным test pepper, исходный `clientRef` не сохраняется;
- storefront token хранится только как hash и показывается оператору один раз.

Поэтому статус `PAID` означает только результат fake-сценария. Он не является доказательством оплаты, выдачи `clientSubscriptionId` или активации подписки.

## Включение

Нужны отдельная локальная/тестовая MongoDB и оба флага:

```text
SUBSCRIPTIONS_ADMIN_ENABLED=true
SUBSCRIPTIONS_TEST_RUNTIME_ENABLED=true
SUBSCRIPTIONS_MONGODB_URI=mongodb://...
SUBSCRIPTIONS_MONGODB_DB=<отдельная тестовая база>
SUBSCRIPTIONS_TEST_HASH_PEPPER=<отдельное значение не короче 32 символов>
```

Для read-only расчёта точной цены выбранного слота или игры в обычном `lk_dev`
тестовый backend принимает только идентификаторы браузера и сопоставляет их с
явным серверным каталогом:

```env
SUBSCRIPTIONS_TEST_USAGE_EXACT_TARGETS_JSON=[{"targetKind":"NEW_GAME","slotId":"...","stationId":"...","roomId":"...","masterServiceId":"...","subServiceIds":["..."],"startsAt":"2026-08-31T18:00:00.000Z","durationMinutes":90,"courtPriceMinor":900000},{"targetKind":"GAME_AGGREGATE","gameId":"pay_...","stationId":"...","startsAt":"2026-08-31T18:00:00.000Z","durationMinutes":120,"courtPriceMinor":1200000}]
```

- endpoint: `POST /v1/subscription-test/offers/:offerId/usage-scenarios/resolved-quote`;
- token передаётся только в `X-Subscription-Test-Token`;
- цена приходит только из серверного каталога, делится на четыре равные доли и
  обязана делиться на четыре без округления;
- неизвестный слот, игра, лишнее поле браузера, несовпадение станции или неверная
  конфигурация завершаются fail-closed;
- endpoint не создаёт резерв, игру, платёж или запись Viva и возвращает
  `providerCalls: 0`.

Флаг test runtime по умолчанию выключен. Не направлять его в production MongoDB для ручного UI-прогона.

Если `SUBSCRIPTIONS_AUTO_CREATE_INDEXES=false`, до включения runtime нужен отдельный reviewed gate:

```bash
npm run subscriptions:indexes:check
SUBSCRIPTIONS_INDEX_APPLY=CONFIRM npm run subscriptions:indexes:apply
npm run subscriptions:indexes:check
```

Test-runtime индексы входят в план только при `SUBSCRIPTIONS_TEST_RUNTIME_ENABLED=true`. Apply выполняет duplicate precheck перед созданием unique indexes. URI и пароль не передавать в командной строке production-хоста.

## Административный сценарий

1. Открыть вкладку «Подписки» в ЦУП.
2. В карточке программы нажать «Проверить готовность».
3. Убедиться, что реальная публикация заблокирована для `UNVERIFIED` Viva mapping, а test activation разрешена.
4. Нажать «Создать тестовую ссылку».
5. Сохранить или сразу открыть ссылку: секретный token повторно не раскрывается.

Тестовая активация создаёт отдельный immutable snapshot версии правил и фаз программы. Исходные DRAFT-документы остаются без изменений.

## API

При глобальном префиксе `/api`:

- `GET /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions`
- `POST /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions/:version/impact-preview`
- `POST /api/v1/admin/subscription-release-programs/:releaseProgramId/test-activate`
- `GET /api/v1/admin/subscription-release-programs/:releaseProgramId/test-inventory`
- `GET /api/v1/subscription-test/offers/:offerId`
- `POST /api/v1/subscription-test/offers/:offerId/reservations`
- `GET /api/v1/subscription-test/purchases/:purchaseId`
- `POST /api/v1/subscription-test/purchases/:purchaseId/fake-confirm`
- `GET /api/ui/subscription-test#offerId=<offerId>&token=<accessToken>`

Storefront token передаётся странице только во fragment, а API получает его в `X-Subscription-Test-Token`; path, query и body токен не содержат. Командные POST требуют `Idempotency-Key` и `X-Correlation-Id`. Повтор того же intent возвращает один business result; другой payload с тем же ключом отклоняется.

## Состояния и инварианты

Внутренняя saga резерва и покупка проходят:

```text
CREATING → PAYMENT_PENDING
CREATING → EXPIRED
PAYMENT_PENDING → PAID
PAYMENT_PENDING → FAILED
PAYMENT_PENDING → EXPIRED
PAYMENT_PENDING → PAYMENT_PENDING
```

- резерв атомарно переводит одну единицу из `available` в `reserved`;
- `PAID` атомарно переводит её из `reserved` в `sold`;
- `FAILED` возвращает её в `available`;
- повторный confirm не меняет счётчики второй раз;
- фаза `PREVIOUS_SOLD_OUT` становится доступной только после исчерпания предыдущей фазы;
- `available`, `reserved` и `sold` не могут стать отрицательными;
- цена покупки навсегда фиксируется в `priceSnapshot` в minor units.

Просроченные `CREATING` и `PAYMENT_PENDING` fake-резервы освобождаются идемпотентным sweep при следующем чтении оффера/покупки. Это компенсирует и падение процесса после inventory CAS, но до создания reservation-документа. Отдельный terminal reconciliation завершает inventory, если процесс упал после смены purchase status на `PAID/FAILED/EXPIRED`. Фоновый scheduler в этот срез не входит: без нового запроса освобождение не гарантируется точно в момент TTL.

## Приёмочные тесты

Автоматическая проверка fake-E2E, безопасности UI и Mongo CAS:

```bash
npm run test:subscriptions-runtime
```

Mongo-тест по умолчанию использует `mongodb://127.0.0.1:27029` и создаёт только уникальную базу `phab_subscriptions_runtime_test_<pid>_<time>`, которую удаляет в `finally`. Другой отдельный test URI можно задать через `SUBSCRIPTIONS_TEST_MONGODB_URI`.

### Тестер A — основной путь

1. Активировать программу с первой фазой `50 × 19 800 ₽`.
2. Открыть выданную ссылку и проверить маркировку `FAKE PAYMENT · TEST ONLY`.
3. Убедиться, что показаны цена `19 800 ₽`, `available=50`, `reserved=0`, `sold=0`.
4. Использовать synthetic tester `+79104303190` и создать резерв.
5. Проверить `PAYMENT_PENDING`, snapshot `1 980 000 RUB`, затем `available=49`, `reserved=1`.
6. Нажать `Fake PAID`; проверить `reserved=0`, `sold=1`, повторный `Fake PAID` не меняет счётчики.

### Тестер B — отказ и возврат резерва

1. Создать второй резерв с другим synthetic ID.
2. Нажать `Fake FAILED`.
3. Проверить возврат единицы в `available`, отсутствие роста `sold`.
4. Повторить `FAILED` с тем же idempotency key; counters не меняются.

### Тестер C — границы партии и гонки

1. На отдельном fixture создать фазу quantity `1`, следующую — `1`, activation `PREVIOUS_SOLD_OUT`.
2. Отправить не менее 20 параллельных reserve-запросов на последнее место.
3. Ровно один запрос должен получить `PAYMENT_PENDING`; остальные — sold-out/conflict, отрицательных counters нет.
4. Подтвердить победителя как `PAID`; следующая фаза становится текущей с новой ценой.
5. Повторить confirm параллельно; `sold` увеличивается только один раз.

### Негативные и безопасностные проверки

1. При выключенном flag все test routes и storefront недоступны.
2. Неверный token не раскрывает оффер, inventory или purchase.
3. Admin routes соблюдают `subscriptions:read` и `subscriptions:release:write` со station scope.
4. В MongoDB отсутствуют исходный телефон/`clientRef` и plaintext storefront token.
5. Public API path/query/body не содержат token; он передаётся только в `X-Subscription-Test-Token`.
6. Fault injection после inventory CAS оставляет восстанавливаемый `CREATING`; после TTL sweep счётчики и client claim освобождены ровно один раз.
7. Network/log audit не содержит Viva, payment, LK или Node-RED вызовов.
8. `impact-preview` проверяет выбранный `releaseProgramId`, не снимает реальные blockers и не изменяет документы.
9. Два запроса с одним idempotency key и разным payload дают conflict.

## Что ещё не тестируется этим срезом

- настоящая покупка и возврат денег;
- выдача и authoritative read-back `clientSubscriptionId`;
- исходный баланс `270` посещений;
- запись со скидкой и entitlement ledger;
- ограничения `3 active`, окно `4 дня`, daily limit и длительности в ЛК;
- create/join/cancel/delete/leave/attendance/no-show/restore в Viva.

Эти сценарии требуют следующих slices: instance/ledger, eligibility engine и затем Viva adapter только по подтверждённому Golden HAR/sandbox контракту.

## Recovery

1. Установить `SUBSCRIPTIONS_TEST_RUNTIME_ENABLED=false` и перезапустить тестовый API.
2. Зафиксировать `offerId`, `purchaseId`, correlation IDs и снимок counters.
3. Не удалять коллекции автоматически: они изолированы и нужны для разбора инвариантов.
4. Исправление данных выполнять только отдельным reviewed repair с dry-run и read-back.
