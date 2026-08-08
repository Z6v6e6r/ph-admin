# Model and risk routing

## Confirmed catalog

Confirmed on 2026-08-08 with `codex-cli 0.147.0-alpha.6.5` and `codex debug models`:

| Model | Use | Confirmed reasoning |
| --- | --- | --- |
| `gpt-5.6-sol` | Architecture, ambiguity, security, critical incidents, migrations, release gates, final high-value review | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-terra` | Default implementation, multi-file bugs, integrations, tests, standard review, read-heavy support work | low, medium, high, xhigh, max, ultra |
| `gpt-5.6-luna` | Narrow repeatable work, extraction, templated docs/tests, mechanical batches | low, medium, high, xhigh, max |

`gpt-5.3-codex-spark` was not present in the local model catalog. Do not configure or request it here until a future catalog check confirms it.

Fallbacks:

- Luna unavailable: Terra low/medium.
- Terra unavailable: Sol at the minimum adequate effort.
- Sol unavailable: strongest visible confirmed model, high/xhigh, and record the limitation.
- Never silently downgrade a critical architectural/security/migration decision to Luna.

Catalogs drift. Re-run `codex debug models` before changing permanent model IDs or when a configured model fails.

## Effort

- low: deterministic search, one-file mechanical edits, formatting, applying a settled decision.
- medium: normal exploration/implementation, several related files, standard tests and docs comparison.
- high: multi-module logic, integration behavior, concurrency, retry/idempotency, complex debugging/review.
- xhigh: architecture, auth, permissions, public contracts, migrations, security, production incidents, payments.
- max: one exceptionally hard problem after xhigh is insufficient and decomposition would not help.
- ultra: primary orchestrator only when independent parallel lanes materially improve a broad audit/release review. Do not assign ultra to ordinary subagents.

## Risk score

Estimate without ceremony:

- C consequence 0-4
- A ambiguity 0-3
- S scale 0-3
- X cross-system reach 0-3
- R irreversibility 0-3
- N novelty 0-2
- T automated testability 0-2
- P mechanical repeatability 0-2

`score = 2C + A + S + X + R + N - T - P`

| Class | Typical score | Default route |
| --- | ---: | --- |
| R0 | 0-3 | One agent, Luna/Terra low; local validation |
| R1 | 4-6 | Terra medium; optional explorer; targeted tests/typecheck |
| R2 | 7-10 | Terra high or Sol high; explorer; significant-diff review |
| R3 | 11-14 | Sol high/xhigh owner; 2-4 distinct roles; specialist review; rollback/observability |
| R4 | 15+ | Sol xhigh/max or justified primary ultra; invariants; two reviews; release gate |

Minimum R3 override: auth/RBAC, personal data, secrets, destructive operations, bookings/capacity, prices/payments/refunds/subscriptions, production Mongo/index/backfill work, external CRM synchronization, public API compatibility, rating history, release signing, deployment, or public production changes.

## Role route

- `repo_explorer`: Luna medium, read-only; Terra medium fallback.
- `architect`: Sol high/xhigh, read-only.
- `implementer`: Terra medium/high, workspace-write.
- `batch_worker`: Luna low/medium, workspace-write, exact file rule only.
- `test_engineer`: Terra medium/high, workspace-write only in test-owned files.
- `reviewer`: Terra high for normal diffs; Sol high/xhigh for critical diffs.
- `security_reviewer`: Sol high/xhigh, read-only.
- `docs_researcher`: Luna medium; Terra high for conflicting/version-specific sources.
- `release_auditor`: Sol high/xhigh, read-only.
- Optional project roles are triggered only as documented in their profile descriptions.
