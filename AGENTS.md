# ph-ab engineering rules

These rules are mandatory for every change in this repository.

## Change safety

- Preserve all pre-existing modified and untracked files. Never reset, overwrite, reformat, stash, or commit unrelated user work.
- Use one focused branch/worktree per task and keep the diff limited to the approved scope.
- Never commit secrets, local environment values, production exports, or temporary diagnostic artifacts.
- Run proportionate tests and builds and report checks that could not be completed.

## Risk-based delivery workflow

Classify the highest-risk intended change as R0-R4 and use the global Fast, Spark, Main,
or Critical lane. A scoped development request authorizes one continuous reversible
task-branch cycle: focused worktree/branch, implementation, proportionate checks,
checkpoint commits, push of that same `codex/*` or `agent/*` branch, Draft PR creation,
CI readback and in-scope CI correction. Do not pause merely because one of those steps
completed.

Keep explicit human gates before merge, direct push to `main`/protected branches,
force push, deploy, service restart, Node-RED import, migration or backfill execution,
live/shared data mutation, secrets/keys, permission widening, routing/ingress changes,
payments/refunds, external messages, destructive rollback, or any other irreversible
trust-boundary transition. A Draft PR or green CI never authorizes those actions.

Use focused checks for R0-R2 and expand only when changed files, shared contracts,
dependencies, root/CI/deploy configuration, or critical risk require it. Do not repeat an
identical successful check without changed source, inputs, environment, or a new
hypothesis. If one part is blocked, continue independent in-scope work; stop for missing
material product authority, suspected credential/PII exposure, scope expansion, an
inseparable broken baseline, unavailable required access, or a prohibited next action.

## Project

`ph-ab` is a single-package NestJS 10 / TypeScript backend for CUP administration. It owns admin RBAC, games and tournaments, support/messaging, communities, advertising, ratings, Web Push, embedded admin/client JavaScript, and integrations with MongoDB, Viva/LK, Telegram, and Node-RED. Docker/Nginx and server-147 deployment assets live under `deploy/`.

## Commands

- Install reproducibly: `npm ci` (`npm install` is acceptable only for intentional dependency work).
- Build: `npm run build`. This emits `dist/` and copies SDK assets, so inspect `client-sdk/` before and after when the worktree is dirty.
- Type-only check without emission: `npx tsc -p tsconfig.build.json --noEmit --incremental false`.
- Run a focused configured test such as `npm run test:auth-rbac`, `npm run test:player-ratings`, or another `test:*` script from `package.json`.
- Run an unlisted TypeScript test directly: `npx ts-node test/<name>.test.ts`.
- Node-RED guard: `node --test test/nodered-game-slot-conflict-guard.test.mjs`.
- Dialog index read-only audit: `npm run audit:indexes:dialogs` (requires the intended Mongo environment).

There is no configured aggregate `test`, lint, formatter, or CI command. Do not claim those gates passed and do not invent substitute project policy. `npm run support:cleanup-outbox` mutates operational data and is never a validation command.

## Mandatory workflow

Before any nontrivial feature, bug fix, audit, refactor, API change, migration, integration change, or release work, read and apply `.agents/skills/agent-orchestration/SKILL.md`.

1. Restate the user outcome and acceptance evidence.
2. Inspect `git status` and preserve every pre-existing change.
3. Classify risk R0-R4 before editing. Auth/RBAC, personal data, bookings/capacity, prices/payments, Mongo schema/index changes, external integrations, public contracts, secrets, deployment, and production operations are at least R3.
4. Choose the smallest adequate model/reasoning and the fewest agents. A tool call is preferable to a subagent for a short fact lookup.
5. Give every subagent a bounded task packet. Two write agents must never own the same file, component, collection/schema change, or tightly coupled area. The primary agent integrates and verifies all results.
6. Make the smallest behavior-complete diff. Do not mix unrelated refactoring, broad formatting, dependency upgrades, or generated artifacts.
7. Validate narrowly first, then expand in proportion to risk. Never hide failures, weaken assertions, or call a mock/health response proof of persistence or external delivery.
8. Review the actual final diff for scope, secrets, debug code, generated files, public behavior, error contracts, and missing negative tests.
9. Review by trigger: R0 uses self-review; R1 normally uses self-review; R2 uses at most one independent reviewer when complexity or a domain trigger justifies it; R3 uses one specialist per actual risk; R4 uses two genuinely independent risk perspectives. Keep reviewers read-only by default.

## Project invariants

- Treat `src/main.ts` and `src/app.module.ts` as the runtime composition boundary. Trace controller -> service -> persistence/integration -> observable result for failures.
- Auth and authorization are separate. Preserve default-deny intent, object/station scope, tenant isolation, session/token revocation behavior, auditability, and legacy-header compatibility unless an approved contract explicitly changes them.
- MongoDB has no versioned executable migration framework here. Any collection/index/backfill change needs an explicit forward plan, compatibility window, repeatability check, verification query, and rollback or recovery plan.
- Viva/LK/Telegram/Node-RED/Web Push calls cross trust and consistency boundaries. Specify source of truth, timeout, retry/backoff, idempotency/deduplication, ordering, reconciliation, and observability.
- Games/tournaments changes must protect capacity, concurrent joins, duplicate requests, timezone, cancellation, pricing snapshots, result determinism, and historical auditability.
- `client-sdk/phab-admin-panel.js` and served client scripts are product UI. Verify loading/empty/error states, permissions, browser console/network behavior, and the actual served artifact when changed.
- Never inspect, print, copy, or commit real `.env*` values. Example env files may contain names/placeholders only.
- Deployment assets are not deployment authorization. Task-branch commit/push/Draft PR are reversible development actions; live data mutation, Node-RED import, service restart, migration, merge/protected-branch push, deploy, or production/public-domain change still require explicit target-specific approval. Preserve a rollback path and revalidate the actual target runtime.
- Local source/build success is not production proof. Distinguish local, Docker, server-147, Nano/staging, and public production evidence.

## Contracts, reviews, and handoff

Do not change public routes, DTOs, error/status semantics, stored shapes, env contracts, or client payloads without compatibility analysis and relevant contract/negative tests. Documentation proposals under `docs/migration/` are not automatically approved runtime architecture.

Do not merge, push protected branches, deploy, mutate external data, or overwrite user changes without explicit approval. Rebase only the clean current task branch onto its configured protected base; never force push.

The final answer must list changed files, exact commands run and results, skipped or blocked checks, residual risks, and whether commit/push/deploy occurred. Record stable new project rules only after repeated evidence or an explicit long-term user instruction; put detail in the orchestration skill and log material rule changes in `docs/ai/AGENT_RULES_CHANGELOG.md`.

Detailed policy: `.agents/skills/agent-orchestration/references/`. Human overview: `docs/ai/AGENT_OPERATING_MODEL.md`.
