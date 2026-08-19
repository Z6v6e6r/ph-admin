# Managed annual subscriptions: activation gate

Status: **RUNBOOK ONLY / NO ACTIVATION AUTHORIZED**.

This runbook separates compatible-code deployment, runtime index migration, canonical target
projection, shadow enablement and later operational booking. Passing one gate never authorizes the
next. Do not put Mongo URIs, integration tokens, hash peppers, LK JWTs or provider client IDs in
commands, chat, Git, process arguments or artifacts.

## Gate A — compatible code, every feature off

Deploy only an immutable reviewed release with these flags absent or false:

- `SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED`;
- `SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED`;
- `SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED`;
- `SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED`;
- `SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED`.

Verify the served release SHA, `/api/health`, authenticated ЦУП and existing games/tournaments.
No runtime collection, provider call or subscription operation is expected at this gate.

## Gate B — index audit, read only

Requirements:

1. environment-approved Mongo backup/snapshot reference;
2. correct `SUBSCRIPTIONS_MONGODB_DB` and secret-backed Mongo URI in the service environment;
3. compatible code from Gate A;
4. no application feature flag enabled.

Run the guarded script in check mode with runtime contracts included:

```bash
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true npm run subscriptions:indexes:check
```

Expected result: an explicit list of missing/drifted indexes. The command may exit `1` while the
plan is unapplied. It must not create collections or indexes. Save only collection names, index
names and counts; do not save connection strings or documents.

Stop on any duplicate preflight concern, drifted same-name index, wrong database, unavailable
backup, primary instability or unexpected collection population.

## Gate C — guarded index apply

This is a Mongo mutation and requires separate approval. Keep the application flags off. Execute:

```bash
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true \
SUBSCRIPTIONS_INDEX_APPLY=CONFIRM \
npm run subscriptions:indexes:apply
```

The script checks duplicates for every unique index before creating any index. A duplicate stops
with `DUPLICATE_PRECHECK_FAILED`. After success, rerun the Gate B check and require zero missing
indexes. Do not drop successfully created indexes during ordinary rollback; an index drop needs a
separate reviewed plan.

## Gate D — canonical projection producer

The trusted shadow endpoint cannot be enabled until a separate server component writes immutable
`subscription_canonical_target_snapshots` revisions. The producer must prove:

- authoritative tenant, target, action and station mapping;
- canonical event/product type and dictionary revision;
- integer RUB minor-unit base price;
- separate target and price evidence references;
- monotonic revision, bounded `observedAt` freshness and explicit `expiresAt`;
- no phone, name, bearer, integration token or payment instrument in the snapshot;
- Golden HAR/API evidence for every Viva-derived field and price unit;
- idempotent replay and revocation behavior.

There is intentionally no generic admin/browser insert route. Until this producer and a synthetic
snapshot fixture are reviewed, the resolver must return unavailable.

## Gate E — synthetic shadow only

After Gates A–D and secret provisioning, enable only:

```dotenv
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_ENABLED=true
SUBSCRIPTIONS_SHADOW_QUOTE_MAX_STALENESS_SECONDS=60
SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED=true
SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED=true
SUBSCRIPTIONS_RUNTIME_TENANT_ID=<approved-tenant>
SUBSCRIPTIONS_SHADOW_QUOTE_INTEGRATION_TOKEN=<secret-reference>
SUBSCRIPTIONS_RUNTIME_HASH_PEPPER=<secret-reference>
```

Use only the confirmed synthetic LK principal and synthetic subscription instance. The browser
must not call the internal route. Verify allowed and blocked quotes, stale/revoked snapshot,
wrong tenant, wrong snapshot revision, booking window, active-service limit, station surcharge,
duration, disabled game discount and non-game benefit matching.

Acceptance evidence is calculation-only: HTTP status/code, sanitized blockers, policy/digest,
aggregate revision and price decision. There must be no Viva mutation, payment, booking,
entitlement reservation, ledger/outbox append or admin audit write.

## Recovery

1. disable `SUBSCRIPTIONS_TRUSTED_SHADOW_ADAPTER_ENABLED` and
   `SUBSCRIPTIONS_CANONICAL_TARGET_RESOLVER_ENABLED`;
2. keep runtime indexes in place;
3. keep runtime contracts enabled only if all indexes still verify;
4. confirm health and existing product paths;
5. preserve sanitized logs/correlation IDs for analysis.

Operational reserve/provider-confirm/compensation remains a later independent gate.
