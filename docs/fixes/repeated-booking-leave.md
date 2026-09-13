# Re-added Viva participant removal

Owner: CUP Games maintainers. Audience: reviewers and release operator.

Removal now resolves an exact booking from active participant/payment evidence,
ignoring expired payment generations. Conflicting active booking IDs still fail
closed. A single unbound ADMIN participant with a valid game snapshot and Viva
exercise may use snapshot-based membership discovery in LK. CUP performs no local
roster or payment mutation.

Requires the matching LK durable DISCOVERY binding change before CUP deployment.
LK must save and independently read back the unique current provider booking before
cancellation. This change alone is not a deployable repair against the old LK route.

Checks: games-player-removal-request test and full CUP build pass. No live calls,
provider cancellation or deployment was performed for this source change.
Idempotency is per membership snapshot, not global across changed snapshots.
Inactive-first duplicate roster records retain fail-closed behavior.
