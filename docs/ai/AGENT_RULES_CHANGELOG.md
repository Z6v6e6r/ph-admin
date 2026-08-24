# Agent rules changelog

## 2026-08-24 — Risk-based autonomous task-branch delivery

Reason: remove repeated approval and validation cycles from reversible R0-R2 work while
preserving every critical production and trust-boundary gate.

Changed:

- replaced universal stage stops with Fast, Spark, Main, and Critical lanes using R0-R4;
- authorized one continuous task-branch loop through focused commits, same-branch push,
  Draft PR, CI readback, and in-scope CI fixes;
- retained explicit approval for merge/protected branches, deploy, live/shared mutation,
  migrations, secrets, permissions, routing, payments, messages, and destructive actions;
- reduced concurrent spawned threads from four to two;
- changed generic significant-diff review to domain-triggered review and prohibited
  unchanged duplicate checks;
- made use of the globally managed Spark worker conditional on its availability without
  duplicating its model profile;
- clarified that the cap is two spawned-agent threads in addition to the primary and that
  R3 uses one specialist per actual trigger, with a second reviewer only for a distinct risk.

No application code, dependencies, runtime configuration, live data, or deployment was
changed.

## 2026-08-08 — Initial repository operating system

Reason: establish a permanent, auditable, cost-aware workflow for Codex engineering in `ph-ab` while preserving a heavily modified user worktree.

Added:

- short mandatory root `AGENTS.md` with project commands, risk overrides, critical invariants, approval boundaries, and evidence requirements;
- repo skill `agent-orchestration` with progressive-disclosure references for model/risk routing, task lifecycle, quality gates, and agent task packets;
- conservative project multi-agent defaults and narrow custom profiles;
- human operating model, routing simulations, roster, limitations, and maintenance policy.

Key decisions:

- confirmed models are Sol, Terra, and Luna; Spark was absent and is not configured;
- repository concurrency is capped at four spawned threads and further limited by the live host (four total slots means at most three concurrent subagents);
- R0 always stays on the primary agent; `batch_worker` starts with an approved repeatable R1+ batch;
- no mobile profile because this checkout contains no mobile application;
- UI, data-migration, integration, and performance profiles are justified by client SDK/admin UI, Mongo/Viva migration work, external connectors, and measured/indexed large-data paths;
- no permissions, approval policy, MCP server, dependency, product code, runtime, data, or deployment changes are part of this setup.

Expected effect: future sessions classify risk first, delegate only bounded independent work, prevent overlapping writes, validate claims with applicable commands/runtime evidence, and stop for approval before external or irreversible stages.
