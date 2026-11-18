# Tournament level eligibility: owner implementation and release gaps

Status: **Draft, not integration-ready**. This change implements mandatory admission in the
CUP/ph-admin owner used by LK1. It does not close direct Viva ingress or move all LK browser
checkout flows to that owner. Do not enable the experimental server-booking route for release.
No deployment, provider booking, payment, migration or live data mutation was performed.

## Ownership and existing changes

The LK1 widget repository is `Z6v6e6r/lk`. Its tournament registration calls
`PHAB_API_BASE/tournaments/:id/register` in `Z6v6e6r/ph-admin`; subscription booking calls
Node-RED `/lk/subscription-bookings`. One-time/composite checkout still calls Viva v2 directly.
Thus ph-admin owns the tournament rule and CUP player level, while LK has additional writers
that must be integrated before the release gate can pass.

This branch incorporates the work already prepared in ph-admin Drafts #126 and #129, then
hardens its write paths. Those drafts are not independent prerequisites to merge separately.
LK2 PR #613 merged as `f6151e440506d780579df6d2c8f0dbb9a130e67f`; its head was
`47fa96e5690d49299f41f67e77e68f4b8fba1e16`. It adds a pre-provider eligibility gate with an OFF
policy default and local eligibility projections. That is not proof of enforcement by LK1.
The present task assigns the final admission decision to LK1/CUP. LK2 must consume it and must
not recompute a second authoritative decision from its local projection.

## Authoritative rule

- Player: fresh `player_rating_state` through
  `PlayerRatingsService.resolveCanonicalLevelByIdentity`, verified actor client ID/phone,
  CUP canonical state. Request `levelLabel`, invitation flags and override flags are not evidence.
- Tournament: persisted custom tournament `accessLevels`, `levelTolerance`, `updatedAt`.
  Admission re-reads raw fields from the primary with majority read concern. Missing/malformed
  raw fields do not become an unrestricted tournament through DTO normalization.
- Numeric slider grid values form a continuous inclusive interval. Noncontiguous numeric lists,
  mixed formats and malformed entries fail closed. The existing slider's top value 6.3 denotes
  the upper-open category through the canonical maximum 7.
- Legacy grade arrays retain set semantics. Numeric CUP grades are D [1,2), D+ [2,3),
  C [3,3.5), C+ [3.5,4), B [4,4.7), B+ [4.7,5.5), A [5.5,7]. No lexical string comparison.
- Integer comparison at five decimal places. Absent tolerance = 0; newly created tournaments
  also default to 0. Explicit stored tolerance (0..1, up to five decimals) is retained and applies
  to continuous ranges. No player rating or residency field is changed.
- Server mode is always ENFORCE. Unset, OFF, LEGACY and misspelled environment values cannot
  bypass admission. Pure evaluator legacy/off cases remain only for explicit utility tests.
- No confirmed personal-invitation exception or authorized exception field exists in these
  contracts. All such flags are ignored. A positive exception test is not claimed: it needs an
  actual approved business rule and authenticated exception record first.

## Entry-point audit

| Entry point | Implemented coverage / limit |
| --- | --- |
| `POST /tournaments/:id/register` (old LK API) | Canonical level before new admission; old response shape plus `code`. |
| `POST /tournaments/public/:slug/registrations` | Same service gate; no request-label bypass. |
| `POST /tournaments/public/:slug/join` | New registration and new purchase gated; started payment retains its original admission. |
| Public waitlist | Current level required. Out-of-range response no longer offers waitlist. |
| Waitlist promotion | Admin roster update identifies new active members, re-reads canonical levels, fences the roster write. No separate automatic promotion worker was found. |
| Administrative roster PATCH | New members checked with no role-based level exemption; unchanged/removals preserved; exact raw preimage CAS. |
| Create/import from source | Explicit added members checked; provider-observed existing roster is observational. Repeated create preserves omitted rules and roster. Repair only restores an empty unrestricted shell with raw-preimage CAS. |
| Local LK2 owner JOIN | Existing canonical actor and atomic operation receipt path uses the common rule. Exact receipt replay remains idempotent. |
| `POST /tournaments/:exerciseId/custom-energy-checkout` | Canonical level and raw rule revision before new checkout; no pricing/residency formula change. |
| Legacy free external Viva registration | Restricted target refuses with `TOURNAMENT_SECURE_JOIN_REQUIRED`; no unsafe provider write before local CAS. |
| Experimental `/tournaments/:id/server-booking` | Disabled by default; fresh pre-dispatch decision and target/price binding. Not a replacement for all LK payment modes. |
| LK Node-RED `/lk/subscription-bookings` | **Not integrated** with owner admission; includes subscription use and money-discount paths. |
| LK browser Viva v2 `transactions` | **Not migrated**: one-time and subscription+booking purchase still bypass owner. |
| Direct Viva API/widget/admin writes | **Not closed or verified** by this patch. Requires provider-side restriction or an owner-enforced provider contract. |
| Invitations | No independent enrollment route with an authorized exemption found; ordinary/forged personal flags do not bypass checked routes. |

## Concurrency, retries and payment compatibility

Fresh public writes fence `updatedAt`, raw `accessLevels`, `levelTolerance`, gender and existing
participant/waitlist identity in Mongo. Capacity is checked atomically. Admin roster replacement
compares the admission preimage then CASes the complete raw row. Repeated create cannot implicitly
reset a restricted rule. A failed concurrent write returns conflict/retry rather than granting
admission on a stale rule. Fresh level is observed immediately before accepting the new operation;
there is no distributed atomic transaction with the independent player-rating writer.

Existing membership replay returns `ALREADY_REGISTERED` even if the level subsequently changed.
Started payments keep their recorded eligibility; payment completion is not a new registration
attempt, so a changed level cannot strand a paid operation. Existing paid-recovery and subscription
binding tests are retained. No amount, discount, promo, subscription, residency or refund formula
was changed. Test fixtures now supply independent canonical evidence and trusted actor capability
where HTTP controllers normally supply those inputs.

Experimental server booking uses one Mongo `_id` per tournament/player and revision CAS:
`ADMITTED -> BOOKING -> BOOKED -> PAYMENT_CREATING -> PAYMENT_PENDING | CONFIRMED`.
A fresh admission is evaluated before the BOOKING CAS, including unchanged target and price.
Unknown booking results are never reposted or adopted merely because one matching booking exists:
that could be an earlier paid/admin booking. They remain `BOOKING_UNKNOWN` with attribution required.
Expired `PAYMENT_CREATING` transitions to `PAYMENT_UNKNOWN`; unknown checkout is never reposted.
Cancelled provider booking status strings are excluded from active matches.

## API integration for LK2

The owner API uses the deployment's existing `/api` prefix.

1. Authenticate using the existing LK bearer. Optional preview:
   `GET /api/tournaments/:id/level-decision` (ID, slug or mapped exercise reference).
   It now always verifies identity, including unrestricted targets, and reads the raw rule.
2. The response adds `tournamentId`, `exerciseId` (nullable for local tournaments) and verified
   `actorClientId` to `allowed`, `reasonCode`, `message`, `baseRange`, `levelTolerance`,
   `effectiveRange`, `allowedGrades`, `playerLevel`, `ruleVersion`, `ruleUpdatedAt`, `mode`, `enforced`.
   This GET is a **preview**, not a durable grant or a bearer token authorizing a later write.
3. Invoke an owner write route. Never treat an earlier preview or LK2 cached level as permission
   to call Viva or an unguarded legacy writer. Preserve operation IDs and existing unknown-outcome
   handling. Add `code` to legacy LK registration response consumers without removing old fields.
4. Stable refusal reasons: `LEVEL_NOT_ALLOWED`, `PLAYER_LEVEL_REQUIRED`, `PLAYER_LEVEL_UNKNOWN`,
   `LEVEL_CHECK_UNAVAILABLE`, `ACTIVITY_LEVEL_INVALID`, `TOURNAMENT_RULE_CHANGED`.
   Missing/unknown/unavailable evidence must not fall back to direct Viva. Render the owner's
   message; retry transient/rule-changed failures after refreshing. A level refusal is not success.
5. Preserve endpoint-specific HTTP status compatibility. Legacy registration returns its existing
   state response with additive `code`; public join has `ok/code`; admin roster refusal is 409;
   experimental server booking uses 403/503 and is disabled unless separately prepared.
6. Supersede/adapt PR #613's independent local gate for these owner paths. Do not enable its local
   policy as a substitute for owner enforcement. The LK2 ADR ownership wording needs alignment.

## Remaining release blockers and authorized next implementation

The user authorized moving LK booking behind its server while preserving payment calculations.
The existing trial-training checkout provides a useful pattern, not a completed tournament port:

- `lk/scripts/nodered_trial_group_nodes/checkout.js` supplies verified profile/target/catalog reads,
  durable target-key insert ACK, single Viva v2 POST and status-only replay after unknown outcome.
- A dedicated tournament route must rebuild the same one-time/client-one-time/composite payload
  from authoritative product and ownership evidence. Preserve promo codes and current product
  pricing. `lk/src/utils/tournamentCustomPricing.ts` defines the current composite payload.
- Existing trial checkout only supports one-time/client-one-time. Composite SUBSCRIPTION selection,
  client subscription IDs and discount evidence require their own catalog/ownership contract and
  parity tests. Do not blindly forward an arbitrary browser payload. The experimental admin v1
  route's static `details.booking.serverBooking` price does not have this parity.
- Node-RED must consume owner admission before new durable reservations and before resumed
  PREPARED operations. The daily-visit patch acquires a separate guard at the start of preaccept.
  A denial after that acquisition needs an exact prewrite refusal CAS and safe release of that
  operation's guard. Simply returning 403 can strand a daily subscription visit. A GET precheck
  by itself is insufficient for cross-service commit-time ownership.
- Confirm mapping of every tournament exercise to an authoritative custom tournament. Unmapped
  targets must refuse instead of silently becoming unrestricted.
- Obtain evidence that direct Viva self-booking is closed for all affected API/widget paths while
  authorized server booking remains usable. A previous draft's statement that this is already
  closed is not current verification and is not relied upon here.
- Experimental server booking additionally lacks proven pre-existing-booking attribution across
  alternative tournament IDs for one exercise, complete capacity/publication checks and payment
  settlement-to-confirmed integration. Do not activate it as the release solution.
- Provider staging booking/payment parity, LK2 end-to-end and deployed Node-RED checks require a
  prepared test target and separately authorized external actions. None was attempted here.

## Verification, rollout and recovery

Focused tests cover bounds/interior, forged labels/invitations, mode bypass, fresh level/rule,
waitlist promotion, admin additions, old API, repeat/concurrent registration, repeated import,
raw-rule restoration fences, booking uncertainty and payment lease recovery. CI includes these
suites and physical Mongo admission CAS tests; the latter now include same-timestamp range and
tolerance edits. Report local results separately from CI and provider tests.

No migration/backfill ran. The inherited experimental collection
`tournament_server_booking_attempts_v1` uses Mongo's unique `_id`; no added secondary index or
live collection setup was performed. Existing fields are additive; existing absent tolerance is
read as zero. Preserve this collection and existing payment eligibility snapshots during rollback.
Rollback must never mean enabling OFF or reverting to an unguarded booking writer. Keep affected
new registrations closed until the owner guard is repaired; do not cancel or refund existing
operations automatically. Merge, deploy and any provider/shared-state action need separate approval.
