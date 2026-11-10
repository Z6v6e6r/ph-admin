# Residency monetary booking

Owner: CUP subscription domain. Audience: authenticated holders of Viva product
`4037a3a3-e551-4f9a-a9db-1410e46b8635` and the LK1 paid booking owner.
This change prepares source support; it creates no live type, mapping or publication.

The product grants 30% off games and 50% off group training, at all stations,
for 30 days. It grants no free visits or free game minutes. Tournament benefits
and automatic renewal are outside this profile. The activation profile is PURCHASE:
the provider instance must start at `purchasedAt` and end exactly 30 days later.
An inclusive provider end timestamp one millisecond earlier is accepted. Delayed,
shorter, longer, frozen, future and expired instances fail closed.

`buildResidencyPolicyCandidate` creates a check-only `CreatePolicyVersionDto`.
The caller supplies the effective instant and reviewed canonical game/training
event IDs. It never guesses a dictionary, reads Viva or writes a database. Use
the existing catalog API to create type `{code:"residency",title:"Резидентство"}`
and its draft policy under an authorized global catalog actor. Then use the
existing digest/impact-bound preview and atomic publication command, with
`SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION=LK_NODE_RED_RESIDENCY_BOOKING_V1`.
Exact Viva inspection, immutable dictionary evidence, audit, CAS, idempotency,
transaction and provider mapping gates are retained.

## Rule contract and compatibility

`BenefitRule.allStations?: boolean` is additive. Omitted/false keeps the existing
explicit `stationIds` behavior. True requires an empty `stationIds` array and
matches every server-resolved station, including stations added later. The
normalizer preserves the field, the runtime digest binds it, and wildcard rules
participate in overlap detection. Station access rules still apply independently.
The residency profile requires wildcard scope on both monetary benefits and
`ALL_STATIONS` access without surcharge. Unknown event types remain outside the
reviewed canonical event dictionary.

Runtime zero usage is accepted only for monetary-only percentage policies below
100%, with zero units for every duration and a zero daily visit allowance.
Free-entitlement policies retain positive-unit validation. Existing annual
adapter behavior and omitted wildcard fields remain unchanged.

Older readers do not implement wildcard benefits/zero usage. Deploy and verify
the new CUP readers plus the paired LK residency composer before permitting this
publication. Keep the existing publication command disabled throughout that
rollout. Do not route residency through the annual/free-entitlement adapter or
old generic managed JOIN. The new capability digest attests the monetary profile;
policy/dictionary digests additionally pin the exact event selectors.

## Authenticated read contract

`POST /api/internal/subscriptions/residency-booking-context` accepts the existing
`{clientSubscriptionId}` DTO, LK bearer and `X-Subscriptions-Integration-Token`.
It requires both the existing runtime-context flag and the new default-off
`SUBSCRIPTIONS_RESIDENCY_BOOKING_CONTEXT_ENABLED` flag. The original
`runtime-context` endpoint and its exact schema-1 response remain unchanged.

The new response contains `contextKind=RESIDENCY_BOOKING_CONTEXT`, the exact
provider product ID, `purchasedAt`, runtime compatibility, the existing context,
`observedAt` and `validUntil`. The service first verifies bearer ownership, tenant,
client hash, exact VERIFIED mapping, pinned sale-period publication, policy digest
and fresh provider-instance evidence. It additionally verifies the residency
profile, ACTIVE state, purchase interval and supported capability.

The read is non-mutating. It creates no entitlement or booking. Its validity ends
at the earliest of 30 seconds, the instance expiry, mapping freshness deadline,
and instance freshness deadline. LK must repeat the read before writing and bind
the exact policy/publication/instance and price into its existing durable operation.

## Release and recovery boundaries

The paired LK change uses the existing paid booking/transaction owner, with
`subscriptionVisitCount=0` and no visit decrement. Its own flag is off by default.
Deployment, runtime configuration, real dictionary/Viva evidence, publication,
instance projection and provider acceptance remain separate operational steps.
No key, permission, migration or live data is provisioned by this change.

Before enabling, verify both exact source revisions, flags, audit/index/transaction
readiness and source-generated Node-RED candidate. Stop on an unsupported capability,
missing/expired context, wrong target, changed policy/price or ambiguous provider
outcome. Disable residency admission and publication commands to stop new work;
this does not undo saved bookings or payments. Preserve the existing durable
operation/readback recovery owner. After wildcard/zero-usage publications exist,
retain compatible readers and use a reviewed forward fix rather than old readers.

Local evidence: candidate DTO/catalog validation, all-station/zero-usage quotes,
publication preview/replay, old schema-1 compatibility, stale/foreign/disabled
evidence, interval and near-freshness-deadline checks. These do not prove a real
Viva price, payment, booking or production rollout.

The admin benefit editor preserves every selected action and has an explicit all-stations checkbox. A blank station list keeps the legacy explicit-list meaning; only the checkbox writes `allStations: true` with an empty list. Opening and saving a published residency policy must retain both game actions and its wildcard.

## Live provider refresh

`POST /api/internal/subscriptions/residency-booking-refresh` is an explicit,
authenticated refresh command. It returns the existing residency context envelope;
the old `residency-booking-context` and generic `runtime-context` remain read-only.
The new route requires runtime context, residency context and
`SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED`, the existing integration token and a verified
LK bearer. Tenant/client ownership comes exclusively from that bearer. The body
contains only `clientSubscriptionId`.

Every preview/admission/prewrite request reads Viva again. There is no background
heartbeat or stale-cache fallback. The GET-only reader checks every page of the
owned client's subscriptions, its exact linked `/api/v1/transactions/{id}`, and the
exact all-station/30-day product card. Requests stay on `https://api.vivacrm.ru`,
reject redirects, bound response size and share a deadline. A refresh has an 8-second
budget, inside LK's 10-second HTTP timeout. Evidence time is the start of the
necessary source reads; transaction completion never extends its lifetime.

Eligibility requires exact client/instance/transaction/product links, one product
line, integer monetary consistency, `PAID`, a zone-bearing payment date, and no
refund or pending refund. Positive `transaction.toPay` is permitted for a paid
purchase: it must equal line cost minus discount. The subscription's `cost` is not
used to infer gross/net semantics. ACTIVE alone cannot grant a benefit. HOLD,
refund, partial/unknown payment, conflicting identities, unsupported timestamps or
anything other than the exact PURCHASE/30-day interval cannot return a context.
The current millisecond contract rejects meaningful sub-millisecond timestamps
rather than truncate them into a false interval; actual provider acceptance must
be checked on the purchased instance.

`subscription_residency_provider_observations` is a dedicated provider read model.
It stores normalized evidenced facts and digests, with owner HMAC, source timestamps
and purchase-policy binding. It never invents an annual release, phase, home station,
currency, payment, or free visits. A tenant-scoped all-station context has
`instance.homeStationId=null`; the residency consumer does not use a home station.
Known ineligible observations may record a truthful denial; unknown/inconsistent or
failed source reads do not advance observation freshness. Raw provider bodies and
unrelated subscriptions are not persisted or returned.

The transaction compares the pre-fetch mapping/publication/fence snapshot, checks
monotonic observations, and atomically refreshes genuine product evidence,
mapping revision, fence binding/digest and the owned observation. It uses primary,
snapshot/majority+journaled writes and bounded retries. An uncertain commit is
acknowledged only by primary/majority exact semantic readback. Ownership and the
original purchase-policy binding cannot be reassigned. A binding conflict permits
one complete source re-fetch. This is identity-scoped coverage, not a complete
inventory of all Viva customers.

## Refresh rollout and recovery

1. Deploy compatible CUP/LK source with Node-RED residency admission OFF. Keep all
   existing annual/activation/projector startup writers OFF.
2. Take the standard managed-subscription backup (now includes the observation
   collection, including its absence). Check/apply only the two new unique indexes:
   `node scripts/managed-subscriptions-indexes.mjs --check --residency-only`, then
   the existing target-attested `--apply --residency-only` operator gate. Application
   startup never creates these indexes. Do not drop them to roll back a release.
3. Provision the transport secret on CUP and Node-RED and a stable CUP-only hash
   pepper through the separately authorized protected configuration procedure.
   Configure the verified `SUBSCRIPTIONS_RESIDENCY_SYNC_STUDIO_ID` and a narrow
   `SUBSCRIPTIONS_RUNTIME_CONTEXT_MAX_STALENESS_SECONDS` (60 seconds); context proof
   still expires within 30 seconds of the earliest source read.
4. With Node-RED admission still OFF, enable only CUP provider sync for the
   read-only acceptance (`SUBSCRIPTIONS_RESIDENCY_SYNC_ENABLED=true`); keep CUP
   context flags OFF until this check passes. Check the actual purchased instance
   and its payment with the reviewed
   `scripts/residency-provider-check.mjs --check --client-id ... --subscription-id ...`
   from the pinned immutable runtime directory. Pin `CUP_RESIDENCY_EXPECTED_SOURCE_COMMIT`
   and `SUBSCRIPTIONS_RESIDENCY_READ_APPROVED_CLIENT_ID`. This operator command is
   GET/read-only and does not fabricate a bearer or persist an instance.
5. Enable CUP refresh/context, verify negative and positive owned-client evidence,
   then enable Node-RED admission LAST. Verify actual game/group quotes against
   their ordinary server tariff. Real payment/booking acceptance remains separate
   evidence and must not be claimed from fixtures or health checks.

Stop new admissions at Node-RED, then disable CUP refresh/context. Preserve durable
booking/replay recovery and stored observations; never restore a database over new
purchases. Existing successful/PENDING operation replay does not require a fresh
provider read or enabled admission. Protected configuration values and raw provider
responses must stay out of Git, PR bodies and logs.
