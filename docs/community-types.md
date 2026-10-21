# Four community types — contract and rollout

Owner: CUP manages configuration; LK/Node-RED consumes it; the rating worker owns local membership, feed and rating projections. Audience: CUP staff and LK community members.

## Stored/API contract

- `communityType`: `FRIENDS | STATION | CORPORATE | LEAGUE`.
- An absent or unknown stored type reads as FRIENDS. Reads never write a default. No bulk backfill is required; existing members, invitations, moderation, posts and results remain intact.
- `typeSettings` is validated by the type. `typeSettingsRevision` is server-owned. Updates supply `expectedTypeSettingsRevision` (zero for legacy records); stale requests return 409.
- `typeSettingsEffectiveAt` is server time of activation/type change. Changing ranges retains this cutoff. Explicit type changes start a new activation window. There is no automatic retrospective enrollment/publication.
- Only SUPER_ADMIN/MANAGER with settings:write may change type/configuration. Permission-specific station caps apply to both the current community and the target station. Legacy staff without a permission list retain role-based access. The ordinary LK owner edit/create endpoints cannot change type/configuration.

## Settings

| Type | Settings | Behavior |
| --- | --- | --- |
| FRIENDS | empty object | Existing membership/invite/moderation rules; no new type-driven enrollment |
| STATION | exact stationId | Confirmed persisted game creators/participants and tournament participants are enrolled by exact station ID; bans and duplicate membership guards remain in the atomic write |
| CORPORATE | directionIds, exerciseTypeIds, categories; optional vivaSubscriptionId | Any matching selector publishes the event. Corporate members are not auto-enrolled. Subscription is an optional benefit, not an access requirement |
| LEAGUE | 1–12 divisions, each id/name/minLevel/maxLevel | Canonical score calculations run separately over results assigned to each division |

Categories are open_game, court_rental, group_training, tournament. Selectors are OR; empty corporate selection is rejected. ID selectors refer to Viva IDs, not labels. League ranges must be finite and non-overlapping; gaps are allowed and leave players unclassified. Stable division IDs survive renaming.

Default league divisions use LK's canonical numeric grade boundaries: D–D+ = [1.5,2), D+–C = [2,3), C–C+ = [3,3.5]. D+ belongs to the second and C to the third. Labels and bounds are editable; only the final upper bound is inclusive.

## Projections and history

LK's existing rating worker invokes the bounded community-policy projection before community recalculation. This is eventual processing at the installed worker cadence, not a browser-triggered enrollment. Local sources are lk_games, tournaments and lk_training_visits. Corporate discovery also reads the public Viva schedule for the next 14 days (bounded 10-second GETs, no transaction/booking calls). An unavailable/incomplete schedule is reported in scheduleUnavailable and retried on the next run; it does not invent events or block unrelated rating work. Only persisted, exact-ID roster records can establish membership; schedule counts and contact data alone cannot.

Managed feed posts use deterministic Mongo _id and setOnInsert. Existing publications, including archived/moderated ones, are not resurrected. Publication/refresh claims atomically check the community revision and leave a bounded communityPolicyOutbox intent. The claim is the authorization point: an already approved publication may finish after a later type change, including after a crash. New stale-revision claims are rejected. Changing type does not delete previous publications or members. No provider write, payment execution, notification, private-message delivery or capacity modification occurs in this projection. It does not infer station membership from names. The old fuzzy station autojoin entry is retired by the focused flow patch.

League assignments use a separate community_league_results collection, keyed by stable community/event-type/event/player identity independent of calculationVersion using the built-in unique _id index. A revision-fenced atomic claim stores a bounded leagueAssignmentOutbox intent before the first assignment is stored with setOnInsert; crashes recover that approved intent even after a configuration change. Outboxes are cleared only after immutable-result readback; after write, recalculation reads back the winning record before publishing facts/snapshots. Corrections and recalculation do not move previous results between divisions. Assignments use the original event's ledger-before/snapshot level. A missing historical level or out-of-range player remains unclassified; current profile level is never substituted. Current snapshots carry additive leagueTables; existing overall rows and formulas stay compatible. One player can retain results in multiple divisions across different events.

## Typed access and roster consistency

FRIENDS preserves the legacy guest/identity contract. Typed writes and closed typed reads require a Bearer token verified by a read-only Viva profile request (10-second timeout; failures deny access). The verified ID replaces caller-supplied actor/query identities; phone alone never grants access to typed communities. Typed HTTP responses redact contact fields and internal player keys across roster, ranking (including league tables), feed, comments and chat; phone-derived fallback IDs are omitted. FRIENDS responses retain their existing contract. Closed player-rating reads require an exact-ID verified community member. Public typed reads retain public visibility rules.

Before converting a real community, verify that its owner/admin and members have canonical Viva profile IDs and can sign in through LK. Historical phone-only or incompatible-ID records remain stored but cannot establish typed authorization; any identity repair is a separately reviewed operation. No automatic phone matching/backfill widens access.

Manual typed joins/invites/moderation use the original members/pendingMembers/bannedMembers arrays and policy revision as a compare-and-set filter. They emit HTTP success and ranking/feed/event side effects only after an acknowledged Mongo update matches exactly one community. A concurrent append/join/ban/manager demotion produces 409 COMMUNITY_MEMBERS_CHANGED and no success side effects. CUP roster writes use the same preimage principle and update only roster fields, preserving policy/outbox state.

The optional corporate subscription selects an existing product from Viva's authoritative sale catalog. It does not make a product private or introduce a new member-exclusive entitlement; Viva remains responsible for catalog availability, pricing and purchase authorization. No client retry is performed for the new purchase action.

## Compatibility, rollout and recovery

1. Deploy reviewed LK consumers/worker and focused Node-RED changes, then CUP backend/UI, before changing any real community type. These actions require separate target-specific release authority.
2. Before deployment, run `node scripts/patch_live_community_types.mjs --input /private/live-preimage.json --out /private/community-types-candidate.json` against a fresh, privately held Node-RED export. The patcher edits only reviewed functions/roster acknowledgement edges and adds the verified-actor subflow; it preserves unrelated nodes/configuration, requires the current summaryProjection list-query shape (older checked-in snapshots intentionally fail closed), refuses unfamiliar shapes and emits a hashed change manifest. It never imports/deploys a flow. Do not regenerate a production graph from the repository snapshot.
3. Start with all existing records absent-type/FRIENDS. No real migration, index creation, or historical repair is part of this change. The new collection uses only its default _id index; changing scale/indexes needs a separate measured plan.
4. Configure one explicitly chosen synthetic/staging community per type. Verify raw document vs normalized read, revision conflict, denied/scoped actor, membership bans, duplicate retries, missing event level and the D+/C boundaries. Confirm no old roster/history mutation on conversion.
5. Re-run the projection on the same synthetic inputs and compare IDs, member counts and assignments; rehearse a competing settings revision. Observe worker counts and scheduleUnavailable. No missing-watermark tick may be backdated as a successful live check.
6. Verify browser CUP type switching/config roundtrip and LK league selection/subscription unavailable/error states. Real provider payment and device evidence remain separate from local checks.
7. Stop type-driven future writes by returning a community to FRIENDS through CUP, or stop the worker using the existing operational procedure. Preserve assignments and previous publications. Source rollback alone is insufficient: old workers may rebuild snapshots without leagueTables. Preserve the new assignment collection and use a reviewed roll-forward to restore tables. Do not delete members, posts or assignments as an automatic rollback.

The two repositories carry a byte-identical dependency-free community-policy.ts. Contract fixtures cover defaults, strict input, non-overlap and boundary semantics. No .env values, live flow exports or personal data belong in the patch.


## Local checks

CUP: `npm run build`, `npm run test:community-types`, `npm run test:auth-rbac`, `npm run test:community-results-export`.

LK: `npm run test:community-types`, `npm run test:community-rating`, `npm run test:tournament-community-context`, `node --test scripts/tests/ratingWorkerRelease.test.mjs`, `npm run lint`, `npm run build` with synthetic build-only environment values. The focused suite builds a sanitized complete graph fixture and verifies ingress/auth edges, three commit acknowledgements, function syntax, idempotence and actual response redaction. No live preimage has been used locally. Real-Mongo tests, installed Node-RED/Mongo4 acknowledgement behavior, provider payment and staging/browser acceptance must be verified separately before release.
