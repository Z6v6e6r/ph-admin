# LK/Viva Shadow Rollout Runbook

Дата: 2026-07-04

## Цель

Запустить защитный слой для Viva read-path в shadow mode: код по умолчанию не меняет live path, а governor, reference cache и background snapshot refresh включаются только явными env-флагами. Пользовательский read-path еще не переключен на snapshot.

## Ответственность Агентов

| Агент | Зона | Контрольный результат |
| --- | --- | --- |
| A0 Architect | rollout gates, rollback, итоговое go/no-go | флаги и критерии приемки согласованы |
| A1 Backend Runtime | ph-ab API, DI, env, debug endpoints | service стартует, diagnostics корректны |
| A2 LK Frontend Contract | optional freshness fields, stale UX | текущие клиенты не ломаются, UI-задачи ясны |
| A4 QA/SRE | deploy, logs, request-rate evidence | postcheck и сравнение request fan-out выполнены |

## Shadow Флаги

Безопасные defaults в коде: `VIVA_GOVERNOR_ENABLED=false`, `VIVA_REFERENCE_CACHE_ENABLED=false`, `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=false`. Поэтому сам deploy без env-правок не должен менять live Viva path.

Для strict shadow, где проверяется только background snapshot без изменения live path:

```env
VIVA_GOVERNOR_ENABLED=false
VIVA_REFERENCE_CACHE_ENABLED=false
VIVA_TOURNAMENT_SNAPSHOT_ENABLED=true
VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=false
```

Для canary-защиты от лавинных запросов, после strict shadow:

```env
VIVA_GOVERNOR_ENABLED=true
VIVA_REFERENCE_CACHE_ENABLED=true
VIVA_TOURNAMENT_SNAPSHOT_ENABLED=true
VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=false
```

Оставить на стандартных значениях, если нет причины менять:

```env
VIVA_TOURNAMENT_SNAPSHOT_ACTIVE_REFRESH_MS=60000
VIVA_TOURNAMENT_SNAPSHOT_IDLE_REFRESH_MS=300000
VIVA_TOURNAMENT_SNAPSHOT_ACTIVE_WINDOW_MS=120000
VIVA_TOURNAMENT_SNAPSHOT_HYDRATE_RETRY_MS=60000
VIVA_TOURNAMENT_SNAPSHOT_MONGODB_DB=games
VIVA_TOURNAMENT_SNAPSHOT_PAST_DAYS=7
VIVA_TOURNAMENT_SNAPSHOT_LOOKAHEAD_DAYS=45
VIVA_REFERENCE_CACHE_STUDIOS_TTL_MS=86400000
VIVA_REFERENCE_CACHE_TRAINERS_TTL_MS=43200000
VIVA_REFERENCE_CACHE_PROFILE_TTL_MS=300000
```

Для rollback:

```env
VIVA_TOURNAMENT_SNAPSHOT_ENABLED=false
VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=false
VIVA_REFERENCE_CACHE_ENABLED=false
VIVA_GOVERNOR_ENABLED=false
```

## Локальный Preflight

```bash
npm run build
./node_modules/.bin/ts-node test/viva-request-governor.test.ts
./node_modules/.bin/ts-node test/viva-reference-cache.test.ts
./node_modules/.bin/ts-node test/viva-tournament-snapshot.test.ts
./node_modules/.bin/ts-node test/viva-tournaments-date-loading.test.ts
```

## Deploy На 147-Профиль

На сервере, после попадания изменений в нужную ветку:

```bash
cd /opt/ph-admin
bash deploy/server-147/update.sh
```

После правки `/opt/ph-admin/.env`:

```bash
sudo systemctl restart phab-api
sudo systemctl status phab-api --no-pager
```

## Postcheck

Без admin token проверяются только public endpoints:

```bash
PHAB_BASE_URL=https://padlhub.su npm run postcheck:viva-shadow
```

С admin token/cookie проверяются debug endpoints:

```bash
PHAB_BASE_URL=https://padlhub.su \
PHAB_ADMIN_TOKEN=<admin-jwt> \
npm run postcheck:viva-shadow
```

Strict mode для go/no-go:

```bash
PHAB_BASE_URL=https://padlhub.su \
PHAB_ADMIN_TOKEN=<admin-jwt> \
PHAB_SHADOW_EXPECT_GOVERNOR=false \
PHAB_SHADOW_EXPECT_REFERENCE_CACHE=false \
PHAB_SHADOW_POSTCHECK_STRICT=true \
npm run postcheck:viva-shadow
```

После прогрева snapshot:

```bash
PHAB_BASE_URL=https://padlhub.su \
PHAB_ADMIN_TOKEN=<admin-jwt> \
PHAB_SHADOW_EXPECT_GOVERNOR=false \
PHAB_SHADOW_EXPECT_REFERENCE_CACHE=false \
PHAB_SHADOW_EXPECT_SNAPSHOT_SUCCESS=true \
PHAB_SHADOW_POSTCHECK_STRICT=true \
npm run postcheck:viva-shadow
```

Canary-защита проверяется тем же скриптом, но с `PHAB_SHADOW_EXPECT_GOVERNOR=true` и `PHAB_SHADOW_EXPECT_REFERENCE_CACHE=true`.

Ожидаемое состояние в strict shadow:

- `/api/health` возвращает OK;
- `/api/tournaments/public/list?limit=1` возвращает `generatedAt`, `count`, `items`;
- `/api/tournaments/debug/viva-snapshot` показывает `refreshEnabled=true`, `readModelEnabled=false`;
- `/api/tournaments/debug/viva-reference-cache` показывает `enabled=false`;
- `/api/tournaments/debug/viva-governor` показывает `enabled=false`, `inFlightCount` и `circuits`;
- public response может содержать freshness поля, но пользователи еще читают прежний live/fallback path.

Ожидаемое состояние в canary-защите:

- `/api/tournaments/debug/viva-reference-cache` показывает `enabled=true` и cache entries после первых refresh;
- `/api/tournaments/debug/viva-governor` показывает `enabled=true` и не показывает растущий `inFlightCount` после завершения запросов;
- при ошибках Viva появляются агрегированные `viva_circuit_open`, а не повторяющийся timeout-flood.

## Лог-Проверки

```bash
sudo journalctl -u phab-api --since "15 minutes ago" --no-pager
```

Проверить:

- нет лавины `Failed to load Viva studios`;
- нет лавины `Failed to load Viva trainers`;
- нет лавины `Failed to preload Viva schedule profile`;
- `viva_circuit_open` появляется только как агрегированное state-change событие;
- `viva_tournament_snapshot_refresh_failed` не повторяется на каждый user request.

## Метрики Приемки

Для strict shadow:

- поведение пользователей не меняется;
- snapshot refresh идет фоном и не повторяется на каждый user request;
- rollback выполняется только env-флагами и restart `phab-api`.

Для canary-защиты или read-model:

- входящие `/api/tournaments/public/list` могут расти линейно;
- outgoing Viva catalog refresh не чаще 1 раза в минуту в active mode;
- `studios/trainers/profile` не запрашиваются на каждый public request;
- ЦУП остается отзывчивым, без длинных хвостов по `/api/messenger/*` и `/api/support/*`;
- rollback выполняется только env-флагами и restart `phab-api`.

## Следующий Gate

Переход к `VIVA_TOURNAMENT_SNAPSHOT_READ_MODEL=true` разрешен только после shadow-окна, где:

- snapshot refresh стабильно успешен;
- public list не ухудшил p95;
- outgoing Viva count ограничен;
- debug endpoints подтверждают свежий snapshot;
- нет новых ошибок в registration/payment command-path.
