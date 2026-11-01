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
