# CUP paired STATION message custody

LK owns canonical message acceptance via the community's private `communityMessageOutbox`. CUP does not send/project messages or provision collections/indexes/TTL.

`deleteCommunity` rejects nonempty or malformed outboxes regardless of type. Its final delete filter requires outbox absence or an actual empty array, so a message accepted after the delete preimage prevents deletion. Existing station lifetime deletion protection remains stronger for adopted rows. Update/member moderation only `$set` their owned fields and preserve a concurrent outbox; LEFT/BAN is not blocked by outbox capacity. Public community `details` omit private outbox/event/candidate markers.

This pair must be installed coherently with LK's reviewed message graph and existing lifetime-aware writers. Old already executing graph requests must drain. Accepted intents must survive archive/type changes and recover without fresh user credentials. Any future replacement writer must preserve custody or be rejected; this source has no replaceOne community writer. Malformed state is not safe-to-delete evidence.

LOCAL tests exercise the actual delete, roster persistence and public mapper. Physical concurrent proof belongs to the existing guarded CI Mongo fixture and executes real service deletion/update against it. Live cleanup/retention and Mongo replication/write concern remain UNKNOWN prerequisites; no source test establishes them. No runtime/DB/provider operation, new retention policy or migration is performed.

CUP type/policy updates remain supported. LK now holds even an unadopted legacy send until an acknowledged no-op update matches the **entire original BSON community**. The real CUP type update changes the type/revision atomically; moderation changes the roster. Transition/BAN first therefore invalidates the old send predicate. Legacy acceptance first permits the subsequently emitted old message; this is ordering, not a durable legacy receipt/outbox guarantee. The physical case executes actual CUP update/moderation against this predicate, including absent versus null.

Stream outbox v2 is paired with lifetime v2; see `station-membership-lifetime.md`.
Administrative roster CAS pins this envelope when capturing a fresh ACTIVE baseline.
Settings/roster field whitelists continue to preserve it; deletion remains refused.
No array conversion or clearing is an allowed rollback. This source outcome adds no
CUP message writer, provider request, collection, index or adoption endpoint.
