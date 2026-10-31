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

Do not activate until every LK/CUP writer preserves this contract, producer stores immutable
original-operation admissions before booking dispatch, private signed delivery is provisioned,
exactly one official STATION selector is proven, and physical CI races pass. Booking cancellation
does not remove community membership. Missing evidence never becomes automatic return.

There is no arbitrary player cap or evictable history. Existing Mongo community-document size
limits remain an activation capacity evidence gap: measure target size and growth. A real store
failure cannot be reported as successful moderation. Test only the existing CI-owned Mongo7
fixture; no local/shared database provisioning or migration is part of this source change.
