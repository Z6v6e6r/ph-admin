# План поставки и миграции расписания

Статус: `DRAFT_FOR_REVIEW`

## Принцип

Новый интерфейс не даёт права сразу становиться writer расписания. Сначала доказывается read parity и обнаружение расхождений, затем mutation parity на ограниченной границе, затем передача ownership.

## Этап A. Контракт и UX-прототип

Результат:

- утверждены термины `Occurrence`, `BookingCommitment`, `ResourceAllocation`;
- подписан контракт основного экрана;
- зафиксированы типы событий первой версии;
- выбран один pilot station;
- сняты реальные сценарии администратора;
- заполнены P0-паспорта `SC-05`, `SC-06`, `SC-07`, `SC-22`, `SC-23`;
- подписаны fixed/flexible availability, prime-time/quota, waitlist и series-price semantics;
- подтверждён официальный Viva read/write contract или зафиксирован `NO-GO`.

Exit:

- Product, Operations, Finance и Engineering подписали границу;
- нет неразрешённого вопроса о writer для pilot boundary.

## Этап B. Shadow read

ЦУП импортирует события writer-системы и строит:

- day grid;
- drawer;
- KPI summary;
- sync health;
- reconciliation report.
- policy test console и sellable availability query.

Из интерфейса нельзя менять canonical событие.

Проверки:

- количество активных событий по дню/ресурсу;
- пересечения ресурсов;
- участники и capacity;
- финансовая read-проекция;
- отмены/tombstones;
- обновления и watermark;
- timezone и переход суток;
- задержка projection.

Exit:

- согласованный период без необъяснённых расхождений P0;
- reconciliation имеет владельца и repair flow;
- stale data видны пользователю.

## Этап C. Новый UI, writer остаётся Viva

ЦУП принимает команды, но маршрутизирует их в единственный Viva writer через версионированный adapter.

Обязательные команды:

- create;
- find availability;
- move/resize;
- participants;
- cancel;
- technical closure.

ЦУП подтверждает успех только после ответа writer и обновляет shadow projection. Timeout получает `UNKNOWN/PENDING`, а не ложный success.

Exit:

- happy path и повторы идемпотентны;
- таймаут, duplicate, version conflict и partial failure имеют операторский repair;
- audit связывает команду ЦУП и внешний результат.

## Этап D. CUP-native boundary

Ownership передаётся не «всему расписанию сразу», а конкретной границе:

`tenant + station + supported event kinds/services + cutover timestamp`

Порядок:

1. закрыть запись в Viva для этой границы;
2. сохранить final watermark/export;
3. выполнить reconciliation;
4. включить `CUP_WRITE_ENABLED`;
5. публиковать совместимую проекцию в Viva, если она ещё нужна;
6. наблюдать conflict/lag/error budgets;
7. откат выполнять переключением к одному writer, не dual-write.

## Первый технический вертикальный срез

Рекомендуемый срез:

- одна station;
- 3–8 кортов;
- один календарный день;
- `COURT_RENTAL`, `OPEN_GAME`, `PERSONAL_TRAINING`, `TECHNICAL_CLOSURE`;
- read-only shadow grid;
- server-side sellable availability для fixed duration и одного flexible rule;
- event drawer и audit timeline;
- reconciliation endpoint/report;
- без денег в mutation path.

После доказанного read parity:

- preview create/move;
- resource conflict engine;
- policy engine с versioned fixtures;
- adapter command;
- idempotency/version conflict;
- outbox и live update.

Сплит-оплата, waitlist и серии подключаются после устойчивого временного/ресурсного ядра, но их сущности и состояния не заменяются временными полями в occurrence.

До первой записи production обязательны capability tests из [конкурентных паттернов](./competitive-patterns.md): gap prevention, series revisions, price snapshots, quotas, capacity pools, waitlist single-winner, multi-court atomicity и access grant revocation.

## Необходимые серверные разрешения

Текущий permission catalog ЦУП ещё не содержит schedule permissions. Целевой набор:

- `schedule:read`;
- `schedule:write`;
- `schedule:cancel`;
- `schedule:override`;
- `schedule:close-resource`;
- `schedule:edit-past`;
- `schedule:payment-read`;
- `schedule:publication`;
- `schedule:audit-read`.

Station scopes вычисляются отдельно для каждого permission и пересекаются с пользовательскими ограничениями. Нельзя расширять write-scope наличием более широкого read-scope.

## Технические компоненты

Целевые модули:

- `scheduling-core` — команды, aggregate, allocations и conflict engine;
- `scheduling-availability` — sellable options, fixed/flexible rules и gap efficiency;
- `scheduling-policy` — versioned policy sets, quotas и explainable evaluations;
- `scheduling-projections` — grid/feed/summary;
- `scheduling-integrations` — Viva import/command/projection;
- `scheduling-reconciliation` — counts/hash/orphans/watermarks;
- `scheduling-api` — query, preview и commands;
- `scheduling-ui` — day grid, feed, drawer.

Граница модулей важнее физических директорий первой реализации.

## Наблюдаемость

Минимальные метрики:

- command latency/success/error по типу;
- resource conflict rate;
- optimistic version conflict rate;
- outbox lag/oldest age;
- projection lag;
- sync pending/failed/conflict;
- reconciliation mismatch count;
- HOLD expired;
- sellable option conversion/expiry;
- policy denials по code/channel/segment;
- quota counter conflicts;
- gap rule warnings/blocks;
- waitlist offer claim/expiry/single-winner conflicts;
- manual override count;
- stale day views;
- live update disconnect/gap recovery.

Логи содержат IDs и correlation, но не телефон, платёжные данные и сырые Viva payload.

## Go/No-Go production cutover

Cutover запрещён, если:

- Viva contract остаётся эвристическим;
- нет full/delta export с tombstones/watermark;
- не доказан один writer;
- конфликт ресурса можно обойти клиентским запросом;
- нет идемпотентности create/cancel/payment-adjacent команд;
- оператор не видит pending/unknown;
- нет reconciliation и процедуры repair;
- RBAC/station isolation не прошли negative tests;
- финансовые последствия переноса/отмены не подписаны Finance;
- нет проверенного rollback без dual-write.
