# STATION lifetime: CUP writer compatibility (inactive by default)

Source-only companion to LK station membership owner v1. Activation owner: root integration.
`LK_STATION_MEMBERSHIP_LIFETIME_ENABLED=true` enables STATION epoch/tombstone writes;
default off preserves existing behavior. An already adopted community retains its fence even
after flag disable: rollback must not erase opt-out history. Review/remove the flag after full
producer/owner migration acceptance. No credentials, live configuration or indexes are changed.

Stored private field is `stationMembershipLifetime: {version:1,revision,players:[{playerId,
canonicalUserId?,epoch,state,lastApplied?}]}`; LK owns confirmation/admission. CUP REMOVE/BAN
advance epoch and retain REMOVED/BANNED; UNBAN/APPROVE explicitly advance epoch and restore
ACTIVE. WARN/PROMOTE/DEMOTE preserve history. Each writer fences old lifetime revision plus
roster/type/policy and commits lifetime+roster in one Mongo update. No public DTO exposes this
field. Ordinary/non-STATION behavior remains unchanged.

Hard delete rejects any row retaining lifetime (even after a type change/flag disable),
and rejects STATION while enabled. Archival requires a separately approved existing
operational procedure; no archive UI/route is added. An otherwise permitted legacy
delete atomically requires absent lifetime and the exact preimage type, so concurrent
adoption cannot lose the identity/tombstone. No identity recreation/backfill is provided.

Do not activate until every LK/CUP writer preserves this contract, producer stores immutable
original-operation admissions before booking dispatch, private signed delivery is provisioned,
exactly one official STATION selector is proven, and physical CI races pass. Booking cancellation
does not remove community membership. Missing evidence never becomes automatic return.

There is no arbitrary player cap or evictable history. Existing Mongo community-document size
limits remain an activation capacity evidence gap: measure target size and growth. A real store
failure cannot be reported as successful moderation. Test only the existing CI-owned Mongo7
fixture; no local/shared database provisioning or migration is part of this source change.

## Stream-adopted lifetime v2 (source-only)

Paired LK station stream adoption atomically creates lifetime
`{version:2,streamId,revision,players}` and outbox
`{version:2,streamId,revision,acceptedSequence,publishedSequence,intents}` from an exact
whole community preimage after legacy outbox drain. CUP does not expose adoption,
create indexes or execute migration. Ordinary lifetime v1 remains unchanged.

Every ACTIVE v2 player requires
`readPosition:{streamId,baselineSequence,readThroughSequence}`, matching the envelope
and `0<=baseline<=readThrough<=publishedSequence`. All counters are safe integers
below Number.MAX_SAFE_INTEGER. Missing/mixed state is rejected, never inferred zero.
CUP APPROVE/UNBAN creates a new epoch with baseline/readThrough equal to the observed
contiguous published frontier. The actual member persistence CAS additionally pins
the entire outbox and lifetime revision, so concurrent publication or read-through
cannot produce a stale baseline. WARN/PROMOTE/DEMOTE preserve same-epoch positions.
REMOVE/BAN keeps a tombstone and does not erase stream custody. Public DTOs still
exclude the entire private lifetime/outbox.

The exact old CUP validator is retained as a synthetic rollback fixture and rejects
v2. An old writer cannot silently replace the new ACTIVE row with a baseline-less v1
row. No rollback may downconvert lifetime/outbox, replace the community without its
full current preimage, or discard pending intents. Paired compatible LK/CUP writers,
LK2 consumer, old-executor drain, production Mongo durability/retention evidence and
separately authorized adoption are required before activation. LOCAL/CI tests do not
prove deployment, failover durability or runtime acceptance.

## Permanent type fence (source follow-up to CUP72)

An existing lifetime marker is now authoritative independently of the mutable
communityType and the enable flag. Presence includes null/undefined/malformed data:
validation fails closed, never converts it into an empty lifetime. A v2 stream
without valid lifetime is likewise unavailable. Already inconsistent adopted
non-STATION rows refuse edits and moderation, including an apparent type repair;
there is no automatic rewrite, epoch restoration or backfill.

An adopted STATION v1/v2 cannot change type (`STATION_LIFETIME_TYPE_LOCKED`). This is
a deliberate compatibility restriction: unrelated valid metadata/settings edits
remain available, while old type-flip/remove/approve/type-flip paths cannot revive
the original ACTIVE epoch. Current REMOVE/BAN and APPROVE/UNBAN still advance epoch;
ACTIVE restoration captures current published frontier. No public DTO changes.

Unadopted communities retain supported type changes. The actual type-changing
update atomically requires absent lifetime, exact previous raw type (missing and
null remain distinct) and the existing typeSettings revision; it requires an
acknowledged match. Adoption winning first makes stale type-update fail, and type
change winning first invalidates LK's complete raw preimage adoption CAS. A stale
flag-off moderation read also requires lifetime absence at its final roster write,
so adoption cannot be followed by a roster change that omitted epoch handling.

LOCAL service tests cover v1/v2, flag disable, malformed/inconsistent rows, ordinary
compatibility and original queued-epoch non-revival. Three additional existing-guard
Mongo CI cases execute actual service queries using independent clients, both
adoption/type-change orders, adoption-versus-moderation, and first-v1 moderation
versus the actual type editor in both orders. The pre-existing exact prior-type
predicate on roster persistence is retained; no redundant runtime predicate is added. They do not exercise a
provider or claim a notification was dispatched; epoch/baseline evidence is an input
to the separately reviewed LK feed. No local database provision is required.

Rollback must not reinstall the prior type-agnostic writer against adopted rows.
Drain old in-flight CUP mutations and install compatible writers coherently before
enabling the dependent feed. Source tests cannot fence an already running old
binary. Existing inconsistent rows require a separately authorized owner recovery;
this packet does not discover or repair live data. No schema, index, credentials,
configuration, deployment or shared-state operation is performed here.
