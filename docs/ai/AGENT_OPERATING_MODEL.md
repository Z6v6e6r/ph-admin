# Agent operating model for ph-ab

## Status and intent

This repository uses a risk-routed agent workflow for design, implementation, validation, and review. The primary agent remains accountable for the user outcome, task classification, ownership boundaries, integration, evidence, and final report. Subagents provide bounded work products; their answers are never accepted without checking the repository, diff, or command evidence.

The permanent entry points are:

- `AGENTS.md` — short mandatory repository rules loaded in every session.
- `.agents/skills/agent-orchestration/SKILL.md` — detailed workflow for nontrivial work.
- `.agents/skills/agent-orchestration/references/` — model/risk routing, lifecycle, quality gates, and task packet.
- `.codex/config.toml` — conservative global multi-agent defaults.
- `.codex/agents/*.toml` — narrow custom roles.

## Repository profile

`ph-ab` is not a monorepo. It is one npm/NestJS/TypeScript package using the native MongoDB driver. It includes:

- API bootstrap/composition in `src/main.ts` and `src/app.module.ts`;
- admin auth/RBAC and audit;
- games, tournaments, schedule/rating logic, and public join flows;
- support, messenger, quick replies, outboxes, and Web Push;
- communities, advertising, engagement metrics, and player ratings;
- Viva, LK, Telegram, and Node-RED integration boundaries;
- frameworkless admin/client widgets under `client-sdk/` plus server-served scripts/UI;
- Docker/Nginx/Node-RED deployment and a separate server-147 profile.

There is no checked-in CI workflow, aggregate test script, lint/formatter configuration, public OpenAPI/GraphQL/protobuf schema, mobile application, ORM, or executable/versioned database migration framework. Mongo collection/index evolution is therefore a high-risk explicit design/review concern.

### Confirmed commands

| Purpose | Command | Notes |
| --- | --- | --- |
| Reproducible setup | `npm ci` | Uses `package-lock.json`; deployment/Docker standard |
| Build | `npm run build` | Emits `dist/` and copies SDK assets |
| No-emit TS check | `npx tsc -p tsconfig.build.json --noEmit --incremental false` | Avoids artifact writes |
| Focused package test | `npm run test:<configured-name>` | See `package.json` |
| Other TS test | `npx ts-node test/<name>.test.ts` | Standalone assert-based tests |
| Node-RED guard | `node --test test/nodered-game-slot-conflict-guard.test.mjs` | Focused Node test |
| Dialog index audit | `npm run audit:indexes:dialogs` | Read-only only with intended Mongo env |

`npm run support:cleanup-outbox` changes operational data. It is not a test or release gate and requires explicit authorization plus exact target verification.

## Operating route

Nontrivial tasks follow:

`TASK -> RISK -> MODEL -> REASONING -> AGENTS -> PLAN -> EXECUTION -> VALIDATION -> REVIEW -> RESULT`

Tiny reversible tasks follow:

`TASK -> LOCAL CHECK -> IMPLEMENTATION -> TARGETED VALIDATION -> RESULT`

Risk uses consequence, ambiguity, scale, cross-system reach, irreversibility, novelty, testability, and mechanical repeatability. The score is guidance; auth/RBAC, personal data, secrets, bookings/capacity, payments/prices, production Mongo/index work, external CRM synchronization, public contracts, deployment, and destructive actions are automatically at least R3.

### Stage gates

1. **Intake** — outcome, acceptance evidence, non-goals, constraints, Git state.
2. **Classification** — R0-R4, model/effort, roles, ownership.
3. **Exploration** — targeted execution path, analogues, contracts, tests, runtime boundary.
4. **Plan** — ordered scope, compatibility, validation, rollback/recovery, stop conditions.
5. **Baseline** — safe relevant pre-change checks for R2-R4 when practical.
6. **Implementation** — smallest behavior-complete diff with exclusive write ownership.
7. **Validation** — narrow first, expanded only after stabilization and in proportion to risk.
8. **Diff review** — primary inspects actual changes, artifacts, secrets, contracts, and tests.
9. **Independent review** — significant R2 and all R3-R4; specialist review by trigger.
10. **Remediation/final validation** — resolve blocker/high evidence and rerun affected gates.
11. **Result** — files, commands/results, missing evidence, risks, and external-action status.

Commit, push, merge, rebase, deployment, service restart, Node-RED import, migration, external data mutation, and public-domain changes are separate stages requiring explicit user authorization.

## Model routing

The local model catalog was checked on 2026-08-08 using Codex CLI `0.147.0-alpha.6.5`.

| Task | Primary model/effort | Typical role | Fallback | Minimum evidence |
| --- | --- | --- | --- | --- |
| Tiny one-file mechanical edit (R0) | Luna/Terra low | primary only | Terra low | syntax/diff + narrow test if any |
| Approved repeatable batch (R1+) | Luna low/medium | `batch_worker` with exact file list | Terra low/medium | validated sample + scoped batch diff/tests |
| Read-only map/extraction | Luna medium | `repo_explorer`, `docs_researcher` | Terra medium | paths/symbols/sources + unknowns |
| Standard multi-file implementation | Terra medium/high | `implementer`, `test_engineer` | Sol minimum adequate | no-emit TS + focused tests + diff |
| Complex integration/concurrency | Terra high or Sol high | architect/implementer/integration reviewer | Sol high/xhigh | integration/error/idempotency evidence |
| Auth/security/public contract | Sol high/xhigh | architect/security/reviewer | strongest confirmed model | negative tests + independent review + recovery |
| Data migration/cutover | Sol xhigh | architect/data migration reviewer | strongest confirmed model | dry-run/compatibility/counts/recovery |
| Release readiness | Sol high/xhigh; primary ultra only for independent audit lanes | release auditor + specialists | strongest confirmed model | candidate identity, full relevant gates, rollback, observability |

Confirmed model IDs:

- `gpt-5.6-sol`: low, medium, high, xhigh, max, ultra.
- `gpt-5.6-terra`: low, medium, high, xhigh, max, ultra.
- `gpt-5.6-luna`: low, medium, high, xhigh, max.

`gpt-5.3-codex-spark` was absent from the installed catalog and is not configured. Recheck the catalog before changing permanent IDs; fallback policy lives in `references/model-routing.md`.

## Agent roster

The repository default is Terra medium with a configured cap of four spawned threads. Runtime capacity can be stricter: a host exposing four total active slots permits the primary plus only three concurrent subagents. Always obey the lower live limit and use successive waves; agents should be selected for independent value, not filled to capacity.

| Agent | Trigger | Model/effort | Sandbox |
| --- | --- | --- | --- |
| `repo_explorer` | Trace execution path, files, tests, contracts | Luna medium | read-only |
| `architect` | Ambiguous cross-module/API/data/concurrency design | Sol high | read-only |
| `implementer` | Agreed bounded implementation | Terra medium | workspace-write |
| `batch_worker` | Exact mechanical rule and file list | Luna low | workspace-write |
| `test_engineer` | Reproduction and exclusive test ownership | Terra medium | workspace-write |
| `reviewer` | Independent significant-diff review | Sol high | read-only |
| `security_reviewer` | Auth, data, secrets, webhook/trust risks | Sol xhigh | read-only |
| `docs_researcher` | Official version-specific documentation | Luna medium | read-only |
| `release_auditor` | Final candidate readiness | Sol high | read-only |
| `ui_reviewer` | Client SDK/admin/Tilda/browser-visible behavior | Terra high | read-only |
| `data_migration_reviewer` | Mongo/index/backfill or Viva-to-CUP migration | Sol xhigh | read-only |
| `integration_reviewer` | Viva/LK/Telegram/Node-RED/Web Push/outbox | Sol high | read-only |
| `performance_reviewer` | Measured hot path/index/export/bundle risk | Terra high | read-only |

No mobile reviewer is defined because this checkout has no iOS/Android/mobile code. Create one only if a mobile client enters this repository or a stable cross-repository review boundary is approved.

## Delegation and ownership

Every delegated request uses the agent task packet in the skill references. A write role receives an exclusive file/area list. Closely coupled changes—including one Mongo stored shape/index, one generated SDK/source pair, or one migration/cutover—are serialized under one integration owner. Read-only reviews may run in parallel when they investigate different risk dimensions.

Normal limits:

- R0: no subagent.
- R1: zero or one.
- R2: one to three.
- R3: two to four.
- broad R4 audit: three to six across successive waves, never more than both the configured cap and the live host capacity concurrently.

Subagents do not recursively form teams unless the primary explicitly grants and bounds that authority.

## Project-specific quality expectations

- A compile proves types, not RBAC, persistence, provider delivery, or UI behavior.
- A health endpoint proves process health, not the requested user journey.
- An outbox row proves enqueueing, not Telegram/Node-RED/Web Push delivery.
- Source labels or docs do not prove the served client bundle or deployed SHA.
- Startup-created Mongo indexes do not prove a safe schema/data migration.
- Migration design documents describe proposals until ownership and stage gates are approved.
- Production evidence must name the exact runtime target and distinguish local, Docker, server-147, Nano/staging, and public production.

## Routing smoke scenarios

These are configuration simulations, not executed product changes.

| Scenario | Risk and route | Agents | Required checks |
| --- | --- | --- | --- |
| A. Change one component label | R0; Luna/Terra low; shortened route | none | inspect actual asset, syntax/diff, focused UI check if available |
| B. Fix ordinary backend bug in several files | R1/R2; Terra medium/high | optional explorer; reviewer only for significant diff | reproduce, no-emit TS, targeted tests, diff review |
| C. Add API scenario consumed by mobile | minimum R2/R3 due public cross-client contract; Sol/Terra design then Terra implementation | explorer, architect if ambiguous, implementer/test engineer, integration/contract review; no local mobile reviewer | compatibility, contract/negative tests, old-client fallback, external mobile evidence required |
| D. Change payment/subscription calculation | automatic R3; Sol xhigh analysis, Terra high implementation | architect, implementer, test engineer, security/integration reviewer, independent reviewer | amount/currency, idempotency, duplicate callbacks, race/partial failure, reconciliation, rollback |
| E. Full release-readiness audit | R4; primary Sol ultra only because lanes are independent, otherwise Sol xhigh | parallel read-only backend/data/security/integration/UI/release lanes, never above both configured and live caps | candidate SHA, relevant full gates, migration/config, real runtime evidence, observability, rollback, consolidated GO/NO-GO |

The model correctly avoids spawning agents for A, scales selectively for B/C, applies automatic critical routing for D, and uses read-only parallelism without conflicting writes for E.

## Ready-to-use examples

Small task:

> Change the admin label in the named client file. Classify it as R0, use no subagents, preserve the dirty worktree, and run the smallest applicable asset/diff check.

Complex feature:

> Add a new tournament API behavior. Use the orchestration skill: have `repo_explorer` map the controller/service/persistence/client path, settle compatibility, assign exclusive implementation/test ownership, run no-emit TS and focused tests, then use `reviewer` if the diff is significant.

Critical bug:

> Diagnose an RBAC bypass. Treat it as at least R3. Keep exploration and security review read-only, reproduce the unauthorized path safely, implement a narrow default-deny fix with negative tests, obtain independent review, and do not deploy without a separate approval.

## Known limitations

- Project-scoped `.codex/config.toml` loads only for trusted repositories.
- Custom-agent authoring format may evolve in future Codex versions; strict-config/TOML validation should be rerun after upgrades.
- There is no aggregate test/lint/format/CI gate in this repository today.
- Current production topology, deployed SHAs, Mongo indexes/permissions, and external Viva/LK/Node-RED contracts are drift-prone and must be revalidated live for each operational task.
- This setup does not itself grant browser sessions, provider credentials, production access, or mutation authorization.

## Maintenance

After meaningful tasks, add permanent rules only for repeated evidence, stable commands/invariants, or explicit long-term user direction. Keep `AGENTS.md` short; place workflow detail in the skill, domain-specific detail near its subsystem when truly different, and record material changes in `AGENT_RULES_CHANGELOG.md`. Never persist secrets, personal data, transient incident details, or one-off workarounds.
