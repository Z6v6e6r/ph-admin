# LK/Viva Read Model Implementation Tasks

Дата: 2026-07-04

## Цель

Убрать зависимость пользовательского read-path ЛК/ЦУП от live-latency Viva. Пользовательские списки и карточки должны читаться из локального snapshot/read-model, а Viva должна вызываться фоном через governor, singleflight, budget и circuit breaker.

## Статус реализации

- Стартовый `VivaRequestGovernorService` реализован: singleflight, circuit breaker, transient failures и `Retry-After`.
- `VivaTournamentsService` подключен к governor с rollback-флагом `VIVA_GOVERNOR_ENABLED`; default выключен, чтобы deploy кода без env-правок не менял live path.
- Первый `VivaTournamentSnapshotService` реализован: active refresh 60 секунд, idle refresh 5 минут, Mongo persistence при наличии URI, retry hydration после временного Mongo-сбоя, stale fallback и diagnostics.
- Snapshot rollout флаги разделены: `VIVA_TOURNAMENT_SNAPSHOT_ENABLED` включает shadow/background refresh, `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL` включает отдачу snapshot в пользовательский read-path.
- `TournamentsService` умеет читать source-турниры из snapshot под флагом `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL`, с fallback на прежний live-path при холодном старте или miss по диапазону.
- Public directory response расширен optional freshness полями: `snapshotAgeMs`, `lastSuccessfulAt`, `stale`, `refreshInProgress`, `snapshotAvailable`, `snapshotRefreshEnabled`, `snapshotReadModelEnabled`.
- `VivaReferenceCacheService` реализован: `studios/trainers/profile` подключены к cache, `exerciseTypes/rooms` поддержаны как типы справочников для следующих Viva routes.
- Debug endpoints для rollout: `/api/tournaments/debug/viva-snapshot`, `/api/tournaments/debug/viva-reference-cache`, `/api/tournaments/debug/viva-governor`.
- Shadow rollout runbook: `docs/lk-viva-shadow-rollout-runbook.md`, postcheck command: `npm run postcheck:viva-shadow`; warmup gate проверяется через `PHAB_SHADOW_EXPECT_SNAPSHOT_SUCCESS=true`.
- Следующий backend подпункт: dev/prod shadow rollout, затем перенос games/group read-heavy routes на тот же паттерн.

## Архитектурный Контракт

Read-path:

```text
User/API -> LK/PH API -> local read model/snapshot -> response
                         -> background refresh queue -> Viva
```

Command-path:

```text
User/API -> command handler -> Viva governor -> Viva -> local snapshot update
```

Правила:

- списки, карточки, справочники, расписания и витрины читаются из локального snapshot;
- запись, отмена, оплата, списание абонемента и финальная проверка места/слота идут live через governor;
- при деградации Viva пользователь получает stale snapshot, а не `504`;
- `studios/trainers/exerciseTypes/rooms` обновляются отдельно и редко;
- разные query (`date`, `stationId`, `limit`, `from/to`) не создают разные Viva-запросы, фильтры применяются локально.

## Команда

| Агент | Зона | Результат |
| --- | --- | --- |
| A0 Architect | API contracts, SLA свежести, rollout gates | ADR и acceptance matrix |
| A1 ph-ab Backend | governor, snapshots, diagnostics | `/api/tournaments*` read из snapshot |
| A2 LK Frontend | stale UX, retry policy, live command validation | быстрые страницы без агрессивных retry |
| A3 LK Node-RED/API | games/group/subscriptions read-model | legacy routes не создают Viva fan-out |
| A4 QA/SRE | load tests, observability, rollout | доказанная защита от request storm |

## A0 Architect

### Задачи

1. Зафиксировать SLA свежести:
   - tournaments catalog active: до 60 секунд;
   - tournaments catalog idle: до 5 минут;
   - studios/trainers: 6-24 часа;
   - games/group schedule: active до 60 секунд, idle до 5 минут;
   - final booking/payment validation: live.
2. Разделить операции на `read`, `reference`, `detail`, `command`.
3. Утвердить UI-текст для stale-состояний:
   - "Обновлено N минут назад";
   - "Обновляем данные";
   - "Перед записью проверим актуальность места".
4. Утвердить feature flags:
   - `VIVA_TOURNAMENT_SNAPSHOT_ENABLED`;
   - `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL`;
   - `VIVA_GOVERNOR_ENABLED`;
   - `LK_STALE_READ_MODEL_BADGE`;
   - `LK_GROUP_GAMES_SNAPSHOT_READ_MODEL`.

### Проверка

- ADR согласован с backend, frontend и ops;
- все live-command операции перечислены отдельно;
- rollback path описан до начала prod rollout.

## A1 ph-ab Backend

### Задачи

1. `VivaRequestGovernorService`
   - singleflight по `method + url`;
   - circuit breaker по `widgetId + requestType`;
   - transient errors: timeout, `429`, `5xx`, connection reset;
   - `Retry-After` поддерживается для `429`;
   - diagnostics: in-flight count, circuit states, last errors.
2. `VivaReferenceCacheService`
   - `studios`, `trainers`, `exerciseTypes`, `rooms`;
   - in-memory + Mongo persistence;
   - TTL configurable;
   - fallback to last successful reference cache.
3. `VivaTournamentSnapshotService`
   - snapshot window: `today - 7` to `today + 45`;
   - active refresh interval: 60 секунд;
   - idle refresh interval: 5 минут;
   - `lastPublicReadAt` controls active/idle mode;
   - stale response never waits for Viva;
   - refresh singleflight.
4. Перевести routes:
   - `GET /api/tournaments`;
   - `GET /api/tournaments/public`;
   - `GET /api/tournaments/public/list`;
   - admin list in ЦУП.
5. Добавить diagnostics:
   - `GET /api/tournaments/debug/viva-snapshot`;
   - `GET /api/tournaments/debug/viva-governor`.

### Тесты

- 10 parallel public requests -> 1 background refresh;
- stale snapshot returned on Viva timeout;
- circuit open prevents further Viva calls;
- `Retry-After` opens circuit until remote cooldown;
- `studios/trainers` are not requested during each tournament list refresh;
- empty snapshot returns local custom tournaments with diagnostic flag;
- booking/payment still performs live validation.

### Результат

При 25 клиентах за 10 минут:

- catalog refresh <= 1/min in active mode;
- public API p95 не зависит от Viva latency;
- Viva timeout не создает лавину логов;
- ЦУП остается отзывчивым.

## A2 LK Frontend

### Файлы

- `src/components/tournaments/TournamentsPage.tsx`
- `src/components/tournament-signup/TournamentSignupPage.tsx`
- `src/utils/tournamentSignupApi.ts`
- `src/components/group-schedule/GroupSchedulePage.tsx`
- `src/utils/groupScheduleApi.ts`
- `src/components/games/GamesPage.tsx`
- `src/components/games/FindGamePage.tsx`
- `src/components/games/composite/CompositeGameCreatePage.tsx`

### Задачи

1. Обновить API contracts:
   - читать `snapshotAgeMs`, `lastSuccessfulAt`, `stale`, `refreshInProgress`;
   - не считать stale response ошибкой.
2. Убрать агрессивные retry:
   - не повторять catalog request чаще backend policy;
   - не перезапускать запрос при `499/504` бесконечно;
   - ручной refresh disabled, если refresh уже идет.
3. UI stale states:
   - badge "обновлено N минут назад";
   - skeleton только при полном отсутствии snapshot;
   - при stale показывать данные, а не пустой экран.
4. Commands stay live:
   - перед записью/оплатой показывать "Проверяем актуальность";
   - если место/слот исчез, мягко обновлять карточку и объяснять причину.
5. Group/games:
   - список из snapshot;
   - slot/join/create финально валидируются live.

### Тесты

- stale tournament response renders list;
- `refreshInProgress=true` disables manual refresh;
- `504` does not trigger request loop;
- signup performs live validation before booking/payment;
- group schedule stale response renders with age badge;
- game create slot is prefilled from cache and revalidated on submit.

### Результат

Пользователь видит быстрый список и понятное состояние свежести; ошибка Viva проявляется только на live-command, а не ломает всю страницу.

## A3 LK Node-RED/API

### Зоны

- `node-red/modular/imports-tournaments-active/lk_tournaments.import.json`
- `node-red/modular/imports/lk_games.import.json`
- `node-red/modular/imports/lk_public_legacy.import.json`
- `src/utils/groupScheduleApi.ts` consumers
- games/group/subscriptions endpoints

### Задачи

1. Найти routes, которые live-проксируют Viva на read:
   - games list;
   - public games;
   - group schedule;
   - subscription catalog/status;
   - tournament participants/history where applicable.
2. Вынести read-heavy данные в local snapshot:
   - active games;
   - group schedule;
   - product catalog;
   - reference dictionaries.
3. Убрать fan-out на справочники:
   - станции, тренеры, типы занятий читаются из reference cache;
   - refresh отдельным job.
4. Node-RED jobs:
   - interval refresh with singleflight flag;
   - max one active refresh per route family;
   - fail keeps last snapshot.

### Тесты

- `nodered:modular:validate`;
- focused route tests for games/group/subscriptions;
- synthetic storm: 25 clients do not create >1 refresh/min;
- no debug fan-out nodes left in active import.

### Результат

Legacy LK routes follow the same read-model rule and cannot bypass ph-ab governor by direct Viva fan-out.

## A4 QA/SRE

### Задачи

1. Load scenarios:
   - 25 users opening tournaments over 10 minutes;
   - 25 users refreshing same page;
   - Viva timeout 100%;
   - Viva returns `429 Retry-After`.
2. Metrics:
   - public API p50/p95/p99;
   - Viva outgoing request rate;
   - circuit open count;
   - stale response count;
   - snapshot age.
3. Logs:
   - aggregate state changes only;
   - no repeated per-request timeout log spam;
   - correlation ID for refresh jobs.
4. Rollout:
   - dev/reserve first;
   - prod feature flag off;
   - enable governor;
   - enable snapshot read model;
   - postcheck 24h.

### Проверка

- `curl /api/tournaments/debug/viva-snapshot`;
- nginx access/request count vs Viva outgoing count;
- `journalctl -u phab-api` contains state changes, not timeout flood;
- rollback flag documented.

## Rollout Phases

### Phase 0 - Shadow

- Strict shadow: `VIVA_TOURNAMENT_SNAPSHOT_ENABLED=true`, `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=false`, `VIVA_GOVERNOR_ENABLED=false`, `VIVA_REFERENCE_CACHE_ENABLED=false`.
- Snapshot job builds data but public responses still use current path.
- Canary-protection starts separately by enabling `VIVA_GOVERNOR_ENABLED=true` and `VIVA_REFERENCE_CACHE_ENABLED=true`.
- Diagnostics visible in both modes.

Acceptance:

- snapshot refresh succeeds;
- no behavior change for users;
- logs show outgoing Viva count.

### Phase 1 - Tournaments Read Model

- Public/admin tournament list reads snapshot.
- Commands remain live.
- Feature flag can revert list to live path.

Acceptance:

- public tournaments render during forced Viva timeout;
- 10 parallel requests produce one refresh.

### Phase 2 - LK UX

- Stale badge and no retry loop in LK.
- Signup validates live on command.

Acceptance:

- mobile tournament/signup journey passes;
- stale response not treated as fatal.

### Phase 3 - Games/Group/Subscriptions

- Apply same read-model to other read-heavy paths.

Acceptance:

- group/games/subscription pages open from cache;
- create/join/payment commands still live-validate.

### Phase 4 - Production Hardening

- Alerting and dashboards.
- 24h live postcheck.
- Remove old live-read fallback only after stable period.

## Definition Of Done

- No user-facing read route directly depends on Viva response time.
- Viva outgoing read request rate is bounded by backend policy.
- Circuit breaker protects ЦУП from Viva degradation.
- LK displays data freshness clearly.
- Final actions validate live and return precise conflict messages.
