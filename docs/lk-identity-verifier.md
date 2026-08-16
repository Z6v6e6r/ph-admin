# LK identity verifier

## Purpose

`POST /api/internal/lk/identity/verify` is the server-to-server identity boundary
for high-frequency LK reads. Node-RED forwards the original LK Bearer token and
adds `X-CUP-Integration-Token`. CUP verifies the Keycloak JWT locally and returns
only the signed actor identity needed by the result flow.

The endpoint does not read or write player rating data and does not call Viva
`/profile`. Canonical rating remains in CUP MongoDB (`player_rating_state` and
`rating_events`); Viva is only a compatibility projection.

The same verifier is reused in-process by tournament registration. The HTTP
endpoint still requires `X-CUP-Integration-Token`; the in-process call is not a
second HTTP route and performs the identical signature and claim validation.
After identity verification, tournament registration resolves the current
numeric level from the CUP canonical rating state. Browser body fields,
`x-user-*` headers and unsigned JWT payloads are not rating sources.

## Validation contract

The verifier fails closed and requires:

- an integration token of at least 32 bytes;
- a three-part JWT with `alg=RS256` and a non-empty `kid`;
- one matching RSA signing key whose `use` is `sig` and whose `alg` is `RS256`
  when those JWK fields are present;
- a valid signature;
- an exact allowlisted `iss`, with the matching issuer-specific JWKS, `azp`
  and audience policy;
- mandatory `sub`, numeric `iat`/`exp`, and a normalized Russian phone claim;
- a valid optional `nbf` timestamp;
- no conflicting phone, tenant or explicit Viva client-id aliases.

`sub` is never treated as a Viva `clientId`. A `clientId` is returned only when
the signed token contains an explicit supported client-id claim.
The response includes the verified allowlisted `issuer` together with `subject`, so a downstream
service can resolve the exact `(issuer, subject)` identity mapping without trusting a phone lookup.

LK currently has two explicit trusted profiles: the current `clients` realm and
the former `prod` realm used by retained `LegacyAuthProvider` sessions. The
unverified `iss` claim is used only to select one of these preconfigured
profiles; an unknown issuer is rejected without an outbound request. Signature
verification then uses only the selected profile's JWKS, so a token cannot be
cross-signed with a key from the other realm.

JWKS is cached independently per issuer for ten minutes with request
single-flight. An unknown `kid` causes one rate-limited refresh of that issuer
only. The last known good key set may be used for at most one additional hour
during a Keycloak JWKS outage; without a usable cache the endpoint returns
`503`.

## Configuration

Required on CUP/ph-ab:

```env
LK_IDENTITY_INTEGRATION_TOKEN=<dedicated-random-value-at-least-32-bytes>
LK_IDENTITY_KEYCLOAK_ISSUER=https://kc.vivacrm.ru/realms/clients
LK_IDENTITY_KEYCLOAK_JWKS_URL=https://kc.vivacrm.ru/realms/clients/protocol/openid-connect/certs
LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER=https://kc.vivacrm.ru/realms/prod
LK_IDENTITY_LEGACY_KEYCLOAK_JWKS_URL=https://kc.vivacrm.ru/realms/prod/protocol/openid-connect/certs
LK_IDENTITY_LEGACY_EXPECTED_AUDIENCE=widget
LK_IDENTITY_LEGACY_EXPECTED_AUTHORIZED_PARTY=widget
LK_IDENTITY_EXPECTED_AUDIENCE=widget
LK_IDENTITY_EXPECTED_AUTHORIZED_PARTY=widget
LK_IDENTITY_EXPECTED_TENANT_KEY=iSkq6G
```

Before enabling production traffic, decode one current `clients` token and one
retained `prod` token locally without logging or retaining either token. Confirm
their `iss`, `aud`, `azp`, tenant, phone and explicit client-id claim names.
Update the issuer-specific audience/authorized-party values if the real signed
contract differs; do not relax claim checks to make an unknown token pass. Set
`LK_IDENTITY_LEGACY_KEYCLOAK_ISSUER=` to disable the compatibility profile after
all legacy sessions have been retired.

Node-RED uses the matching secret in `CUP_LK_IDENTITY_TOKEN`, CUP base URL in
`CUP_API_BASE_URL`, and explicitly enables the state path with
`RESULT_AUTH_CUP_TARGETS=state`.

## Rollout and rollback

Roll out CUP first, verify the endpoint through the localhost/private route,
then enable only `state` in Node-RED. Submit, confirm, dispute and correction
mutations remain on Viva profile verification until token revocation semantics
and real production claims have been confirmed.

Rollback is configuration-only: set `RESULT_AUTH_CUP_TARGETS=none` and restart
Node-RED. This returns result-state authentication to Viva without changing any
rating state or ledger data.
