# Tournament gender admission

This contract applies to new CUP-owned custom/linked tournament admissions. It does
not establish an admission owner for source-only Viva tournaments or activate any
provider integration. LK1 route paths and normalized public tournament presentation
remain unchanged.

Explicit raw `MALE` / `FEMALE` requires matching fresh actor profile `sex=M/F`.
Explicit raw `MIXED` imposes no gender restriction, pairing/balance requirement, or
profile-sex request. Missing, malformed, or presentation-defaulted tournament gender
never grants unrestricted admission. Missing/unknown player sex or failed/mismatched
profile reads deny restricted fresh admission.

The existing verified LK bearer / verified-phone identity and canonical rating
resolution are retained. The service creates an in-process identity capability;
controllers pass that exact object internally, never body identity/gender or session
presentation claims. The capability uses a symbol on the join-flow profile and is not
serialized. The exact Viva profile read uses existing configured transport and
server-only actor context, verifies returned ID and normalized phone, rejects redirects,
and has no phone search, cache, first-match fallback or write. Profile sex comes only
from that verified response. This is not a claim of real provider acceptance.

Fresh pure-CUP registration, capacity waitlist, explicit level-mismatch waitlist,
transaction reservation and subscription reservation share the check. Raw gender and
`updatedAt` are read from the same aggregate generation as the loaded tournament.
Mongo append, reserve and waitlist mutation compare both fields. The new waitlist path
appends atomically instead of replacing a stale array; community publication after
success is retained. A conflicting rule/generation refuses the write. No new collection,
index, flag or generic eligibility framework is introduced. The fence uses the existing
timestamp, not a new monotonic revision/ABA guarantee.

A successful new payment reservation records the gender decision alongside the
existing eligibility snapshot. Existing pending/recovery branches run before the
new check and retain original operation/provider identity. Old pending records need
no gender evidence retrofit. Confirmed-payment finalization never fetches the current
profile or retroactively re-evaluates gender; current provider verification, capacity,
cancellation and original-binding checks remain in place. Unknown writes never become
permission to create a replacement payment. Stored evidence is not proof that legacy
attempts passed this new rule.

Two legacy external paths lack a durable admission before provider mutation:

- Restricted free linked/Viva (and unknown-source) registration now returns
  `TOURNAMENT_SECURE_JOIN_REQUIRED` before provider POST. Local full/level waitlist
  remains possible. An existing protected paid/subscription flow can be used only
  when actually configured; no automatic fallback is promised. Restricted linked
  free registration remains unavailable in this packet.
- Custom Energy checkout returns the same code for MALE/FEMALE or invalid raw rules,
  directing callers to the existing protected public join flow. No redirect or replay
  is added. Explicit MIXED retains its route after verified identity and same-generation
  rule recheck; conflicting body client IDs or missing verified identity fail closed. Unsigned decoded JWT claims no longer fill identity,
  tenant or name fields missing from authenticated userinfo; they may only conservatively
  reject expiry. Conflicting verified JWT/userinfo identity sources fail closed.

Explicit MIXED legacy external routes do not acquire an atomic Mongo/Viva transaction,
capacity reservation, safe retries or protection from a rule change after the final
read. This packet does not claim to close that pre-existing provider race. No new
payment subsystem is introduced.

Public fresh refusals are `PLAYER_GENDER_REQUIRED`, `GENDER_NOT_ALLOWED`,
`TOURNAMENT_RULE_CHANGED` and `TOURNAMENT_SECURE_JOIN_REQUIRED`; gender refusals do not
allow waitlist. Existing level, payment and already-registered outcomes retain their
semantics.

Validation uses synthetic transport/identity/admission/recovery regressions plus real
Mongo raw-rule/generation CAS cases in the existing isolated automatic CI payment
fixture. The latter must run in CI; no local database/provider access is authorized by
this document. LOCAL, CI and PROVIDER evidence must be reported separately.

Rollback to an older reader preserves pending records but removes admission enforcement.
It is not a safe product rollback while restricted tournaments accept new registrations;
restrict admission through a separately approved procedure before rolling back this
boundary. This document authorizes no deployment or live change.
