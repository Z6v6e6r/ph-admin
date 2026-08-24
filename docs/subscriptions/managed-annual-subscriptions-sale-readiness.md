# Managed annual subscription sale readiness

Status: **FLAGS OFF / NO PRODUCTION GO**.

`POST /api/internal/subscriptions/sale-readiness` is a read-only, internal-token-only
contract for an LK server to check whether CUP has authoritative evidence for a
specific Viva annual-subscription product and scope. It never calls Viva and never
creates, changes, activates, charges, or reconciles a subscription.

## Fail-closed boundary

This release always returns HTTP 200 with `ready: false` after successful
authentication and configuration validation. CUP does not yet persist an
authoritative Viva-to-CUP subscription-instance projector checkpoint, so every
successful response contains
`SUBSCRIPTIONS_SALE_READINESS_INSTANCE_PROJECTOR_UNAVAILABLE`.

Do not infer readiness from provider product mappings, publication rows, instance
rows, environment overrides, or an in-memory worker cursor. The first possible
`ready: true` is a separate P0 change requiring a persisted projector checkpoint,
producer identity/version, watermark, staleness policy, restart recovery, and
reconciliation tests.

## Request

The caller sends `X-Subscriptions-Integration-Token`; a user bearer token is not
accepted as a substitute. The JSON body is exact and rejects unknown fields:

```json
{
  "provider": "VIVA",
  "providerProductId": "8bf334ba-3050-4017-b40a-7eef2db1eb16",
  "providerScopeKind": "STATION",
  "providerScopeId": "1ea77cbf-bc36-49a1-96d6-f35c216a409b",
  "requiredAdapterId": "LK_REGIONAL_BOOKING_GATEWAY",
  "requiredContractVersion": 1,
  "requiredCapabilityDigest": "sha256:<64 lowercase hex characters>"
}
```

Allowed scope kinds are `TENANT`, `STATION`, and `STATION_SET`. `STUDIO` is
deliberately rejected. Tenant identity is server-owned through
`SUBSCRIPTIONS_RUNTIME_TENANT_ID` and cannot be supplied in the request.

Successful responses include `Cache-Control: no-store`,
`Referrer-Policy: no-referrer`, and a valid `X-Correlation-Id`. They echo the
requested product/scope and compiled compatibility, expose only sanitized
mapping/publication summaries, and never expose integration tokens, evidence
references, client identifiers, payment data, or raw provider payloads.

## Evidence order and blockers

The read path checks, in deterministic order:

1. compiled LK compatibility requested by the caller;
2. runtime-context enablement;
3. exact mapping identity: tenant + provider + product + scope kind + scope ID;
4. verified mapping state and freshness;
5. active subscription type and its safe current policy version;
6. the exact policy publication, effective state, linkage, derived provider scope,
   and schema-3 runtime compatibility attestation;
7. a repeated exact mapping/type read to detect evidence changing during the check;
8. the unavailable authoritative instance-projector checkpoint.

Missing or business-not-ready evidence returns HTTP 200 with ordered blockers.
Disabled/misconfigured readiness, invalid tenant/staleness configuration, a wrong
integration token, or unavailable/invalid storage uses the existing exception
boundary and returns 403 or 503 as applicable.

## Configuration and rollout gates

The deployment example keeps the new boundary off:

```dotenv
SUBSCRIPTIONS_SALE_READINESS_ENABLED=false
SUBSCRIPTIONS_SALE_READINESS_INTEGRATION_TOKEN=
```

The dedicated token must be at least 32 UTF-8 bytes. Mapping freshness reuses
`SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS` (30 through 86400 seconds).
The repository also requires the existing runtime-contract configuration and
indexes.

Enabling either flag, configuring a production secret, deployment, connecting an
LK caller, and implementing the projector checkpoint are separate release gates.
