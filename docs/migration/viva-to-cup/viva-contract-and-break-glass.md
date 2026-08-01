# Viva contract gate и break-glass

## 1. Contract gate

До начала этапа 1 Viva должна предоставить и совместно проверить следующий пакет.

### API

- Официальная versioned OpenAPI/другая машиночитаемая спецификация для production и sandbox.
- Перечень поддерживаемых endpoints для client/family, catalog/resources, schedule, booking, waitlist, attendance, orders, payments, refunds, receipts, subscriptions/contracts и reports.
- Стабильные IDs, enum semantics, pagination, filtering, sorting, timezone, currency/minor units, null/deleted behavior.
- Правила optimistic concurrency и idempotency для каждой mutating operation.
- Error model с retryable/non-retryable, rate-limit headers, timeout и maintenance behavior.
- Changelog, versioning/deprecation policy и минимальный срок уведомления о breaking change.
- Отдельные credentials/scopes для sandbox, stage и production.
- Машинная сервисная авторизация. Static bearer и password grant из текущей совместимости должны быть заменены на согласованный non-human flow с rotation и least privilege.

### Full export и delta

- Полный export всех P0-сущностей в документированном формате.
- Referential order, schema version, generated_at, source timezone и checksum.
- Tombstones/merged records и история статусов, а не только текущее состояние.
- Incremental export по immutable cursor/watermark с повторным чтением диапазона.
- Гарантия retention и окно, в котором late updates могут приехать после watermark.
- Отдельные контрольные итоги по count и денежным суммам.
- Безопасный способ доставки и удаления export; запрет передачи через личную почту/мессенджер.

### Webhooks/events

- Event catalog, schema version и примеры payload без персональных данных.
- Уникальный `event_id`, `aggregate_id`, `aggregate_version`, `occurred_at`, `tenant/station`, correlation/causation IDs.
- Подпись (например, HMAC с timestamp), replay window и rotation secret.
- Delivery semantics, порядок, retry/backoff, максимальный срок доставки и DLQ/replay API.
- События create/update/cancel/delete/merge и финансовые terminal states.
- Возможность повторно запросить aggregate по ID после события.

### Эксплуатация и право

- Rate limits и согласованная нагрузка bulk/shadow sync.
- Support/escalation channel, severity и SLA.
- Data processing/retention/exit clauses и право получить финальный export после прекращения договора.
- Sandbox с тестовыми платежами, возвратами, receipt и webhook replay.
- Назначенные технический и договорной владельцы с обеих сторон.

## 2. Критерии принятия contract

Contract получает `APPROVED`, только если Engineering и Viva совместно доказали:

1. Full export загружается повторяемо и проходит schema validation.
2. Два delta-export подряд дают monotonic watermark и включают update/delete/merge.
3. Минимум один create/update/cancel по booking и один payment/refund проходят sandbox end-to-end.
4. Duplicate webhook не создаёт второй эффект; out-of-order webhook корректно отклоняется или reconciles.
5. Rate limit и outage воспроизведены; backoff/circuit breaker не теряют команды.
6. Полученные counts/sums сходятся с контрольным отчётом Viva.
7. Breaking-change notification и deprecation window закреплены письменно.

Если хотя бы один P0-домен доступен только через UI, HTML, HAR reverse engineering или личную сессию, решение для него — `NO-GO` либо явная замена бизнес-процесса. UI-скрейпинг не является временным migration adapter.

## 3. Реестр поставщика

| Deliverable | Формат | Viva owner | CUP owner | Срок | Evidence | Status |
|---|---|---|---|---|---|---|
| API specification | Versioned OpenAPI | `TBD` | Engineering | Неделя 1 | защищённая ссылка + checksum | `REQUESTED` |
| Event catalog | JSON Schema/AsyncAPI | `TBD` | Engineering | Неделя 1 | test webhook | `REQUESTED` |
| Full export | Documented archive | `TBD` | Data | Неделя 1 | manifest/checksum | `REQUESTED` |
| Delta export | Cursor/watermark API | `TBD` | Data | Неделя 2 | two-run proof | `REQUESTED` |
| Sandbox | Tenant + service credentials | `TBD` | Security | Неделя 1 | access record | `REQUESTED` |
| Limits/SLA/change policy | Contract annex | `TBD` | Product/Legal | Неделя 2 | signed annex | `REQUESTED` |
| Final exit export | Contract clause | `TBD` | Legal/Data | Неделя 2 | signed annex | `REQUESTED` |

## 4. Break-glass policy

### Нормальный режим

- Сотрудник работает только в ЦУП.
- Обычные Viva-аккаунты отключены либо лишены прямых прав на P0-изменения.
- Интеграция использует отдельные service principals с узкими scopes; сотрудники не знают их секреты.
- Read-only доступ для расследований также выдаётся по роли, а не через общий аккаунт.
- Ограничение должно действовать в Viva IAM/SSO, а не только скрывать ссылку в ЦУП.

Текущий `ph-ab` содержит RBAC и admin audit ЦУП, но не доказывает возможность отозвать или ограничить аккаунты на стороне Viva. Это отдельный P0 deliverable Security + Viva.

### Допустимые причины аварийного доступа

1. ЦУП недоступен, а остановка операций станции превышает согласованный RTO.
2. Подтверждённое расхождение P0-данных требует действия, которого ещё нет в repair tooling.
3. Инцидент безопасности/финансовая сверка требует оригинального audit/evidence Viva.

Обучение, удобство, отсутствие функции вне согласованного scope или желание «проверить руками» не являются аварийной причиной.

### Выдача

1. Создать incident/ticket: severity, station, домен, требуемое действие, период, stable IDs.
2. Получить одобрение incident commander и второго владельца: Security для доступа, Finance для денег, Operations для booking/schedule.
3. Выдать персональную роль с MFA и минимальным scope на 60 минут. Продление — новое одобрение; максимум 4 часа только для активного P0 incident.
4. Зафиксировать session/request ID в ЦУП audit и включить доступное журналирование Viva/SSO.
5. Выполнить только перечисленные действия. Локальные выгрузки и массовый export запрещены без отдельного Data/Security approval.
6. Для каждого изменения записать Viva entity ID, before/after, причину и связанный canonical aggregate.

### Закрытие

1. Автоматически отозвать временную роль и сессию по TTL.
2. Запустить reconciliation по затронутым IDs и watermark.
3. Внести изменение в ЦУП через штатную repair/compensation command; прямая правка БД запрещена.
4. Проверить payments/ledger/receipt отдельно, если затронуты деньги.
5. Приложить audit evidence, причину и итог в incident.
6. В течение одного рабочего дня провести review: почему понадобился Viva, какую функцию/repair tool добавить, можно ли сузить доступ.

### Авария без доступного approver

Допускается заранее созданная sealed emergency role с hardware MFA у on-call Security. Использование автоматически создаёт P0 alert, уведомляет двух владельцев и требует retrospective approval в течение 4 часов. Общие пароли и постоянно активные «резервные» администраторы запрещены.

## 5. Break-glass drill acceptance

Учебный инцидент считается успешным, если доказаны:

- выдача персонального доступа с MFA и station/domain scope;
- автоматический TTL/revoke;
- Viva/SSO и ЦУП audit связываются одним incident/correlation ID;
- тестовое изменение обнаруживается reconciliation;
- repair возвращает canonical состояние без dual-write и ручной DB-правки;
- обычный сотрудник после drill не может войти или изменить P0-данные в Viva;
- секреты и PII отсутствуют в ticket, логах и записи экрана.

## 6. Решение GO/NO-GO

`GO` запрещён при любом условии:

- не назначен Viva contract owner;
- нет полного export или tombstones/delta;
- mutating API зависит от password grant, личной сессии или недокументированного endpoint;
- payment/refund/receipt нельзя сверить с provider statement;
- P0 aggregate имеет двух writers или owner `UNDECIDED`;
- штатный прямой доступ сотрудников к Viva остаётся открыт;
- break-glass drill не пройден.
