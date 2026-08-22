# Managed annual subscriptions: reviewed provider projection core

Status: **CHECK-ONLY CORE / NO PROVIDER ADAPTER / NO APPLY COMMAND**.

This checkpoint prepares the fail-closed boundary that can turn one reviewed provider evidence
record into an immutable `subscription_canonical_target_snapshots` revision. It does not read Viva,
approve a Golden HAR, register a Nest provider, expose an HTTP endpoint, write MongoDB, publish a
policy, enable LK enforcement or activate a subscription.

## Accepted input

The JSON input is exact-shape and versioned. Every field is required and additional fields are
rejected. In particular, the core requires:

- `sourceMode=REVIEWED_PROVIDER_EVIDENCE` and `evidenceStatus=APPROVED`;
- separately pinned `provider_approval`, dictionary, target and price evidence SHA-256 references;
- tenant, target, action, station, event/product identity, duration and start time;
- `currency=RUB`, `priceUnit=RUB_MINOR` and `priceRounding=EXACT_INTEGER`;
- an observation window no longer than one hour;
- a `viva:exercise:*` target for game/training/tournament actions, or a `viva:product:*` target for
  an add-on purchase.

Sanitized-but-unreviewed HAR records, synthetic evidence references, unverified price units,
unexpected fields and action/category mismatches fail before any repository connection.

The snapshot identity is deterministic for tenant + target + action + revision. Revisions are
gap-free and monotonic. An exact replay is idempotent, different content at the same identity is an
immutable conflict, and `REVOKED` is terminal. Duplicate-key races are reconciled by an exact
read-back.

## Local validation only

The checked-in CLI deliberately has no `--apply` mode:

```bash
SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT=/absolute/private/reviewed-input.json \
npm run subscriptions:provider-projection:input-fingerprint

SUBSCRIPTIONS_PROVIDER_CANONICAL_PROJECTION_INPUT=/absolute/private/reviewed-input.json \
npm run subscriptions:provider-projection:check
```

The first command emits a credential-free input fingerprint. The second validates and renders only
the derived snapshot identity/action/revision. Both print `write=false` and do not connect to
MongoDB.

## Dormant mutation boundary

The service-level mutation method is intentionally not registered in
`subscriptions.module.ts`, is not reachable from `subscriptions.controller.ts`, and has no package
script. A later, separately reviewed operator adapter must provide all of these independent guards:

- runtime contracts and provider projection explicitly enabled;
- exact input fingerprint and exact approval reference attested out of band;
- `CONFIRM` apply phrase;
- startup index creation disabled;
- exact runtime tenant and explicit station allowlist;
- current observation within the configured bounded staleness window.

Adding that adapter, registering it, providing reviewed evidence, applying indexes and inserting a
snapshot are later gates. None is authorized by this checkpoint.

## Evidence gap on 2026-08-22

The available Piter and HUB captures prove subscription product/list and dictionary read paths, but
they do not prove an action-specific exercise target, exact station/duration/start tuple,
authoritative RUB minor-unit price, unavailable/stale behavior or repeated-read stability. Their
retained copies remain `SANITIZED`, not `APPROVED`, so this core rejects them by design.

Before an operator adapter can be proposed, capture and review one target per supported action,
retain separate price-unit evidence, bind the dictionary revision, exercise stale/unavailable and
repeat-read cases, and record an approval digest under the Golden HAR contract.
