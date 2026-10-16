# Community results image export

Owner: CUP communities UI/backend. Audience: existing community staff roles, with the account's station cap preserved. Outcome: the community header opens a background/top-N/period dialog, previews real ranking rows and downloads a PNG locally. No rating, membership or provider writes occur.

## Read contract

`GET /api/communities/:id/results-export?period=month|week|all|custom&places=1..50`

Custom requires strict `from=YYYY-MM-DD&to=YYYY-MM-DD`; both dates are included. Other periods reject date parameters. Moscow calendar months and Monday-based calendar weeks are used. Response is `private, no-store` and includes `communityId`, period/bounds, `timeZone`, `calculationVersion`, `dataAsOf` and allowlisted `{rank,name,score}` rows. Member phones/client IDs are not authorization inputs and are never returned. Phone-like legacy display-name fallbacks become `Игрок N`.

The new route uses the existing community staff roles, plus a fail-closed station check for station-capped accounts. Export resolves the trusted raw station association preserved by the existing Mongo mapper, without changing the general community card contract. The old LK ranking route, roles and client cache are unchanged. Phone/ID-derived display names are neutralized without changing ranks or scores. The upload remains local (PNG/JPEG/WebP, 10 MB and 16 megapixels maximum); no user-uploaded template storage or third-party rendering service is added.

## Approved branded layouts

The supplied VND ZIP is pinned by archive/file hashes in `assets/community-results-templates/provenance.json`. Its unchanged inputs contain five designs (Классика, Тёмная арена, Подиум, Табло, Обложка), each with Старт (D), Рокот (D+/C), Смэш (C/C+) themes, RF Dewi Expanded / Source Code Pro font files, and SVG logos. These are trusted application assets, not an arbitrary HTML-upload feature.

The existing build emits `dist/client-sdk/community-results-assets.json` with embedded font/logo data and all fifteen static layouts. Docker copies the asset inputs only into its build stage. Fixed-name `/api/client-script/community-results-templates.js` and `/api/client-script/community-results-assets.json` routes serve presentation assets only; they never contain live community/member data. The UI loads them on demand without passing credentials, renders a self-contained SVG/HTML image in the browser, and saves a local PNG. No hosted design editor, font CDN or external rendering API is used. Missing assets/fonts or rasterization failures keep download disabled; there is no silent substitute design/font.

Choose the design and explicitly choose the matching division theme. The theme changes the displayed label, grade and palette; it does **not** select a different community or filter its players. The exported community name always identifies the data source. The regular light/dark/custom-background modes remain available unchanged.

Each branded PNG is 1080×1350, with at most ten canonical rows. Up to fifty requested places produce up to five pages, navigable in the dialog and downloaded individually with design/division/page in the filename. Ranks and scores are never recalculated per page. On later podium pages the header names the actual rank range and the first-place leader badge is absent. Unused sample cards/names/rows are removed; long names ellipsize, while numeric scores fit without dropping digits.

### Optional statistics and unavailable metadata

Only requests with `details=templates-v1` add `statistics: {tournamentsPlayed, tournamentsWon}` to rows. The default response keeps exactly `{rank,name,score}`, preserving existing clients. Counts use the same selected facts, generation and calendar boundaries as scores. Participation comes from the canonical aggregate. `tournamentsWon` means canonical tournament facts whose finish is first place, **not** match wins inside a tournament. The upstream canonical extractor can infer place from standings row order; these are canonical first-place records, not independently re-audited provider outcomes. Unknown/invalid finish data yield `null`, never a fabricated zero. The PNG and dialog explain first-place semantics.

Position arrows are deliberately absent: snapshots/facts overwrite their previous generation, and `lastRatingDelta` is not historical community rank. A reconstruction from current facts cannot prove previously published positions. Tour numbers are also absent: Americano match rounds are not league-series tours. The next-tour placeholder is removed because a published feed announcement can survive cancellation and publication targets do not establish league/division ownership. No additional schedule/provider read, historical-storage feature, migration or recalculation is introduced merely to fill these visual elements.

## Canonical calculation and consistency

The pinned LK1 `community-rating-v1.3.0` formulas, normalizers and tie-breaks live in `src/communities/canonical-rating/`. `provenance.json` identifies the exact upstream repository/commit and SHA-256s. Only relative `.ts` import suffixes were removed; `facts.ts` contains the required upstream type declarations only. Do not change formulas here independently. A future upstream update must explicitly refresh the pin and rerun parity checks.

All reads stay in the database containing the selected community. Read the version-pinned all-time snapshot, then facts with the same `collectedAt`, then check the snapshot generation again. Verify the fact count against `totalEventsPlayed` and replay the canonical all-time rows exactly before computing a selected period. This rejects worker delete/insert gaps and partial/mixed generations instead of exporting incomplete standings. Queries are bounded (5-second server execution, at most 20,000 facts). Missing/incompatible/updating inputs return `RESULTS_EXPORT_RATING_NOT_READY` / `RESULTS_EXPORT_RATING_UPDATING` (503), not a synthetic fallback. A limit violation returns `RESULTS_EXPORT_TOO_LARGE` (503).

Week/custom calculation is on demand and is never persisted or added to the worker's snapshot matrix. Select events first, then normalize/rank over the full canonical member population, and only then apply top N. Calendar periods use the tournament's scheduled date (`eventStartedAtTs`, falling back to occurrence); games and visits use occurrence. Only facts finalized by the published generation are used. Current member/level data and net source-ledger deltas follow canonical LK1 semantics: a custom range is **not** a historical membership/level reconstruction. The PNG displays the source generation timestamp rather than implying freshly read provider results.

## Checks and recovery

- `npm run test:community-results-export`
- `npm run test:community-results-templates` (also included by the export suite)
- `npm run test:auth-rbac`
- `npm run test:tournament-results-export`
- `npm run build`
- `PHAB_TEST_SCRATCH=/absolute/owned/scratch node test/community-results-export.browser.mjs` after build; set `CHROME_PATH` for a non-macOS Chromium executable. Uses an isolated headless profile and synthetic localhost data only.

Browser rehearsal covers all four periods, a real PNG, custom background upload, loading/error/empty/mismatched/stale responses, 390px layout, Escape, focus restoration and unmount. No production access is implied.

`PHAB_TEST_SCRATCH=/absolute/owned/scratch node test/community-results-templates.browser.mjs` additionally produces fifteen real 1080×1350 PNGs and an overview, checks canonical pagination at 1/2/3/10/11/23/50 rows, removes sample/unsupported metadata, verifies literal/injection-like player text, numeric fit, all supplied fonts/logos, and absence of external requests. Chromium is exercised; other browser engines are not certified by this rehearsal.

Stop signal: source/version mismatch, partial generation, permission denial or missing canonical data. Stop method: refuse export and keep download disabled; retry after the existing rating worker publishes a complete generation. No recalculation, index creation, migration, backfill, Node-RED import, database repair or deployment is part of this feature. Reverting this focused source change removes the feature without data rollback. Merge/deploy require separate authority.
