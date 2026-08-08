---
name: agent-orchestration
description: Use for nontrivial ph-ab features, complex bugs, audits, refactors, API or Mongo changes, integrations, migrations, security, release readiness, multi-module work, long plans, or subagent coordination. Classifies risk, selects the minimum adequate model and reasoning, delegates bounded exploration/implementation/review, and enforces evidence-based validation. Do not use for a tiny text-only or fully mechanical one-file edit.
---

# Agent orchestration

Own the result as the primary agent. Subagent output is evidence to verify, never completion by itself.

## Route

For nontrivial work, follow:

`TASK -> RISK -> MODEL -> REASONING -> AGENTS -> PLAN -> EXECUTION -> VALIDATION -> REVIEW -> RESULT`

For a truly small and reversible change, use:

`TASK -> LOCAL CHECK -> IMPLEMENTATION -> TARGETED VALIDATION -> RESULT`

## 1. Intake and baseline

1. State the user outcome, acceptance criteria, non-goals, and required observable evidence.
2. Read `AGENTS.md`, inspect `git status`, and identify pre-existing changes before editing.
3. Trace only the relevant runtime path and existing tests/contracts. Do not scan the whole repository.
4. For R2-R4, establish a safe baseline where practical. Avoid commands that rewrite dirty generated files; record why a baseline was skipped.

## 2. Classify and route

Score the task using `references/model-routing.md`. Apply critical overrides even when the diff is small. Select the minimum model/reasoning likely to produce a correct result.

- R0: primary agent only; short local check and targeted validation.
- R1: primary Terra medium; optional one read-only explorer.
- R2: Terra high or Sol high; one explorer, bounded implementation, and independent review for significant diffs.
- R3: Sol high/xhigh owns analysis; 2-4 specialized roles only when scopes differ; independent review and relevant security/integration/migration gate.
- R4: Sol xhigh/max, or primary Sol ultra only for genuinely parallel audits; explicit invariants, rollback, two review perspectives, and no automatic production action.

The currently confirmed catalog and fallbacks are in `references/model-routing.md`. Never use an unconfirmed model ID or reasoning level.

## 3. Decide whether to delegate

Delegate only when one of these is true:

- a read-only exploration can run independently;
- a specialist trust boundary needs independent review;
- implementation and testing have non-overlapping ownership;
- a wide audit has genuinely independent lanes;
- an independent cross-check is justified by R3-R4 risk.

Do not delegate a task solvable by a few local reads/tool calls. Do not duplicate scopes for comfort. Use at most 1 agent for R1, 1-3 for R2, 2-4 for R3, and 3-6 for a justified R4 audit. The repository config caps spawned threads at four, but the live host limit is stricter when it has fewer slots; for example, four total active slots allow the primary plus only three concurrent subagents. Use successive waves rather than failed spawns.

Before spawning, write a task packet from `references/agent-task-packet.md`. Start with one explorer map, then give later agents narrow file/symbol inputs. Assign one integration owner. Write ownership must not overlap; serialize tightly coupled changes.

## 4. Plan and execute

Use `references/task-lifecycle.md` for R2-R4 or any multi-agent task. The plan must identify affected areas, order, ownership, validation, compatibility, rollback/recovery, model route, stop conditions, and done criteria.

Prefer a minimal behavior-complete diff and existing patterns. Do not silently redesign architecture, widen permissions, change dependencies, regenerate unrelated artifacts, or fix adjacent issues. Put unrelated findings in a follow-up list.

If two attempts fail with the same hypothesis, stop that branch, classify the failure, revisit assumptions, and escalate one dimension only: context, reasoning, model, or specialist.

## 5. Validate and review

Read `references/quality-gates.md` for the risk-class gates and domain invariants. Start with focused tests/typecheck, then widen after the change stabilizes.

The primary agent must inspect the actual diff and independently verify claimed commands/results. For R3-R4, the reviewer receives the original outcome, acceptance criteria, and diff—not a persuasive implementation summary. Resolve blockers/high findings with evidence and rerun affected gates.

Never treat a compile, health endpoint, mock, or subagent statement as proof of external delivery, authorization, persistence, migration safety, or the rendered user journey.

## 6. Result and learning

Report:

- outcome and key decisions;
- files changed;
- commands actually run and exact pass/fail scope;
- evidence not obtained;
- residual risks and required next action;
- commit/push/deploy/data-mutation status.

After meaningful work, check whether a repeated failure exposed a stable project rule. Update permanent instructions only when repeated evidence or an explicit long-term instruction justifies it; never store secrets, personal data, transient paths, or one-off workarounds.
