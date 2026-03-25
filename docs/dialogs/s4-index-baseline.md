# S4: Index Passport And Baseline (Dialogs)

This document fixes the current index policy for dialog-related collections and defines the baseline checks for regressions.

## Scope

- Support persistence collections:
  `support_clients`, `support_dialogs`, `support_messages`, `support_response_metrics`, `support_outbox`
- Messenger persistence collections:
  `messenger_threads`, `messenger_messages`, `messenger_station_configs`, `messenger_connector_configs`, `messenger_access_rules`, `messenger_response_metrics`, `messenger_ai_configs`, `messenger_ai_insights`, `messenger_ai_suggestions`

## Index Passport

### Support

- `support_clients`
  `{"id":1}` unique
  `{"phones":1}`
  `{"emails":1}`
  `{"identities.connector":1,"identities.externalUserId":1}`
  `{"identities.connector":1,"identities.externalChatId":1}`
- `support_dialogs`
  `{"id":1}` unique
  `{"stationId":1,"updatedAt":-1}`
  `{"accessStationIds":1,"updatedAt":-1}`
  `{"clientId":1,"status":1}`
- `support_messages`
  `{"id":1}` unique
  `{"dialogId":1,"createdAt":1}`
  `{"clientId":1,"createdAt":1}`
- `support_response_metrics`
  `{"id":1}` unique
  `{"dialogId":1,"startedAt":-1}`
- `support_outbox`
  `{"id":1}` unique
  `{"connector":1,"status":1,"createdAt":1}`

### Messenger

- `messenger_threads`
  `{"id":1}` unique
  `{"connector":1,"stationId":1,"updatedAt":-1}`
- `messenger_messages`
  `{"id":1}` unique
  `{"threadId":1,"createdAt":1}`
- `messenger_station_configs`
  `{"stationId":1}` unique
- `messenger_connector_configs`
  `{"id":1}` unique
- `messenger_access_rules`
  `{"id":1}` unique
- `messenger_response_metrics`
  `{"threadId":1}` unique
- `messenger_ai_configs`
  `{"threadId":1}` unique
- `messenger_ai_insights`
  `{"threadId":1}` unique
- `messenger_ai_suggestions`
  `{"id":1}` unique
  `{"threadId":1,"createdAt":-1}`

## Policy

- Do not add new indexes "for future needs".
- Add an index only after:
  observed query regression,
  reproducible query pattern,
  `explain()` evidence that current indexes are insufficient.
- Any new index must include:
  target query,
  measured before/after,
  write amplification impact assessment.

## Baseline Procedure

1. Build and deploy candidate release.
2. Run index audit:
   `npm run audit:indexes:dialogs`
3. Check runtime diagnostics:
   `GET /api/support/debug/runtime`
4. Check API route metrics logs:
   `type=http_route_metrics` for `/api/messenger/*` and `/api/support/*`.
5. For top queries, capture `explain("executionStats")` and keep:
   `totalKeysExamined`, `totalDocsExamined`, `executionTimeMillis`, `winningPlan`.
6. Keep artifacts in release notes / incident docs.

## Exit Criteria For S4

- Index audit has no missing indexes.
- No unapproved extra indexes on dialog collections.
- Baseline metrics and explain snapshots are collected for the release.
