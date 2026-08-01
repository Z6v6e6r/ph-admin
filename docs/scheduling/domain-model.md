# Доменная модель Scheduling Core

Статус: `DRAFT_FOR_REVIEW`

## 1. Граница домена

`Scheduling Core` владеет временным фактом события и распределением ресурсов.

Он не должен владеть:

- каноническим балансом денег;
- платёжной транзакцией провайдера;
- рейтингом игрока;
- телом сообщений;
- внешним Viva-объектом.

Эти домены связываются внутренними ID и доменными событиями.

## 2. Основные сущности

| Сущность | Назначение |
|---|---|
| `ActivityTemplate` | шаблон активности: тип, длительность, вместимость, обязательные ресурсы, базовые policy |
| `ScheduleSeries` | правило повторения, область изменений и исключения |
| `ScheduleOccurrence` | конкретное событие с точными временем и жизненным циклом |
| `Resource` | корт, зона, тренер, оборудование, доступ или составной ресурс |
| `ResourceAllocation` | атомарное занятие ресурса интервалом и ролью |
| `AvailabilityPolicySet` | версионированные правила генерации продаваемых вариантов |
| `CapacityPool` | общая, онлайн, административная или сегментная квота вместимости |
| `SlotMap` | адресуемые позиции, команды и конкретные места |
| `Participation` | участник, роль, команда/позиция, attendance и eligibility |
| `BookingCommitment` | обязательство клиента/плательщика по участию в occurrence |
| `WaitlistEntry` | кандидат, приоритет, требования и состояние предложения |
| `WaitlistOffer` | временное предложение/hold места одному или группе кандидатов |
| `PublicationTarget` | канал и состояние публикации |
| `PolicyEvaluation` | результат проверки правила на версии входных данных |
| `SeriesRevision` | неизменяемая версия правила серии и граница её действия |
| `AccessGrant` | projection права физического доступа из подтверждённого события |
| `IntegrationLink` | внешний ID, версия, watermark и состояние projection |
| `AuditEvent` | неизменяемое описание команды, причины и before/after |

`Order`, `Charge`, `Payment`, `Refund` и `LedgerEntry` принадлежат Commerce/Ledger. Scheduling хранит только их внутренние ссылки и read-модель расчётов для оператора.

## 3. Корневой агрегат

Корень расписания — `ScheduleOccurrence`.

Минимальный контракт:

```text
ScheduleOccurrence
  id
  tenantId
  stationId
  templateId?
  seriesId?
  seriesRevisionId?
  kind
  demandModel
  title
  startAt
  endAt
  timeZone
  lifecycleStatus
  capacityMode
  capacity
  version
  sourceSystem
  createdAt
  updatedAt
  cancelledAt?
```

В одной транзакционной границе с occurrence изменяются:

- обязательные `ResourceAllocation`;
- структура participant slots;
- ссылки на `BookingCommitment`;
- текущая матрица публикации;
- версия агрегата;
- audit record;
- outbox events.

Финансовое исполнение и доставка уведомлений происходят отдельными сагами. Их ошибки не откатывают уже подтверждённое занятие ресурса, но переводят соответствующую проекцию в явное проблемное состояние.

## 4. Инварианты

1. `startAt < endAt`.
2. Время хранится как instant, `timeZone` сохраняется снимком бизнес-контекста.
3. Все обязательные ресурсы резервируются атомарно.
4. Для эксклюзивного ресурса не существует двух активных allocation с пересекающимися интервалами.
5. Составной ресурс блокирует все физические дочерние ресурсы.
6. Capacity pools не создают мест сверх физического `TOTAL`.
7. Активных participation в адресуемых слотах не больше числа слотов.
8. Один слот команды не занят двумя участниками или двумя waitlist hold.
9. Один waitlist offer может создать не более одного подтверждённого commitment.
10. `COMPLETED` occurrence нельзя переносить обычной командой.
11. `CANCELLED` не удаляет allocation history, participation, деньги или audit.
12. Команда применяется только к ожидаемой `version`.
13. Повтор `idempotencyKey` возвращает прежний результат и не создаёт второй эффект.
14. Повторения с прошедшим временем не меняются новой revision серии.
15. Price snapshot оплаченного commitment не меняется schedule-командой.
16. Ручной override допустим только для разрешённых мягких конфликтов.
17. У одного external link уникальна пара `externalSystem + externalId` внутри tenant.

## 5. Многомерное состояние

### Lifecycle occurrence

`DRAFT → HOLD → CONFIRMED → IN_PROGRESS → COMPLETED`

Боковые переходы:

- `HOLD → EXPIRED`;
- `DRAFT/HOLD/CONFIRMED → CANCELLED`;
- `CANCELLED → RESTORED` только специальной компенсирующей командой, после которой создаётся новая активная ревизия.

### Payment projection

`NOT_REQUIRED | UNPAID | PARTIAL | PAID | REFUND_PENDING | PARTIALLY_REFUNDED | REFUNDED | FAILED`

### Capacity projection

`OPEN | ALMOST_FULL | FULL | WAITLIST`

### Publication

У каждого канала собственное состояние:

`DISABLED | PENDING | PUBLISHED | UNPUBLISH_PENDING | FAILED`

### Synchronization

`LOCAL_ONLY | PENDING | SYNCED | CONFLICT | FAILED | STALE`

### Attendance

Хранится на `Participation`:

`EXPECTED | CHECKED_IN | LATE | NO_SHOW | CANCELLED | SUBSTITUTED`

Ни одно из этих измерений не сворачивается в универсальное поле `status`.

## 6. Типы occurrence

Начальная типология:

- `COURT_RENTAL`;
- `PRIVATE_GAME`;
- `OPEN_GAME`;
- `GAME_WITH_COACH`;
- `PERSONAL_TRAINING`;
- `GROUP_TRAINING`;
- `PROGRAM_SESSION`;
- `TOURNAMENT`;
- `CORPORATE_EVENT`;
- `TECHNICAL_CLOSURE`;
- `BUFFER`;
- `STAFF_SHIFT`.

Тип определяет обязательные поля и policy, но не создаёт отдельный календарный движок.

`demandModel` определяет способ потребления:

- `RESOURCE_RESERVATION` — клиент выбирает ресурс и время;
- `REGISTRATION_EVENT` — клуб создаёт occurrence, клиенты занимают capacity/slots;
- `PROGRAM_SESSION` — регистрация управляется программой/курсом;
- `RESOURCE_CLOSURE` — ресурс блокируется без клиентского commitment.

## 7. Ресурсы

`Resource.kind`:

- `SPACE`;
- `STAFF`;
- `EQUIPMENT`;
- `ACCESS`;
- `VIRTUAL_CAPACITY`;
- `COMPOSITE`.

Параметры:

- station/location;
- рабочие интервалы;
- интервалы недоступности;
- вместимость;
- эксклюзивность или share policy;
- поддерживаемые виды спорта и форматы;
- буфер до/после;
- зависимости и взаимные блокировки;
- доступные price/policy scopes.

Allocation содержит:

```text
occurrenceId
resourceId
role
startAt
endAt
exclusivity
quantity
status
```

Буфер материализуется allocation-интервалом или вычисляется детерминированно тем же conflict engine. Две разные реализации проверки буфера недопустимы.

## 8. Conflict/Policy engine

Вход:

- команда и ожидаемая версия;
- proposed occurrence;
- ресурсы и соседние allocations;
- участники и entitlements;
- channel/role/station;
- versioned policy snapshot.

Дополнительные policy dimensions:

- booking horizon/opening time;
- канал и роль;
- membership/client segment/community;
- prime-time intervals;
- daily/weekly/outstanding/concurrent quotas;
- fixed/flexible start intervals;
- minimum/maximum duration;
- gap/sandwich rules и bypass window;
- online/admin capacity pools;
- guest/substitute policy;
- cancellation/no-show rules.

Выход для каждого результата:

```text
code
severity: HARD | SOFT | INFO
message
entityRefs[]
alternatives[]
overrideAllowed
requiredPermission?
policyVersion
```

Жёсткие конфликты:

- пересечение эксклюзивного ресурса;
- закрытая станция/корт;
- превышение вместимости;
- занятый тренер;
- событие вне допустимого времени;
- просроченный hold;
- отсутствие обязательного consent/entitlement;
- нарушение tenant/station scope.

Мягкие:

- непродаваемое окно;
- изменение цены;
- рекомендуемый буфер тренера;
- пограничный уровень игрока;
- высокий риск недобора;
- менее подходящий ресурс.

Альтернативы строятся на сервере и содержат точные доступные интервалы/ресурсы. Клиент не вычисляет свободное время самостоятельно.

## 8.1. Availability Engine

Availability — отдельный query-domain поверх resources, allocations и policy. Он не создаёт бронь.

Вход:

- диапазон поиска;
- activity/demand model;
- длительность или набор длительностей;
- обязательные ресурсы;
- actor/beneficiary/channel;
- membership/entitlement snapshot;
- policy version.

Выход — versioned `SellableOption` с коротким TTL. Подтверждение использует option ID и повторно проверяет ресурсы в транзакции.

Fixed rules генерируют только заданные начала. Flexible rules допускают больше начал, но применяют gap policy:

- `ALLOW`;
- `WARN`;
- `BLOCK`;
- `BLOCK_UNTIL_BYPASS_WINDOW`.

Пустой интервал без sellable option не показывается клиенту как доступность.

## 8.2. Series revisions

`ScheduleSeries` хранит identity серии, а `SeriesRevision` — правило, действующее с конкретного occurrence/date.

Mutation scope:

- `OCCURRENCE_ONLY`;
- `THIS_AND_FOLLOWING`;
- `FUTURE_SERIES`.

Price update:

- `KEEP_EXISTING`;
- `REPRICE_UNPAID`;
- `REPRICE_ALL_ALLOWED`.

Режим генерации:

- `ATOMIC`;
- `AVAILABLE_ONLY`.

Отчёт команды содержит created/updated/skipped/conflicts и не маскирует частичный результат.

## 8.3. Waitlist offers

Режимы:

- `FIFO_AUTO`;
- `FIRST_TO_CLAIM`;
- `ADMIN_APPROVAL`.

`WaitlistOffer.state`:

`PENDING → OFFERED → HELD → CLAIMED`

Боковые переходы:

- `PENDING/OFFERED/HELD → EXPIRED`;
- `PENDING/OFFERED → SKIPPED`;
- `OFFERED/HELD → DECLINED`;
- проигравшие конкурентные offers → `LOST`.

Eligibility пересчитывается в момент offer и claim. Claim создаёт commitment и занимает slot/capacity одной атомарной операцией.

## 9. Командный контракт

Каждая mutation-команда содержит:

```text
commandId
idempotencyKey
tenantId
stationId
actorId
actorRole
correlationId
expectedVersion?
reason?
issuedAt
payload
```

Основные команды:

- `CreateOccurrence`;
- `ConfirmOccurrence`;
- `MoveOccurrence`;
- `ResizeOccurrence`;
- `ChangeResources`;
- `ChangeParticipants`;
- `ChangePublication`;
- `CancelOccurrence`;
- `RestoreOccurrence`;
- `CreateSeries`;
- `ChangeSeries`;
- `ClaimWaitlistOffer`;
- `SubstituteParticipant`;
- `CloseResource`;
- `OverrideSoftConflict`;
- `CheckInParticipant`;
- `MarkNoShow`.

Для drag/drop используется `MoveOccurrence`. Клиент сначала вызывает preview, затем подтверждает ту же нормализованную команду с `policyEvaluationId`.

## 10. Доменные события

Минимальный каталог:

- `schedule.occurrence.created`;
- `schedule.occurrence.confirmed`;
- `schedule.occurrence.moved`;
- `schedule.occurrence.resized`;
- `schedule.occurrence.cancelled`;
- `schedule.occurrence.completed`;
- `schedule.resources.changed`;
- `schedule.participant.added`;
- `schedule.participant.removed`;
- `schedule.participant.checked_in`;
- `schedule.capacity.changed`;
- `schedule.publication.changed`;
- `schedule.conflict.overridden`;
- `schedule.series.changed`;
- `schedule.waitlist.offer.created`;
- `schedule.waitlist.offer.claimed`;
- `schedule.waitlist.offer.expired`;
- `schedule.participant.substituted`;
- `schedule.access.grant.changed`;
- `schedule.resource.closed`;
- `schedule.sync.failed`.

Envelope содержит `eventId`, `eventType`, `aggregateId`, `aggregateVersion`, `tenantId`, `stationId`, `occurredAt`, `correlationId`, `causationId` и минимальный payload без секретов.

События пишутся в transactional outbox одной транзакцией с aggregate mutation.

## 11. Read-модели

Отдельные projections:

- `schedule_day_grid`;
- `schedule_attention_feed`;
- `schedule_event_drawer`;
- `schedule_capacity_summary`;
- `schedule_utilization_heatmap`;
- `schedule_sync_health`;
- `schedule_audit_timeline`.
- `schedule_sellable_availability`;
- `schedule_waitlist_operations`;

Сетка не собирает на лету платежи, участников, публикации и Viva payload через каскад вызовов. Она читает денормализованную проекцию с `projectionVersion` и `asOf`.

## 12. Real-time и конкурентность

- источник live-обновления — outbox/проекция;
- транспорт первой версии: SSE либо существующая совместимая шина; транспорт не входит в доменную модель;
- сообщение клиенту содержит aggregate ID и новую версию;
- локальное оптимистичное перемещение откатывается при `VERSION_CONFLICT`;
- пользователь получает новое состояние и понятное предложение повторить действие;
- polling остаётся fallback для gap recovery.

WebSocket/SSE не является защитой от двойного бронирования. Защита обеспечивается транзакционной эксклюзивностью allocations, ожидаемой версией и idempotency.

## 13. Viva ownership

Переходный `sourceSystem`:

- `VIVA` — команда исполняется через адаптер Viva; ЦУП строит shadow projection;
- `CUP` — ЦУП выполняет canonical mutation; Viva получает совместимую projection;
- `IMPORT` — архивный/read-only объект;
- `CUP_ONLY` — тип, которого нет в Viva.

Writer выбирается политикой маршрутизации по `tenant + station + eventKind/service boundary`, а не условием в браузере.

Запрещено:

- одновременно подтверждать один ресурс в Viva и ЦУП;
- считать успешным локальный update до подтверждения canonical writer;
- скрывать `FAILED/CONFLICT` под последним успешным snapshot;
- использовать Viva ID как primary key ЦУП.
