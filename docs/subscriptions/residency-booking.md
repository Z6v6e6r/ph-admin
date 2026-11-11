# Residency monetary booking

Owner: CUP subscription domain. Audience: authenticated holders of Viva product
`4037a3a3-e551-4f9a-a9db-1410e46b8635` and the LK1 paid booking owner.
This change prepares source support; it creates no live type, mapping or publication.

The product grants 30% off games and 50% off group training and tournaments, at
all stations, for 30 days. It grants no free visits or free game minutes. Automatic
renewal is outside this profile. Legacy capability v1 remains games/training only;
tournament admission requires the explicit v2 publication described below. The activation profile is PURCHASE:
the CUP monetary window starts at the confirmed financial issuance instant and
ends 30 days later, independently of Viva visit-counter activation. Frozen,
future and expired financial windows fail closed. The live-refresh authority and
precision rules are specified below; the existing read-only context adapter keeps
its previously projected instance checks.

`buildResidencyPolicyCandidate` creates a check-only `CreatePolicyVersionDto`.
The caller supplies the effective instant and reviewed canonical game/training
event IDs, plus `tournamentEventTypeIds` for the v2 tournament profile. It never guesses a dictionary, reads Viva or writes a database. Use
the existing catalog API to create type `{code:"residency",title:"Резидентство"}`
and its draft policy under an authorized global catalog actor. Then use the
existing digest/impact-bound preview and atomic publication command, with
`SUBSCRIPTIONS_PUBLICATION_ENFORCEMENT_ADAPTER_VERSION=LK_NODE_RED_RESIDENCY_BOOKING_V1`
for the legacy two-rule policy, or `LK_NODE_RED_RESIDENCY_BOOKING_V2` for the explicit
three-rule tournament policy. Each adapter rejects the other policy shape.
Exact Viva inspection, immutable dictionary evidence, audit, CAS, idempotency,
transaction and provider mapping gates are retained.

## Rule contract and compatibility

`BenefitRule.allStations?: boolean` is additive. Omitted/false keeps the existing
explicit `stationIds` behavior. True requires an empty `stationIds` array and
matches every server-resolved station, including stations added later. The
normalizer preserves the field, the runtime digest binds it, and wildcard rules
participate in overlap detection. Station access rules still apply independently.
The residency profile requires wildcard scope on every monetary benefit and
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

## Tournament capability v2

V1's immutable manifest/digest and two enabled rules are preserved. V2 adds exactly
one `PERCENT_DISCOUNT` rule: `TOURNAMENT`, `BOOK_TOURNAMENT`, 50%, all stations,
reviewed canonical external event types and durations 60/90/120. Its contract version
is 2 and capability digest is
`sha256:63be8d476b73583c8b80f55cf7016abe571a2b8159dbb7e8db2f07010f614104`.
Refresh and read-context accept only exact profile/digest pairs. Generic envelope
schema, identity checks, provider financial evidence and sale-period publication
selection remain unchanged. A newer publication does not override an instance's
pinned publication or policy version.

Deploy compatible CUP readers and all four paired LK function validators before an
explicitly authorized v2 publication. Verify refresh authentication independently;
this source change neither reads/replaces real integration credentials nor fixes a
live 401 configuration. Existing v1 instances require a separately approved binding
transition; they do not gain tournament rights from a latest-policy lookup. Keep v2
readers while v2 publications exist; stop new admission/publication before recovery
rather than rolling back to a reader that cannot validate existing operations.
Already created paid-carrier checkout operations require separate provider/payment
reconciliation and are not repriced by this patch.

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
line, integer monetary consistency, `PAID`, a zone-bearing financial payment date,
and no refund or pending refund. Positive `transaction.toPay` is permitted for a
paid purchase: it must equal line cost minus discount. A genuine `PAID` /
`NO_PAYMENT` issuance is eligible only with zero net amount and the full line
discount; zero alone never establishes payment. The subscription's `cost` is not
used to infer gross/net semantics.

The agreed PURCHASE rule grants monetary discounts immediately for 30 days from
confirmed issuance. Its authority is the linked PAID transaction's `paymentDate`,
not provider visit-counter activation. Both Viva `NEW` and `ACTIVE` are accepted
when all financial and ownership checks pass. HOLD, NO_VISITS, FINISHED, EXPIRED,
refund, partial/unknown payment and conflicting identities deny admission. A
present hold/freeze date conservatively denies even if its timezone is ambiguous.

The read model labels this window `VIVA_PAID_TRANSACTION_PAYMENT_DATE`. Raw Viva
status and purchase/activation/expiration dates remain separate provider evidence;
naive provider dates are never assigned an invented timezone. Calendar-only
`YYYY-MM-DD` values in provider evidence are also preserved verbatim
after calendar validation. They do not replace the zoned financial issuance instant,
alter the 30-day window, or establish an activation/expiration instant. A date-only
hold still denies admission. Financial payment and observation dates must remain
timestamps. In the existing v1
envelope `purchasedAt` means this financial issuance instant and `instance.state`
means the active CUP monetary policy window; neither asserts Viva counter
activation. No provider record is modified. The all-station PURCHASE/30-day
policy, no free visits, game CREATE/JOIN 30% and group BOOK_GROUP 50% are unchanged.

Zoned financial timestamps support up to nine fractional digits; absent zones and
the RFC3339 unknown-offset spelling `-00:00` are rejected. Exact raw date
and epoch nanoseconds are retained immutably with transaction/owner/policy binding.
The v1 envelope floors to milliseconds, starts admission only at or after the
ceiling of the exact paid instant, and expires at floor(issuance)+30 days. Thus
precision conversion can shorten the window by less than 1 ms, never extend it.
Refresh or later Viva counter activation cannot restart the 30 days. Even a
same-millisecond change to the paid instant or its raw representation fails closed
instead of silently rebinding the purchase.

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

The financial-window update adds required facts to this private read model; the
public envelope remains v1. Deploy with all residency flags OFF and attest that
the observation collection is empty. An older stored observation without the
financial-origin fields fails the immutable-facts guard; do not migrate or rewrite
it automatically. Any nonempty target needs a separately reviewed reconciliation
before enabling the update. No new indexes or key rotation are required.

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

After any financial-origin observation is stored, rolling back to the older sync
writer is safe only with provider sync, CUP context and Node-RED residency flags
OFF. That writer does not protect the new immutable origin fields and must not be
re-enabled against this read model. Retain the forward-compatible writer or ship
a reviewed forward fix; do not remove the stored financial-origin evidence.
