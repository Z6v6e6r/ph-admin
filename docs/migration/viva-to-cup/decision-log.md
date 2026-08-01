# Журнал решений этапа 0

Все архитектурные и операционные решения перехода фиксируются здесь. До подписи запись имеет статус `PROPOSED` и не меняет production ownership.

## Шаблон

| Поле | Значение |
|---|---|
| Decision ID | `D-YYYY-NNN` |
| Дата | `YYYY-MM-DD` |
| Домен/сценарии | `...` |
| Статус | `PROPOSED / APPROVED / REJECTED / SUPERSEDED` |
| Решение | `...` |
| Альтернативы | `...` |
| Evidence | `...` |
| Риски/последствия | `...` |
| Current writer | `...` |
| Target writer | `...` |
| Условие вступления | `...` |
| Rollback/expiry | `...` |
| Подписи | Product / Operations / Finance / Security / Engineering / Viva |

## Стартовые предложения

### D-2026-001 — Один canonical writer

- Статус: `PROPOSED`
- Решение: один writer на aggregate; request-path dual-write запрещён; Viva обновляется только как наблюдаемая projection до отключения.
- Evidence: текущая rating model уже использует `CUP_CANONICAL`, immutable event и projection outbox.
- Требуемые подписи: Architecture, Data, Engineering, Operations.

### D-2026-002 — Запрет UI-скрейпинга

- Статус: `PROPOSED`
- Решение: DOM/UI automation, reverse-engineered private endpoints и личные browser sessions не входят в migration contract.
- Последствие: отсутствие официального API/export/webhook по P0-домену даёт `NO-GO` либо redesign процесса.
- Требуемые подписи: Product, Engineering, Security, Viva.

### D-2026-003 — ЦУП как единственная рабочая точка сотрудников

- Статус: `PROPOSED`
- Решение: после readiness соответствующего домена обычный доступ сотрудников к Viva закрывается; только персональный TTL break-glass.
- Условие вступления: успешный drill и подтверждённая IAM-возможность Viva.
- Требуемые подписи: Operations, Security, Viva.

### D-2026-004 — Рейтинг игрока

- Статус: `PROPOSED_FROM_REPO_FACT`
- Решение: `player_rating_state`/`rating_events` в ЦУП — canonical; numeric field Viva — временная projection.
- Evidence: `src/player-ratings/player-ratings.types.ts` содержит `ownership: CUP_CANONICAL` и `projectionIntent.viva`.
- Требуемые подписи: Product, Operations, Data, Engineering.

### D-2026-005 — Подписки и profile permissions

- Статус: `PROPOSED`
- Решение: на этапе 0 инвентаризировать lifecycle подписок и entitlement, но не связывать их автоматически с profile permissions. Связь требует отдельного решения после canonical ledger design.
- Требуемые подписи: Product, Finance, Architecture.

## Открытые решения

| ID | Вопрос | Блокирует | Owner | Срок | Статус |
|---|---|---|---|---|---|
| O-001 | Кто current writer Client/Family/Consent? | CRM mapping | Product + Viva | Неделя 2 | `OPEN` |
| O-002 | Где граница writer для LK games и ЦУП metadata? | Games cutover | Engineering | Неделя 3 | `OPEN` |
| O-003 | Кто владеет order/payment/refund/receipt до и после cutover? | Commerce | Finance + Architecture | Неделя 3 | `OPEN` |
| O-004 | Каков lifecycle subscription/entitlement/ledger? | Subscription | Product + Finance | Неделя 3 | `OPEN` |
| O-005 | Какой официальный service auth предоставляет Viva? | Все Viva API | Security + Viva | Неделя 1 | `OPEN` |
| O-006 | Можно ли ограничить Viva IAM по station/domain и TTL? | Break-glass | Security + Viva | Неделя 1 | `OPEN` |
| O-007 | Какие Viva reports обязательны юридически/операционно? | Reporting | Finance + Operations | Неделя 3 | `OPEN` |
