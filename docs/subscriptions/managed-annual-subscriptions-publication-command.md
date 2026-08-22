# Managed annual subscriptions: reviewed publication command

Status: **ISOLATED CANDIDATE / FLAGS OFF / NO PRODUCTION MUTATION**.

This checkpoint adds the first reviewed command that can turn one DRAFT model-v3
policy into an immutable runtime publication and VERIFIED Viva product mapping.
It does not create a client subscription instance, activate a subscription,
charge money, change Viva, enable LK enforcement or publish any existing DRAFT
by itself.

## Default-off gates

The read-only preview and the mutation command have separate flags:

```text
SUBSCRIPTIONS_ADMIN_ENABLED=true
SUBSCRIPTIONS_RUNTIME_CONTRACTS_ENABLED=true
SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_ENABLED=true
SUBSCRIPTIONS_PROVIDER_MAPPING_PREVIEW_CLIENT_ID=<approved synthetic client>
SUBSCRIPTIONS_RUNTIME_TENANT_ID=<server-owned tenant>
SUBSCRIPTIONS_PUBLICATION_PREVIEW_ENABLED=true
SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED=false
```

Preview can be enabled while publish remains disabled. Enabling either flag,
provisioning the synthetic client or mutating production data is a separate
release/operations approval. Both flags are false in the example environment.

## Two-step contract

### 1. Read-only preview

```http
POST /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions/:version/publication-preview
```

The caller needs global `subscriptions:publication:write`. The request contains
only:

- exact Viva `providerStudioId` used as read-back context;
- immutable `dictionaryRevision`;
- content-addressed `evidence:canonical-dictionary:<sha256>` reference.

CUP loads the exact DRAFT policy, derives provider scope from its station rules,
compiles the PUBLISHED runtime projection, validates the complete stored
publication contract, performs an exact-ID Viva product read-back with the
configured synthetic client, and returns:

- `policyDigest`;
- content-addressed `impactPreviewRef`;
- derived `TENANT`, one-`STATION`, or content-addressed `STATION_SET` provider scope;
- sanitized Viva product evidence;
- exact runtime projection.

Preview is marked read-only, skips mutation audit and writes no mapping,
publication, policy, type, Viva or client instance.

### 2. Publish

```http
POST /api/v1/admin/subscription-types/:subscriptionTypeId/policy-versions/:version/publish
Idempotency-Key: <16..128 stable characters>
X-Correlation-Id: <8..128 stable characters>
```

The body repeats the preview inputs and must include its exact `policyDigest`,
exact `impactPreviewRef`, and a 10..500 character approval reason. CUP repeats
all reads and the Viva exact-ID check. Any changed policy, dictionary input,
scope or digest fails before audit or runtime mutation.

Before the Mongo transaction CUP writes a mandatory durable approval audit
record. Its metadata contains hashes/references and the approval reason, never
the raw Idempotency-Key, provider payload, credentials, cookies or client PII.
If durable audit persistence is unavailable, publication fails closed.

One Mongo transaction then:

1. re-reads the DRAFT type and policy and checks their revisions;
2. inserts one VERIFIED provider mapping;
3. inserts one immutable PUBLISHED policy envelope;
4. changes the policy status to PUBLISHED with revision increment;
5. changes the subscription type from DRAFT to ACTIVE and pins
   `currentPolicyVersion`.

A transaction/CAS/unique-index failure cannot leave a mapping without a
publication. A lost response replays through the tenant + actor + idempotency
mapping index and returns the exact committed mapping/publication. Reusing the
key with another request hash returns `IDEMPOTENCY_CONFLICT`.

The explicit approval audit is intentionally written before the transaction.
A failed transaction can therefore leave an audit of the approved attempt, but
cannot leave partial runtime state. The normal HTTP mutation interceptor adds a
second best-effort route audit only after a successful response; it is not used
as the publication's mandatory approval reference.

## Fail-closed publication rules

The first command supports only the first publication of a DRAFT subscription
type. Supersession, disabling and republishing are deliberately absent and need
their own reviewed command and compatibility plan.

Publication requires:

- modelVersion 3 DRAFT and exact product candidate;
- runtime contract-valid create/join/limit/lifecycle rules;
- either a non-empty exact station set or `ALL_STATIONS` scope derived from policy rules;
- at least one enabled benefit with canonical action, event, duration and
  station selectors;
- immutable dictionary evidence reference;
- fresh exact-ID Viva product evidence;
- empty target mapping/publication unique keys;
- durable audit storage and transaction-capable Mongo topology.

The Piter and HUB DRAFT snapshot audited on 2026-08-21 has
`benefitRules=[]`. It is therefore rejected with
`SUBSCRIPTION_PUBLICATION_ENABLED_BENEFIT_REQUIRED`. Before publication, create
a new policy version containing reviewed canonical game event IDs and station
selectors. Group-training, tournament and paid-duration discount rules remain
absent until their exact Viva/CUP dictionaries and price evidence are approved.

## Recovery and later changes

- Before any production command, take the approved Mongo backup/snapshot and
  rerun `npm run subscriptions:indexes:check` with runtime contracts enabled.
- Keep `SUBSCRIPTIONS_PUBLICATION_COMMAND_ENABLED=false` until the exact preview,
  audit storage and transaction probe are approved.
- If publish fails, inspect the approval audit and the four affected collections;
  do not retry with a new payload under the same idempotency key.
- Code rollback is compatible while no publication exists: turn both new flags
  off and deploy the previous artifact.
- Once a policy is published, do not edit it. Future rule changes require a new
  policy version plus a separately implemented supersession command; existing
  instances remain pinned to their original version/digest unless an explicit
  migration contract says otherwise.

## Evidence required before production mutation

1. focused service/DTO/RBAC/idempotency/CAS tests;
2. typecheck and build from the immutable candidate SHA;
3. Mongo transaction rollback/replay probe on the intended topology;
4. authenticated preview for the exact Piter/HUB version;
5. sanitized Viva evidence and canonical dictionary references;
6. independent R4 code/security/integration review;
7. separate approvals for integration, push, deploy, flag enablement and each
   production publication command.
