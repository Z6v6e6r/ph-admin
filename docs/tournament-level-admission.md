# Tournament level admission (v2)

Server rule: `src/tournaments/tournament-level-admission.ts`. Every CUP route that admits a player
uses it; LK1, Node-RED gateways and composite purchase consume the decision and never recompute it.

## Rule

- Level source: CUP `player_rating_state` through `PlayerRatingsService.resolveCanonicalLevelByIdentity`
  for the verified actor. No Viva read, no fallback, no client-supplied level.
- `accessLevels` written by the admin slider (contiguous grid points) is a continuous range
  `[first, last]`; the top grid point (6.3) is open-ended. Legacy plain grade lists (`["D+","C"]`)
  keep set semantics by the canonical grade formula. Anything else is `ACTIVITY_LEVEL_INVALID`
  (closed), never "no restriction".
- `levelTolerance` (±, per tournament): `effectiveMin = min − t`, `effectiveMax = max + t`, inclusive,
  compared as integers at 5 decimals (CUP precision). Absent = 0 for existing tournaments; new
  tournaments default to 0.2; 0 is stored as 0. Valid range `0…1` (widest grade band), at most 5
  decimals. Tolerance applies only to the continuous format. The player's rating is never changed.
- Reasons: `LEVEL_NOT_RESTRICTED`, `LEVEL_ALLOWED`, `LEVEL_ALLOWED_WITH_TOLERANCE`, `LEVEL_NOT_ALLOWED`,
  `PLAYER_LEVEL_REQUIRED` (no CUP level), `PLAYER_LEVEL_UNKNOWN` (inconsistent CUP state),
  `LEVEL_CHECK_UNAVAILABLE` (rating store unavailable), `ACTIVITY_LEVEL_INVALID`, `LEVEL_GATE_DISABLED`,
  `LEVEL_GATE_LEGACY`.

## Decision contract

`GET /api/tournaments/:id/level-decision` (LK bearer) and `levelDecision` in
`GET /api/tournaments/:id/registration/me`, register/purchase refusals and energy refusals:
`allowed`, `reasonCode`, `message`, `baseRange`, `levelTolerance`, `effectiveRange`, `allowedGrades`,
`playerLevel`, `ruleVersion`, `ruleUpdatedAt`, `mode`, `enforced`. `ruleVersion` changes with the range,
tolerance or tournament revision.

## Enforced routes (ENFORCE)

| Route | Check |
|---|---|
| `POST /tournaments/:id/register`, `POST /tournaments/public/:slug/registrations`, `POST …/:slug/join` | before the atomic append; the append is CAS-bound to `updatedAt` |
| `POST …/:slug/join` purchase (`createPublicJoinPurchaseTransaction`) | before a new payment; a started payment keeps its start decision |
| `POST /tournaments/:exerciseId/custom-energy-checkout` | before Viva checkout; rule revision re-read before the provider call |
| Local owner `JOIN` | unchanged call site, v2 rule |
| `registration/me` | `canRegister=false` with the decision; existing registrations not re-evaluated |

Not covered by CUP: LK1 one-time payment created by the browser directly in Viva, the LK1 Node-RED
subscription gateway until it consumes `level-decision`, and any direct Viva end-user booking.

## Switch

`TOURNAMENT_LEVEL_ADMISSION_MODE`: unset/unknown = `legacy` (pre-v2 behavior unchanged), `enforce`,
`off` (emergency, admits without a level check). Switching never deletes settings or participants.
Rollback: unset the variable and restart.

## Closing direct Viva booking (prepared, not active)

Direct bookings bypass every PadlHub check:
- the LK1 one-time payment and the combined "subscription + booking" purchase
  (`products:[{SUBSCRIPTION, bookingRequests:[exerciseId]}]`), both created by the browser in Viva;
- any client calling the Viva end-user API or widget for the same exercise.

A UI check (LK1) and the Node-RED gateway cannot close these. The level never goes to Viva:
client groups, tags or custom fields derived from a level are out of the question.

1. **Detect (available now, read-only).**
   - `GET /api/tournaments/custom/:id/level-admission-report` (`tournaments:read`, station-scoped)
     and the admin button "Проверить участников по сохранённому правилу".
   - The report applies the v2 rule to everyone on the roster, including bookings synced from Viva.
   - Nobody is removed, cancelled or refunded automatically. Refunds stay manual (first-version
     mode), and the organizer decides.
2. **Close self-booking in Viva for restricted tournaments only.** This is a provider setting.
   It must be confirmed with Viva and decided by the owner before any implementation:
   - Q1: Can one exercise be made non-bookable by clients (widget and end-user API
     `transactions`/`bookingRequests`) while the admin API can still book it? What is the setting?
   - Q2: Which admin API call creates a booking for a client? What are its idempotency and recovery
     semantics? There is no such call in CUP, LK1 or LK2 today; they only read bookings.
3. **Server-owned booking (implementation after 1–2).**
   - LK1 and the composite purchase send the join request to CUP.
   - CUP evaluates the decision and creates the Viva booking through the admin API.
   - The payment goes through the existing admin `createBookingPaymentCheckout`
     (`/api/v1/transactions` with `bookingIds`), with pending-payment recovery.
   - The decision snapshot (`ruleVersion`) is stored. A started payment keeps its start decision,
     also for the composite purchase (owner decision 2026-11-17). A new payment gets a new decision.
   - This is CRITICAL (provider POST, idempotency, ambiguous-write recovery, reconciliation).
     Estimate: 3–5 engineering days after Q1/Q2 are answered.
4. **Rollout.** Restricted tournaments one at a time; unrestricted tournaments are unchanged.
   Rollback: reopen self-booking for that exercise in Viva.

Until step 2 is active, full server-side admission control is **not** provided.

## Server-owned booking (implemented, disabled)

Code: `src/tournaments/tournament-server-booking.ts` (state machine),
`tournament-server-booking.service.ts` (Nest + Mongo `tournament_server_booking_attempts_v1`),
`src/integrations/viva/viva-admin-tournament-booking.adapter.ts` (Viva ports).

- Routes:
  - `POST /api/tournaments/:id/server-booking` with the LK bearer and an `Idempotency-Key`
    header (8–128 characters `[A-Za-z0-9_-]`);
  - `GET /api/tournaments/:id/server-booking` reports status and runs read-only recovery.
- Switch: it runs only with `TOURNAMENT_SERVER_BOOKING_MODE=enabled` **and**
  `TOURNAMENT_LEVEL_ADMISSION_MODE=enforce`. Unset means `SERVER_BOOKING_DISABLED` (503).
- Admission: the verified actor goes through the CUP level decision and the existing gender check.
  A refusal returns `403`/`503` with `levelDecision` and stores nothing.
- Price: server-side only, from `details.booking.serverBooking`:
  ```json
  { "baseAmountMinor": 250000, "discountMinor": 0, "discountReason": "Турнир", "productId": null }
  ```
  - `discountMinor = baseAmountMinor` is the 100% discount: the booking is confirmed without a
    payment link.
  - Missing or invalid gives `SERVER_BOOKING_PRICE_NOT_CONFIGURED`.
  - The client never sends a price.
- States:
  - path: `ADMITTED → BOOKING → BOOKED → PAYMENT_CREATING → PAYMENT_PENDING | CONFIRMED`;
  - failures: `BOOKING_UNKNOWN`, `PAYMENT_UNKNOWN`, `REJECTED`, `FAILED`.
- Fencing: one document per tournament and player. Every transition is a CAS on `revision`, and
  only the CAS winner calls Viva. A second key while `BOOKING` gets `SERVER_BOOKING_IN_PROGRESS`.
- Decision: a started attempt keeps its start decision. The decision is re-evaluated once just
  before the provider call. A refusal there gives `REJECTED` without a Viva write.
- Ambiguity:
  - an unknown booking result is never reposted. After the 60 s lease it is resolved by reading
    the exercise bookings, otherwise it stays `BOOKING_UNKNOWN` for an operator;
  - an unknown checkout becomes `PAYMENT_UNKNOWN` and is reconciled manually.
- Viva booking-create is **not configured**. `createBooking` rejects with
  `PROVIDER_BOOKING_METHOD_NOT_CONFIGURED` and makes no network call. It is filled in from a
  captured Viva admin request (HAR) and needs a specialist review before activation.
- The attempt stores no phone. The payment phone comes from the verified actor on each request.
- Tests:
  ```sh
  npx ts-node test/tournament-server-booking.test.ts
  npx ts-node test/tournament-server-booking-service.test.ts
  ```
