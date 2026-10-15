# Community results image export

Owner: CUP communities UI/backend. Audience: existing community staff roles, with the account's station cap preserved. Outcome: the community header opens a background/top-N/period dialog, previews real ranking rows and downloads a PNG locally. No rating, membership or provider writes occur.

## Read contract

`GET /api/communities/:id/results-export?period=month|week|all|custom&places=1..50`

Custom requires strict `from=YYYY-MM-DD&to=YYYY-MM-DD`; both dates are included. Other periods reject date parameters. Moscow calendar months and Monday-based calendar weeks are used. Response is `private, no-store` and includes `communityId`, period/bounds, `timeZone`, `calculationVersion`, `dataAsOf` and allowlisted `{rank,name,score}` rows. Member phones/client IDs are not authorization inputs and are never returned. Phone-like legacy display-name fallbacks become `Игрок N`.

The new route uses the existing community staff roles, plus a fail-closed station check for station-capped accounts. Export resolves the trusted raw station association preserved by the existing Mongo mapper, without changing the general community card contract. The old LK ranking route, roles and client cache are unchanged. Phone/ID-derived display names are neutralized without changing ranks or scores. The upload remains local (PNG/JPEG/WebP, 10 MB and 16 megapixels maximum); no template storage or third-party rendering service is added.

## Canonical calculation and consistency

The pinned LK1 `community-rating-v1.3.0` formulas, normalizers and tie-breaks live in `src/communities/canonical-rating/`. `provenance.json` identifies the exact upstream repository/commit and SHA-256s. Only relative `.ts` import suffixes were removed; `facts.ts` contains the required upstream type declarations only. Do not change formulas here independently. A future upstream update must explicitly refresh the pin and rerun parity checks.

All reads stay in the database containing the selected community. Read the version-pinned all-time snapshot, then facts with the same `collectedAt`, then check the snapshot generation again. Verify the fact count against `totalEventsPlayed` and replay the canonical all-time rows exactly before computing a selected period. This rejects worker delete/insert gaps and partial/mixed generations instead of exporting incomplete standings. Queries are bounded (5-second server execution, at most 20,000 facts). Missing/incompatible/updating inputs return `RESULTS_EXPORT_RATING_NOT_READY` / `RESULTS_EXPORT_RATING_UPDATING` (503), not a synthetic fallback. A limit violation returns `RESULTS_EXPORT_TOO_LARGE` (503).

Week/custom calculation is on demand and is never persisted or added to the worker's snapshot matrix. Select events first, then normalize/rank over the full canonical member population, and only then apply top N. Calendar periods use the tournament's scheduled date (`eventStartedAtTs`, falling back to occurrence); games and visits use occurrence. Only facts finalized by the published generation are used. Current member/level data and net source-ledger deltas follow canonical LK1 semantics: a custom range is **not** a historical membership/level reconstruction. The PNG displays the source generation timestamp rather than implying freshly read provider results.

## Checks and recovery

- `npm run test:community-results-export`
- `npm run test:auth-rbac`
- `npm run test:tournament-results-export`
- `npm run build`
- `PHAB_TEST_SCRATCH=/absolute/owned/scratch node test/community-results-export.browser.mjs` after build; set `CHROME_PATH` for a non-macOS Chromium executable. Uses an isolated headless profile and synthetic localhost data only.

Browser rehearsal covers all four periods, a real PNG, custom background upload, loading/error/empty/mismatched/stale responses, 390px layout, Escape, focus restoration and unmount. No production access is implied.

Stop signal: source/version mismatch, partial generation, permission denial or missing canonical data. Stop method: refuse export and keep download disabled; retry after the existing rating worker publishes a complete generation. No recalculation, index creation, migration, backfill, Node-RED import, database repair or deployment is part of this feature. Reverting this focused source change removes the feature without data rollback. Merge/deploy require separate authority.
