# Canonical data model и ownership matrix

Статус: проект для discovery и подписания. Это не утверждение, что все перечисленные сущности уже реализованы в текущем `ph-ab`.

## Непереговорные правила

1. У агрегата в каждый момент ровно один canonical writer.
2. Dual-write одного бизнес-факта из request path запрещён. Вторичные системы обновляются событием/outbox и считаются projection.
3. Каждый импортированный объект хранит `external_system`, `external_id`, `external_version` (если есть), `source_updated_at`, `imported_at` и `watermark`.
4. Команды имеют `idempotency_key`, `actor`, `tenant_id`, `station_id`, `correlation_id` и ожидаемую версию агрегата.
5. Деньги и entitlement изменяются append-only ledger entries; вычисляемый balance не является самостоятельной бизнес-истиной.
6. Удаление или исправление финансового/операционного факта выполняется компенсирующей записью, не переписыванием истории.
7. Node-RED, Viva adapter, UI и отчёты не владеют бизнес-истиной.
8. Сырые payload внешних систем допускаются только как ограниченный по сроку encrypted evidence, а не как canonical model.

## Базовые идентификаторы

Все canonical ID — внутренние UUID ЦУП. Телефон, email, Viva ID, booking ID провайдера и номер договора — атрибуты/aliases, а не primary key.

Обязательные корневые сущности:

- `Tenant`, `Station`, `Resource` (court/room), `Service`, `StaffMember`, `RoleAssignment`;
- `Client`, `ClientIdentity`, `FamilyRelation`, `Consent`;
- `ScheduleRule`, `Slot`, `Booking`, `WaitlistEntry`, `Attendance`;
- `Offer`, `PriceRule`, `Order`, `OrderLine`, `Payment`, `Refund`, `Receipt`;
- `SubscriptionContract`, `Entitlement`, `LedgerAccount`, `LedgerEntry`;
- `Game`, `Tournament`, `Registration`, `RatingEvent`, `PlayerRatingState`;
- `SupportCase`, `Conversation`, `Message`, `Notification`;
- `IntegrationLink`, `OutboxEvent`, `ReconciliationRun`, `AuditEvent`, `ExportSnapshot`.

## Границы агрегатов

| Aggregate | Root | Инвариант |
|---|---|---|
| Client | `Client` | Identity alias принадлежит не более чем одному активному клиенту в tenant |
| Booking | `Booking` | Один ресурс/слот не превышает capacity; lifecycle versioned |
| Waitlist | `WaitlistEntry` + очередь slot/service | Promotion атомарно резервирует capacity только одному кандидату |
| Order | `Order` | Итог равен строкам/скидкам/налогам; подтверждение оплаты отдельно от intent |
| Payment | `Payment` | Provider transaction и idempotency key уникальны; capture не дублируется |
| Subscription | `SubscriptionContract` | Статусы и периоды следуют утверждённому lifecycle |
| Ledger | `LedgerAccount` | Balance равен сумме immutable entries; reserve/capture/release связаны |
| Tournament | `Tournament` | Registration, capacity, waitlist и payment state согласованы версией |
| Rating | `PlayerRatingState` | State воспроизводится из `RatingEvent`; Viva только projection |
| Support | `SupportCase` | Видимость и действия ограничены tenant/station/role |

## Ownership matrix

Состояния миграции: `VIVA_CANONICAL`, `CUP_CANONICAL`, `SHADOW_READ`, `PROJECTION_TO_VIVA`, `ARCHIVE_READ_ONLY`, `UNDECIDED`.

| Домен/aggregate | Текущее наблюдение | Current writer | Target writer | Переходное правило | Статус решения |
|---|---|---|---|---|---|
| Сотрудники ЦУП, роли, admin audit | Mongo `admin_users/admin_roles/admin_audit_log` | ЦУП | Identity/ЦУП | Viva staff IAM инвентаризировать отдельно | `DRAFT_CUP_CANONICAL` |
| Клиент и family/consent | ЦУП использует Viva profile/client lookup; полной canonical модели здесь нет | Viva, подтвердить | ЦУП | Сначала shadow import + dedupe; команды остаются в Viva до cutover | `UNDECIDED` |
| Станции, корты, услуги, тренеры | Часть читается из Viva widgets/config; единого каталога не доказано | Viva, подтвердить | ЦУП | Версионированный catalog import, затем отдельный cutover | `UNDECIDED` |
| Расписание и capacity | Viva exercises используются как upstream | Viva, подтвердить | ЦУП | Shadow calendar + reconciliation; запрет dual booking writer | `UNDECIDED` |
| Booking | Код создаёт Viva booking и локальные tournament registrations | По типу booking | ЦУП | Разделить booking namespaces; cutover по service/station | `UNDECIDED` |
| Waitlist | Реализован для custom tournaments; общий Viva waitlist неизвестен | Split | ЦУП | Не объединять до описания порядка и promotion semantics | `UNDECIDED` |
| Attendance/check-in | В checkout не доказан | Viva, подтвердить | ЦУП | Импорт истории; новый writer после E2E прохода | `UNDECIDED` |
| Offers/prices/discounts | Viva products используются в оплате турниров | Viva, подтвердить | ЦУП Commerce | Price snapshot обязателен на OrderLine | `UNDECIDED` |
| Order/payment/refund/receipt | Есть Viva transaction integration; полного refund/fiscal ledger нет | Viva/provider, подтвердить | ЦУП + внешний PSP/ОФД | Provider webhook + reconciliation; Viva не writer денег после cutover | `UNDECIDED` |
| Subscription/entitlement/ledger | Viva contracts/products используются; canonical ledger не доказан | Viva, подтвердить | ЦУП | Reserve/capture/release; отдельное архитектурное решение | `UNDECIDED` |
| Игры | Источник `LK_PADELHUB(_MONGO)`, ЦУП меняет отдельные metadata/publication действия | Split LK/ЦУП | ЦУП platform | Составить field-level ownership до переноса writer | `UNDECIDED` |
| Custom tournaments | `custom_tournaments` и editor находятся в ЦУП; Viva может быть source/link/status projection | ЦУП для custom | ЦУП | Viva source ID остаётся link; не считать Viva копию canonical | `DRAFT_CUP_CANONICAL` |
| Player rating | В типах явно `CUP_CANONICAL`, event/state/outbox, Viva projection | ЦУП | ЦУП | Продолжить `PROJECTION_TO_VIVA` до отключения consumer | `FACT_REPO` |
| Communities/content | Реализовано в ЦУП | ЦУП | ЦУП | Проверить внешние публикации и retention | `DRAFT_CUP_CANONICAL` |
| Support/conversations | Mongo persistence/outbox и adapters в ЦУП | ЦУП | ЦУП | Viva notification — входное событие, не owner case | `DRAFT_CUP_CANONICAL` |
| Notifications | Web push/Telegram/MAX/Node-RED adapters; общая canonical команда не доказана | Split | ЦУП | Outbox command + provider delivery projection | `UNDECIDED` |
| Advertising | Settings/assets в ЦУП | ЦУП | ЦУП | Проверить owner публикации в LK/Home | `DRAFT_CUP_CANONICAL` |
| Operational reports | Есть games/support analytics; Viva reports неизвестны | Split | ЦУП projections | Отчёт строится только из canonical events + reconciliation | `UNDECIDED` |
| Integration settings/secrets | `integration_settings` содержит Viva config | ЦУП config | Secret manager + ЦУП metadata | Секреты вынести; UI не возвращает credential | `DECISION_REQUIRED` |

`DRAFT_CUP_CANONICAL` означает архитектурное предложение, основанное на checkout, а не подписанный production ownership.

## Field-level mapping template

Для каждого P0 aggregate заполнить таблицу:

| Поле | Canonical type | Required | Current Viva path | Transform | Identity/enum mapping | Null policy | Owner | Evidence |
|---|---|---|---|---|---|---|---|---|
| `id` | UUID | да | Viva external ID | создать внутренний UUID | `IntegrationLink` | never null | ЦУП | `TBD` |
| `version` | bigint | да | vendor version/updatedAt | monotonic mapping | watermark | never null | ЦУП | `TBD` |

Нельзя начинать bulk migration, пока не описаны enum semantics, timezone, currency minor units, deleted/tombstone, merge rules, unknown/null и late-arriving updates.

## Cutover state machine на aggregate

1. `DISCOVERED`: контракт и mapping описаны.
2. `BASELINE_EXPORTED`: полный export профилирован, checksums/counts сохранены.
3. `SHADOW_SYNC`: ЦУП читает/import, но не исполняет команды.
4. `RECONCILED`: counts, sums, hashes и sample records сходятся в установленном допуске.
5. `CUP_WRITE_ENABLED`: ЦУП — единственный writer выбранной station/service boundary.
6. `VIVA_READ_ONLY`: запись в Viva закрыта, кроме break-glass.
7. `ARCHIVED`: финальный export, retention/legal hold и доступ только для чтения.

Откат из шага 5 не означает возвращение dual-write. Он переключает маршрутизацию команд обратно одному writer и выполняет reconciliation по watermark.

## Минимальные reconciliation метрики

- количество сущностей по tenant/station/status/date;
- количество активных booking и waitlist позиций;
- сумма order/payment/refund/receipt в minor units по валюте и дню;
- сумма ledger entries и вычисленный balance по account;
- orphan external IDs, duplicate identities, missing tombstones;
- max source watermark и projection lag;
- payload/schema rejects, DLQ, retry age;
- выборочная сверка P0-сценариев по stable IDs.
