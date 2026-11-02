# project-fixed 6 -> PH AB tournaments auth contract

Updated: August 16, 2026

## Scope

This contract describes how `project-fixed 6` should authenticate users for tournament join flow in PH AB.

## Endpoints

- `GET /api/tournaments/public/:slug/join?format=json`
- `POST /api/tournaments/public/:slug/join` (with `format=json`)

## Auth transport

PH AB accepts either:

1. an LK Keycloak `Authorization: Bearer <token>` verified by the CUP RS256/JWKS
   identity verifier; or
2. a CUP-signed public tournament session whose phone was verified by the LK
   one-time-code flow.

`x-user-*` headers, request-body `phone`, `name`, `levelLabel`, subscriptions and
unsigned JWT payloads are not trusted registration identity or eligibility
inputs. A request that only has those values remains unauthenticated.

## Canonical level contract

After trusted identity resolution, PH AB reads `player_rating_state` by the
verified Viva client id and/or normalized verified phone:

- exactly zero matching states means the player has no level and the join flow
  returns `PLAYER_LEVEL_REQUIRED` with trusted-profile and onboarding recovery URLs;
- one state must have `ownership=CUP_CANONICAL`, a valid numeric rating and the
  matching derived grade;
- two states, conflicting client-id/phone aliases, or an inconsistent rating
  state fail closed;
- tournament access receives the canonical numeric rating, preserving the
  finer range boundaries used by tournament cards.

The join controller no longer PATCHes or PUTs a browser-selected level to Viva.
Level assessment must be completed through the canonical profile/onboarding
command before registration is retried.

The recovery URLs preserve `returnActivityType=TOURNAMENT`, `returnActivityId`,
`returnAction=REGISTER` and the absolute tournament `returnUrl`. The public join
form never persists a browser-selected level itself.

## Mutation routes

- `GET /api/tournaments/:id/registration/me`,
  `POST /api/tournaments/:id/register` and
  `DELETE /api/tournaments/:id/register` require the verified LK bearer.
- `POST /api/tournaments/public/:slug/registrations` also requires the verified
  LK bearer and ignores body identity, body level, body subscriptions and
  `purchaseConfirmed`.
- Browser-friendly `GET/POST /api/tournaments/public/:slug/join` accepts the
  verified bearer or the signed session after successful phone OTP. A level
  stored in an older session cookie is ignored and replaced by the CUP value.

Notes and a selected purchase option remain request inputs. Payment entitlement
and subscription use still require their own server-side verification; this
identity contract does not turn client payment flags into evidence.

## LK auth round-trip

When the user is not authenticated, the public join flow always fails closed before registration:

1. Join API returns `code=AUTH_REQUIRED` with:
   - `authUrl`
   - `authCheckUrl`
2. `authUrl` points to `TOURNAMENTS_PUBLIC_LK_AUTH_URL` (currently `https://padlhub.ru/lk_new`) and always contains:
   - `returnUrl=<absolute tournament card URL>`
   - `source=tournament_join`
3. After successful login, `project-fixed 6` returns the browser to the original tournament card.
4. The tournament showcase reads the standard LK access token stored by `project-fixed 6` on
   `padlhub.ru` and sends it as `Authorization: Bearer` only to an allowlisted PadlHub API host.
5. The join endpoint verifies that token through the canonical LK identity service before evaluating eligibility.
6. Client polls `authCheckUrl` until response code is not `AUTH_REQUIRED`.
7. The tournament card never renders or accepts its own phone/OTP authorization form.

## Minimal request example

```bash
curl "https://padlhub.ru/api/tournaments/public/weekend-cup/join?format=json" \
  -H "Authorization: Bearer <LK Keycloak JWT>"
```


## Private nonbinding owner preparation (R1 source contract, 2026-10-31)

`POST /api/internal/tournaments/owner-preparations` is a backend integration read.
It uses the existing `LkIdentityService.verify` contract: verified actor bearer
plus `x-cup-integration-token` checked against the existing identity integration
configuration. The configured tenant is authoritative; the caller cannot select
a tenant or submit actor, exercise, custom-tournament, owner or rule claims.
Missing/invalid integration or actor authentication fails before database reads.
The existing verifier may refresh configured JWKS on a cache miss; this operation
never calls provider business APIs or refreshes tournament data.

The exact request is `{ "tournamentId": "<lowercase UUID v4>", "date": "YYYY-MM-DD" }`.
The date must be a real calendar day. The public ID uses the current LK2 namespace
`phub-public-tournament-v1:<feed item id>` (SHA-256 first 16 bytes with UUID v4 bits),
not an assumed exercise ID. For example, feed `source-record-1` maps to
`b113555e-3f82-413e-b781-8ce9e2f024db`. Linked source cards keep their source feed ID;
standalone custom cards use their custom feed ID. No public frontend should receive
the private binding below.

The exact response fields are `schemaVersion: 1`, `nonBinding: true`, `tournamentId`,
`date`, `observedAt`, `status`, `owner`, `binding`, and `reason`. `RESOLVED` has owner
`CUP_CUSTOM` or `VIVA_SOURCE`, null reason, and this exact private binding:

```json
{
  "feedId": "source-record-1",
  "exerciseId": "exercise-1",
  "customTournamentId": null,
  "customUpdatedAt": null,
  "sourceUpdatedAt": null,
  "snapshotGeneratedAt": "2026-10-31T10:00:00.000Z",
  "snapshotLastSuccessfulAt": "2026-10-31T10:00:00.000Z",
  "mappingSha256": "sha256:<64 lowercase hex characters>"
}
```

A standalone custom tournament may have null exercise ID. `UNKNOWN` has null
owner/binding and one reason: `SNAPSHOT_UNAVAILABLE`, `SNAPSHOT_STALE`,
`TARGET_NOT_FOUND`, `MAPPING_AMBIGUOUS`, `SOURCE_UNAVAILABLE`, `DATA_INVALID`,
`READ_LIMIT_EXCEEDED`, or `READ_UNAVAILABLE`. Authenticated uncertainty returns
HTTP 200; invalid DTO returns 400; authentication retains existing 401/403/503
behavior. Responses use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Metrics label only the fixed route, not query, body, private IDs or identity.
The route explicitly skips admin mutation auditing because it makes no mutation.

Reads use persisted canonical custom records and the persisted Viva snapshot with
primary/majority consistency and a 2-second server query limit per read. They
never create indexes, reserve, register, refresh, enqueue, journal a quote, or
change shared state. The two collection reads are not one cross-collection atomic
snapshot. A digest describes the observed facts, not latest-at-commit ownership.
The raw custom scan includes archived rows and every source/exercise/booking/joinFlow
reference; it cannot turn a read failure, malformed row or duplicate match into
an empty negative lookup. Projection excludes rosters, waitlists, participant
phones, provider client IDs and administrator identity. Computed parent-type sentinels retain structural corruption that dotted mapping
projection could otherwise erase; full booking/joinFlow payloads are not read.
These computed find projections target the existing MongoDB 7 contour. A dedicated
CI-only physical test checks actual projection, PII exclusion and unchanged records/
indexes in a uniquely owned synthetic database; no local database is provisioned.
Display name is read only
to validate the existing visible-card condition and is never returned or hashed.

The capability is deliberately bounded: up to 500 total custom records, 500 dated
source cards and 10,000 records in the persisted source snapshot. Exceeding any
limit returns UNKNOWN rather than trusting a truncated catalog. The snapshot must
cover the requested date and carry an explicit successful `dateLastSuccessfulAt`
entry for that date. A fresh global timestamp is insufficient: the existing
full-window fetch can contain only the widgets that succeeded. Missing, future,
malformed or stale date evidence fails closed. Freshness uses the existing active
refresh interval only when finite and within 1,000–300,000 ms. Preparation does
not trigger a refresh. Actual availability is UNKNOWN until configured persisted
per-date proof and authoritative mappings are verified in the intended runtime.

`mappingSha256` uses domain `tournament-owner-preparation:v1\0` and a deterministic
ordered tuple of configured tenant, public target/date, owner, private mapping,
observed versions, and available rule facts. Matching record or rule updates
change the digest. It is unsigned, nonbinding and carries no expiry, usage ref,
reservation, registration permission or ownership lock. It contains no actor
identity. Missing custom gender/rules fail closed; `MIXED` is retained only as a
rule fact, never interpreted as unrestricted eligibility. A RESOLVED result says
nothing about actor level, gender eligibility, capacity, WAITLIST, payment,
original registration generation or cancellation rights.

Future admission must independently authenticate and freshly revalidate mapping,
eligibility, payment/entitlement and original-generation recovery before any
write. This source packet does not implement that admission, a consumer, provider
acceptance, activation or production verification. Removing the new route is a
source rollback only; it creates no data/schema requiring rollback.
