# Community results image export

Owner: CUP communities UI/backend. Audience: existing community staff roles, with the account's station cap preserved. Outcome: the community header opens a background/top-N/period dialog, previews real ranking rows and downloads a PNG locally. No rating, membership or provider writes occur.

## Read contract

`GET /api/communities/:id/results-export?period=month|week|all|custom&places=1..50`

Custom requires strict `from=YYYY-MM-DD&to=YYYY-MM-DD`; both dates are included. Other periods reject date parameters. Moscow calendar months and Monday-based calendar weeks are used. Response is `private, no-store` and includes `communityId`, period/bounds, `timeZone`, `calculationVersion`, `dataAsOf` and allowlisted `{rank,name,score}` rows. Member phones/client IDs are not authorization inputs and are never returned. Phone-like legacy display-name fallbacks become `Игрок N`.

The new route uses the existing community staff roles, plus a fail-closed station check for station-capped accounts. Export resolves the trusted raw station association preserved by the existing Mongo mapper, without changing the general community card contract. The old LK ranking route, roles and client cache are unchanged. Phone/ID-derived display names are neutralized without changing ranks or scores. The upload remains local (PNG/JPEG/WebP, 10 MB and 16 megapixels maximum); no user-uploaded template storage or third-party rendering service is added.

## Approved branded layouts

The supplied local `Шаблоны рейтинг.fig` replaces all previous templates and custom backgrounds with one composition in three divisions: Старт (D), Рокот (D+/C), Смэш (C/C+). Its archive hash, frame IDs, dimensions and extracted asset hashes are recorded in `assets/community-results-templates/provenance.json`. The original 720×900 geometry scales uniformly to 1080×1350. Fixed header artwork uses the supplied reference renders to retain Figma image colour adjustments; the sample subtitle is removed over the exact Figma gradient. Crown/star vectors and layout geometry come from the supplied Figma file; dynamic player text uses existing PadlHub RF Dewi / Inter Display / Source Code Pro fonts.

The build emits version `vnd-results-figma-v2` in `dist/client-sdk/community-results-assets.json`, embedding the three HTML layouts and their local fonts/SVGs. Fixed-name `/api/client-script/community-results-templates.js` and `/api/client-script/community-results-assets.json` serve presentation assets only. Assets load on demand without passing credentials. The browser rasterizes a self-contained SVG/HTML image and saves PNG locally. Missing graphics/fonts and rasterization failures keep download disabled. The UI, renderer and asset pack must be released together; mixed old/new versions fail closed.

The dialog requires an explicit division. This changes the visual label, grade and palette without filtering players or changing the selected community. The subtitle identifies the actual community and selected period. Long community names ellipsize while retaining the period. The source-generation timestamp and the definition of tournament wins remain in the dialog, outside the supplied composition.

Each PNG contains up to ten canonical rows; up to fifty places produce up to five pages. The first-place crown and lavender highlight depend on canonical rank 1, including tied ranks; subsequent pages never promote their first row to first place. Unused rows are absent. Names ellipsize, numeric scores reduce in size without losing digits, and unknown statistics remain blank in their original columns. The exact RF Dewi Black font binary for first-place scores was not supplied; these use the existing RF Dewi Ultrabold font. The current read contract has no nickname, so the reference's nickname line is left empty rather than populated with sample text or private identifiers.

### Optional statistics and unavailable metadata

Only requests with `details=templates-v1` add `statistics: {tournamentsPlayed, tournamentsWon}` to rows. The default response keeps exactly `{rank,name,score}`, preserving existing clients. Counts use the same selected facts, generation and calendar boundaries as scores. Participation comes from the canonical aggregate. `tournamentsWon` means canonical tournament facts whose finish is first place, **not** match wins inside a tournament. The upstream canonical extractor can infer place from standings row order; these are canonical first-place records, not independently re-audited provider outcomes. Unknown/invalid finish data yield `null`, never a fabricated zero. The PNG and dialog explain first-place semantics.

Position arrows are deliberately absent: snapshots/facts overwrite their previous generation, and `lastRatingDelta` is not historical community rank. A reconstruction from current facts cannot prove previously published positions. Tour numbers are also absent: Americano match rounds are not league-series tours. The next-tour placeholder is removed because a published feed announcement can survive cancellation and publication targets do not establish league/division ownership. No additional schedule/provider read, historical-storage feature, migration or recalculation is introduced merely to fill these visual elements.

## Canonical calculation and consistency

The pinned LK1 `community-rating-v1.3.0` formulas, normalizers and tie-breaks live in `src/communities/canonical-rating/`. `provenance.json` identifies the exact upstream repository/commit and SHA-256s. Only relative `.ts` import suffixes were removed; `facts.ts` contains the required upstream type declarations only. Do not change formulas here independently. A future upstream update must explicitly refresh the pin and rerun parity checks.

All reads stay in the database containing the selected community. Read the version-pinned all-time snapshot, then facts with the same `collectedAt`, then check the snapshot generation again. Verify the fact count against `totalEventsPlayed` and replay the canonical all-time rows exactly before computing a selected period. This rejects worker delete/insert gaps and partial/mixed generations instead of exporting incomplete standings. Queries are bounded (5-second server execution, at most 20,000 facts). Missing/incompatible/updating inputs return `RESULTS_EXPORT_RATING_NOT_READY` / `RESULTS_EXPORT_RATING_UPDATING` (503), not a synthetic fallback. A limit violation returns `RESULTS_EXPORT_TOO_LARGE` (503).

Week/custom calculation is on demand and is never persisted or added to the worker's snapshot matrix. Select events first, then normalize/rank over the full canonical member population, and only then apply top N. Calendar periods use the tournament's scheduled date (`eventStartedAtTs`, falling back to occurrence); games and visits use occurrence. Only facts finalized by the published generation are used. Current member/level data and net source-ledger deltas follow canonical LK1 semantics: a custom range is **not** a historical membership/level reconstruction. The dialog displays the source generation timestamp rather than implying freshly read provider results.

## Checks and recovery

- `npm run test:community-results-export`
- `npm run test:community-results-templates` (also included by the export suite)
- `npm run test:auth-rbac`
- `npm run test:tournament-results-export`
- `npm run build`
- `PHAB_TEST_SCRATCH=/absolute/owned/scratch node test/community-results-export.browser.mjs` after build; set `CHROME_PATH` for a non-macOS Chromium executable. Uses an isolated headless profile and synthetic localhost data only.

Browser rehearsal covers all four periods, a real Figma PNG, loading/error/empty/mismatched/stale responses, 390px layout, Escape, focus restoration and unmount. No production access is implied.

`PHAB_TEST_SCRATCH=/absolute/owned/scratch node test/community-results-templates.browser.mjs` additionally produces three real 1080×1350 PNGs and an overview, checks canonical pagination at 1/2/3/10/11/23/50 rows, removes sample/unsupported metadata, verifies literal/injection-like player text, numeric fit, all supplied fonts/logos, and absence of external requests. Chromium is exercised; other browser engines are not certified by this rehearsal.

Stop signal: source/version mismatch, partial generation, permission denial or missing canonical data. Stop method: refuse export and keep download disabled; retry after the existing rating worker publishes a complete generation. No recalculation, index creation, migration, backfill, Node-RED import, database repair or deployment is part of this feature. Reverting this focused source change removes the feature without data rollback. Merge/deploy require separate authority.
