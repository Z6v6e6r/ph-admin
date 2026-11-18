# Tournament level eligibility: owner implementation and release gaps

Status: **Draft; source integration prepared, P0 provider bypass OPEN**. CUP owns durable
checkout and subscription admission; linked LK/LK2 changes consume that owner. Local synthetic
Mongo/PostgreSQL evidence is separate from CI and deployed/provider acceptance. Direct Viva
ingress remains unclosed. Do not enable the experimental server-booking route for release.
No deployment, provider booking, payment or live data mutation was performed. Disposable synthetic local databases were initialized.

## Ownership and existing changes

The LK1 widget repository is `Z6v6e6r/lk`. Its tournament registration calls
`PHAB_API_BASE/tournaments/:id/register` in `Z6v6e6r/ph-admin`; subscription booking calls
Node-RED `/lk/subscription-bookings`. The linked LK change routes one-time/composite checkout through CUP and installs durable
admission in the composed Node-RED booking owner. CUP owns the tournament rule and player level.
These source changes are not evidence of a deployed cutover or provider-side access restriction.

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
| LK Node-RED `/lk/subscription-bookings` | Composed source calls durable POST owner admission before preaccept, managed entitlement reserve and daily guard; exact-operation refusal and own-guard recovery tested on real Mongo. Deployment not performed. |
| LK browser one-time/composite checkout | Linked LK source POSTs `/tournaments/:id/checkout`; CUP rebuilds the original Viva v2 cart from authenticated catalog and actor, reserves capacity and claims one provider dispatch. No browser write fallback. |
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

## Durable checkout and Node-RED integration

- `POST /api/tournaments/:id/checkout`, authenticated LK Bearer and `Idempotency-Key`.
  Body: `productId`, `source` (`one-time`, `client-one-time`, `subscription`), optional `promoCode`,
  `successUrl`, `failUrl`. Arbitrary actor, amount, level and discount fields are not forwarded.
- Read identity-bound existing operation before fresh catalog/rule checks, even with a different key.
  An unattempted preparation checks fresh canonical level and full saved rule before claiming POST.
  Once dispatched, unknown never expires into permission to POST again. A new process returns the
  original receipt or pending state. There is no provider idempotency/attribution claim for lost POST.
- Same historical cart: one product, `count:1`, embedded tournament `bookingRequests`, subscription
  identifiers, WIDGET, unchanged promo and all redirect aliases. Viva remains the ordinary price/promo
  calculator. Catalog `discountAmount` was not a normalized ordinary product field; custom-energy's
  server discount formula and subscription money-discount owner remain their dedicated paths.
  Unit payload parity is not a real provider charge/settlement test.
- `POST /api/tournaments/:id/checkout/reconcile` reads authenticated bookings and transfers the held
  seat to a participant only for one exact actor/exercise/acknowledged transaction, paid booking.
  A lost transaction ID remains unknown; do not infer ownership from one booking for the exercise.
- `POST /api/tournaments/:id/subscription-admission` accepts the existing Node operation ID and
  subscription ID. It creates a durable capacity hold after canonical admission. Response binds actor,
  exercise, subscription and original request ID. GET level-decision remains preview only.
- Node's confirmed owner calls `POST /api/tournaments/:id/subscription-admission/complete` using the
  original Bearer plus existing CUP integration token. Browser Bearer alone cannot attest completion.
  Atomic hold-to-roster transfer preserves the first booking ID and rejects a conflicting receipt.
- LK's source composer is applied LAST to the full current booking function. It preserves daily,
  managed-entitlement and other overlays and all graph wires. A definitive refusal only CASes an
  unattempted original operation; uncertain outcomes keep their hold. After readback it releases only
  the matching daily-guard owner. Dispatch/use markers prohibit release; restart and lost ACK are tested.
- Admin additions, waitlist promotion and `maxPlayers` reduction include roster plus active pending
  seats (unique actor phones); complete preimage CAS includes pending holds even at the same timestamp.
- Public card projections exclude the private pending journal and never derive a display name from
  an unnamed pending payer's phone. Owner receipts remain on authenticated operation responses only.
- LK2 local JOIN removes its projection-based pre-gate; CUP returns a durable admission/refusal receipt.
  LK2 preserves command custody and consumes additive refusal codes. This does not add a native paid
  Viva tournament checkout route that did not previously exist.

## Writer matrix: evidence and remaining boundaries

All CUP new-admission paths use `resolveCanonicalLevelByIdentity` and persisted raw
`accessLevels`/`levelTolerance`/gender. Trusted level is retained even for an unrestricted tournament.

| Writer | New action / recovery | Evidence | Remaining limitation |
|---|---|---|---|
| Legacy register API / public registrations | CUP canonical gate + atomic participant/waitlist write; existing member replay | level-enforcement, gender-admission, payment persistence Mongo | Provider direct ingress independent |
| Public join purchase | Canonical gate and full-rule reservation; unattempted restart rechecks; dispatched payment recovery bypasses fresh eligibility | actual controller/service recovery, public-join-flow incl lost majority ACK | Unknown provider receipt remains held |
| Public waitlist / admin promotion | Fresh canonical decision for added member; exact preimage and held-seat count | level-enforcement + physical mixed-writer CAS | No automatic promotion worker found |
| Admin add / source import | Added users checked; imported existing provider roster is observational, not a newly authorized provider booking | level-enforcement/import tests | Provider-created historical rows cannot prove provider gate |
| Custom energy | Canonical level + complete rule equality immediately before new financial operation | same-timestamp range/tolerance regression | Existing dedicated price formula retained; provider staging not executed |
| Browser single/composite | CUP checkout; trusted catalog payload, durable actor hold and one dispatch | owner unit, 14 Mongo scenarios, actual browser function test | Direct external Viva API still callable independently |
| Owned subscription / money discount | Node composed owner POST before reserve/preaccept; own denial cleanup; confirmed completion | actual function tests and real Mongo crash/restart/guard takeover | Requires configured CUP base and integration token on authorized rollout |
| LK2 local owner JOIN | CUP canonical admission and atomic receipt; unchanged command identity on retry | local-owner unit and real Mongo two-connection CAS | Deploy compatible receipt consumer before owner changes |
| Experimental coordinator | Full decision before booking; expired payment lease becomes unknown; late receipt CAS retained | server-booking tests | OFF; not ordinary cart replacement |
| Direct Viva API/widget/admin | Viva is final writer and does not consume CUP admission in these repositories | Repository boundary audit only | **P0 OPEN**, provider requirement below |
| Personal invitation | No authenticated exception contract exists | forged flag negatives | No client flag grants exception |

## Provider integration requirement (P0 owner: Viva + platform integration)

For mapped tournament exercises, Viva must reject end-user `POST .../end-user/api/v2/:widget/transactions`
with tournament bookingRequests, direct exercise booking endpoints, widget self-enrollment and any
other provider admission writer unless a server-authenticated CUP grant is atomically consumed.
The grant must bind tenant, exercise, actor, saved rule version/full hash, original operation and
capacity hold. It must be single-use with durable idempotent result lookup by operation ID. Provider
admin/import writers need the same gate or an explicit server-authorized audited policy; no implicit
invitation bypass. A server credential restriction alone is insufficient unless client self-booking
is actually disabled for every tournament writer and authorized server writes remain functional.
No such provider enforcement capability/configuration is proven available here; do not invent a
configuration flag. Obtain provider documentation/contract and staging evidence before P0 closure.

Reproduction protocol for a separately authorized disposable provider fixture:
1. Publish a mapped tournament with maxPlayers=2, explicit range and an out-of-range synthetic actor.
2. Observe refusal and zero new write via CUP, browser and Node routes.
3. With that same end-user credential, try the old Viva transaction cart directly, direct subscription
   booking and widget path. Expect provider refusal and zero booking/transaction/debit. A success is
   a reproduced bypass regardless of green application tests.
4. Use an in-range actor through CUP. Race requests on two processes and alternate keys, drop first
   provider response, restart, then recover exactly one provider record and the same payment link.
5. Repeat promo, zero-price promotion, ordinary single and composite subscription cart; compare
   provider calculated amount/discount/line items and paid completion. Do not use production payments.

No live/provider step above was executed. Unknown dispatch cannot be released by local timeout.

## Verification, rollout and recovery

Focused tests cover bounds/interior, forged labels/invitations, mode bypass, fresh level/rule,
waitlist promotion, admin additions, old API, repeat/concurrent registration, repeated import,
raw-rule restoration fences, booking uncertainty and payment lease recovery. CI includes these
suites and physical Mongo admission CAS tests; the latter now include same-timestamp range and
tolerance edits. Report local results separately from CI and provider tests.

No live migration/backfill ran. The inherited experimental collection
`tournament_server_booking_attempts_v1` uses Mongo's unique `_id`; no added secondary index or
live collection setup was performed. Existing fields are additive; existing absent tolerance is
read as zero. Preserve this collection and existing payment eligibility snapshots during rollback.
Rollback must never mean enabling OFF or reverting to an unguarded booking writer. Keep affected
new registrations closed until the owner guard is repaired; do not cancel or refund existing
operations automatically. Merge, deploy and any provider/shared-state action need separate approval.

### Post-admission abort and new checkout keys (2026-11-18)

`POST /tournaments/:id/subscription-admission/abort` uses the same verified bearer plus
integration-token boundary as completion. It accepts the exact original ownerOperationId,
request operationId and clientSubscriptionId, with proof `PRE_DISPATCH_REJECTED_V1` and
code `SUBSCRIPTION_ELIGIBILITY_CHANGED_BEFORE_WRITE`. LK1 issues this attestation only
from its durable predispatch failure CAS, never from an HTTP timeout. CUP compares the
full stored command/actor and only releases PROVIDER_CREATE_PENDING without provider
booking/transaction/dispatch/receipt evidence. A majority read of the exact historical row
returns ABORTED after a lost ACK, including after another operation has taken the seat.
Completion and abort atomically compete on the same tournament document: completion
retains a participant; abort prevents a later successful completion receipt.

Checkout now resolves the original requestKey before looking for another active operation.
A new key may bypass only FAILED with explicit `ownerNoDispatch: true` and no provider
markers, and must pass current catalog/admission/rule/capacity checks. The original key
always replays its stored outcome, even when a newer payment exists. Reservation CAS
also deduplicates requestKey against terminal history. Active/PROVIDER_RESULT_UNKNOWN
operations retain original payment custody under any alternate key. Existing legacy FAILED
semantics are unchanged; a bare legacy FAILED is not proof authorizing a new checkout.

No collection/index migration is needed; fields and endpoint are additive. Install CUP's
endpoint before the new LK1 abort producer; install the LK2 additive refusal consumer before
emitting new owner reason codes. Source rollback must preserve unfinished abort custody.
These local proofs use synthetic provider transports and disposable Mongo namespaces.
STAGING composition/restart checks and PROVIDER direct-write enforcement remain outstanding;
P0 direct Viva/widget bypass is still OPEN. No merge, deploy or live mutation is authorized.
