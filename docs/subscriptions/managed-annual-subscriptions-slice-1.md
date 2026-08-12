# Управляемая годовая подписка — первый DRAFT-срез

## Результат среза

ЦУП и ph-ab получают закрытый feature-флагом контур для создания:

1. типа подписки в состоянии `DRAFT`;
2. неизменяемой версии правил в состоянии `DRAFT`;
3. программы выпуска с одной или несколькими ценовыми фазами в состоянии `DRAFT`.

Срез не публикует подписку, не продаёт её, не резервирует остаток, не вызывает Viva, ЛК, Node-RED или платёжного провайдера и не изменяет действующие подписки.

## Управляемые правила

- Срок действия (`365` дней по умолчанию).
- Применение правил: только новые либо действующие и новые. В DRAFT это только намерение; фактического применения нет.
- Создание игр: включение/отключение и длительности `60/90/120` минут.
- Присоединение к играм: включение/отключение и диапазон `60..120` минут.
- Максимум активных услуг (`3` по умолчанию).
- Окно записи: `3`, `4` или `5` дней в UI; API допускает `1..31`.
- Дневной лимит использований (`1` по умолчанию).
- Кандидат на списание единиц для `60/90/120` минут. Это не считается Viva truth до отдельной HAR-проверки.
- Подключаемые льготы для `GAME`, `GROUP_TRAINING`, `TOURNAMENT`: тип льготы, точные event type IDs и station IDs.
- Ценовые фазы: партия целиком, ежедневная выдача либо ручная выдача; ручная, плановая или зависящая от распродажи предыдущей фазы активация.

`maxActiveServices=0` и `dailyUsageLimit=0` означают «использование запрещено», а не «без лимита».

## API

При глобальном префиксе Nest `/api` реализованы только:

- `GET /api/v1/admin/subscription-types`
- `POST /api/v1/admin/subscription-types`
- `POST /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions`
- `GET /api/v1/admin/subscription-release-programs`
- `POST /api/v1/admin/subscription-release-programs`

Все POST требуют `Idempotency-Key` (16–128 символов) и `X-Correlation-Id` (8–128 символов). Повтор с тем же actor/key и тем же нормализованным payload возвращает созданный ресурс. Повтор с другим payload возвращает `409 IDEMPOTENCY_CONFLICT`.

ЦУП сохраняет command headers вместе с текущим содержимым формы: сетевой повтор использует тот же ключ, а изменение любого поля создаёт новый intent. Успешные ответы возвращают `X-Correlation-Id`, replay — также `Idempotency-Replayed: true`. Ошибки пяти маршрутов имеют единый envelope `error.code/message/correlationId/retryable`; внутренний domain code при необходимости находится в `error.details.domainCode`.

## RBAC

- `subscriptions:read` — чтение каталога и программ в разрешённых станциях.
- `subscriptions:catalog:write` — создание глобальных типов и правил; требуется scope `null` («все станции»).
- `subscriptions:release:write` — создание программы только для exact station ID из scope.

Новые права не добавлены ни в одну стандартную роль. `SUPER_ADMIN` сохраняет доступ через существующий wildcard `*`. Назначение прав управляющим должно быть отдельным осознанным решением.

## Включение локального контура

Нужны переменные:

```text
SUBSCRIPTIONS_ADMIN_ENABLED=true
SUBSCRIPTIONS_MONGODB_URI=mongodb://...
SUBSCRIPTIONS_MONGODB_DB=<явное имя отдельной базы или согласованной control-plane DB>
```

В production `SUBSCRIPTIONS_AUTO_CREATE_INDEXES` по умолчанию выключен. Сначала выполняются backup/precheck, затем отдельно одобренное создание индексов:

```bash
npm run subscriptions:indexes:check
SUBSCRIPTIONS_INDEX_APPLY=CONFIRM npm run subscriptions:indexes:apply
npm run subscriptions:indexes:check
```

Не передавать URI/пароли в командной строке и не сохранять их в репозитории.

## Хранилище

Аддитивные коллекции schema v1:

- `subscription_types`
- `subscription_policy_versions`
- `subscription_release_programs`

Idempotency-метаданные сохраняются внутри созданного документа. В DRAFT release program не хранится изменяемый inventory: API материализует нулевые `available/reserved/sold/refunded`, а `nextReleaseAt` равен `null`.

## Детальный приёмочный прогон

### Тестер A — SUPER_ADMIN, основной happy path

1. Открыть ЦУП с `SUBSCRIPTIONS_ADMIN_ENABLED=true`; вкладка «Подписки» видима.
2. Создать тип `annual-kotelniki-2026`; проверить `DRAFT`, `revision=1`, `currentPolicyVersion=null`.
3. Повторить тот же POST с теми же заголовками и payload; ID не меняется, в БД одна запись.
4. Повторить ключ с изменённым названием; получить `409 IDEMPOTENCY_CONFLICT`.
5. Создать годовые правила: `365`, создание `60/90/120`, присоединение `60..120`, активных услуг `3`, окно `4`, лимит в день `1`.
6. Убедиться, что скидка на игру выключена и `benefitRules=[]`.
7. Создать вторую версию с окном `5`; получить версии `1` и `2`, первая не изменена.
8. Создать лестницу: `50 × 19 800`, `50 × 23 800`, `50 × 36 000`, `50 × 48 000` рублей.
9. Проверить minor units: `1 980 000`, `2 380 000`, `3 600 000`, `4 800 000`; все counters нулевые.
10. Создать отдельную фазу `100` единиц, `7` в день, `09:00 Europe/Moscow`; она остаётся DRAFT и ничего не выкладывает.

### Тестер B — оператор одной станции

1. Выдать тестовой роли только `subscriptions:read` и `subscriptions:release:write` со scope `[station-a]`.
2. Каталог читается; создание типа/версии правил возвращает `403`.
3. Программа для `station-a` создаётся.
4. Программа для `station-b` возвращает `403` и не появляется в БД.
5. Общий список содержит только `station-a`; явный `?stationId=station-b` возвращает `403`.

### Тестер C — read-only и негативные проверки

1. С `subscriptions:read` формы создания заблокированы; GET работает.
2. Без permission получить `403`; без auth — `401` при обязательной token-auth конфигурации.
3. Проверить ошибки: дублированный code, пустые durations при включённом create, `min>max`, невалидная timezone, разрыв order фаз, daily quantity больше total.
4. `providerProductRef` должен вернуть `422 PROVIDER_EVIDENCE_REQUIRED`.
5. Первая фаза с `PREVIOUS_SOLD_OUT`, schedule без даты и manual mode с не-manual activation должны вернуть `422`.
6. После каждого отказа выполнить read-back: число документов не изменилось.

### Регрессия и границы

1. `npm run test:subscriptions`.
2. `npm run test:auth-rbac`.
3. `npm run build`; обе копии admin panel должны совпадать с source-файлом.
4. Старые `/api/admin/*`, UI игр, турниров, диалогов, рекламы и настроек работают без изменения контрактов.
5. В сетевом журнале при всех пяти операциях отсутствуют обращения к Viva, LK, Node-RED, payment endpoints.
6. Не существует обработчиков publish/activate/purchase/refund/reconcile; соответствующие пути дают `404`.

## Следующие отдельные срезы

1. Impact preview и публикация policy с optimistic revision.
2. Реальный inventory/reservation aggregate и ежедневный scheduler.
3. Storefront/покупка, список покупателей и LTV/read model.
4. Runtime enforcement для create/join/active services/window/daily use.
5. Льготы на запись, групповую тренировку и турнир.
6. Только после APPROVED Golden HAR: создание, присоединение, отмена, удаление, выход, списание/возврат посещения, возврат денег, снятие публикации и неоплата в Viva/LK.

## Recovery

1. Выключить `SUBSCRIPTIONS_ADMIN_ENABLED`; новые routes возвращают feature-disabled и вкладка скрывается.
2. Не удалять автоматически коллекции или индексы. DRAFT-документы не влияют на runtime и сохраняются для разбора.
3. Зафиксировать affected IDs, actor, correlation ID и результаты duplicate/invariant queries.
4. Откатить код обычным release-процессом; старое приложение игнорирует новые коллекции.
5. Исправление DRAFT-данных выполнять отдельным reviewed repair после backup и dry-run/read-back. Удаление коллекций — отдельное явно одобренное действие.
