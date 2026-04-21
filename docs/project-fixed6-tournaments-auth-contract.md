# project-fixed 6 -> PH AB tournaments auth contract

Updated: April 21, 2026

## Scope

This contract describes how `project-fixed 6` should authenticate users for tournament join flow in PH AB.

## Endpoints

- `GET /api/tournaments/public/:slug/join?format=json`
- `POST /api/tournaments/public/:slug/join` (with `format=json`)

## Auth transport

PH AB resolves user context in this order:

1. `Authorization: Bearer <token>` (or auth cookie)
2. Fallback to `x-user-*` headers

For `project-fixed 6` integration the expected transport is `x-user-*` headers.

## Headers contract

Required in header-mode:

- `x-user-id: <string>`

Recommended for seamless join flow:

- `x-user-name: <display name>` or `x-user-title: <display name>`
- `x-user-phone: <phone>` or `x-user-primary-phone: <phone>`
- `x-user-level-label: <level>` or `x-user-level: <level>`
- `x-user-subscriptions: <json-array-or-semicolon-list>`

`x-user-subscriptions` formats:

- JSON array:
  `[{"id":"tour-pass","label":"Турнирный абонемент","remainingUses":2}]`
- Semicolon list:
  `Турнирный абонемент; Разовое участие`

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

## CORS requirement

Browser clients must be allowed to send:

- `x-user-subscriptions`

This header is now included in backend CORS `allowedHeaders`.

## Minimal request example

```bash
curl "https://padlhub.ru/api/tournaments/public/weekend-cup/join?format=json" \
  -H "x-user-id: user-123" \
  -H "x-user-phone: +7 999 123-45-67" \
  -H "x-user-level-label: C" \
  -H 'x-user-subscriptions: [{"id":"tour-pass","label":"Tournament pass","remainingUses":1}]'
```
