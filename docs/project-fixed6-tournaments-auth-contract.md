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

When `TOURNAMENTS_PUBLIC_REQUIRE_LK_AUTH=true` and user is not authenticated:

1. Join API returns `code=AUTH_REQUIRED` with:
   - `authUrl`
   - `authCheckUrl`
2. `authUrl` points to `TOURNAMENTS_PUBLIC_LK_AUTH_URL` (currently `https://padlhub.ru/lk_new`) and always contains:
   - `returnUrl=<absolute /join URL>`
   - `source=tournament_join`
3. After successful login, `project-fixed 6` must return browser to `returnUrl`.
4. Client polls `authCheckUrl` until response code is not `AUTH_REQUIRED`.

## Minimal request example

```bash
curl "https://padlhub.ru/api/tournaments/public/weekend-cup/join?format=json" \
  -H "Authorization: Bearer <LK Keycloak JWT>"
```
