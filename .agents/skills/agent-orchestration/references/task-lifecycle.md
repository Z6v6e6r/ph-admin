# Task lifecycle

## Intake and classification

1. Separate the desired business outcome from the suggested implementation.
2. Define observable acceptance criteria, non-goals, constraints, and unknowns.
3. Inspect Git state and identify dirty/generated/secret-bearing paths.
4. Classify R0-R4 and choose model, effort, roles, and write ownership.

## Targeted exploration

Trace the relevant controller/entry point through service, persistence/integration, and observable response. Find analogous code, tests, stored shapes, environment contracts, client consumers, and deployment/runtime boundaries. Stop once evidence is sufficient.

## Plan

For R2-R4 capture:

- affected modules and public/stored contracts;
- ordered steps and agent/file ownership;
- baseline and focused-to-broad validation;
- error/negative/concurrency cases;
- compatibility and rollout/recovery;
- observability evidence;
- stop conditions and done criteria.

Architecture, migration design, and contract decisions precede code. Final review follows integration. Do not parallelize tightly coupled writes.

## Baseline and implementation

For R2-R4, run a safe relevant baseline where practical. Label existing failures. Avoid builds that rewrite dirty generated artifacts unless they are in scope and snapshotted.

Implement the smallest complete behavior using current patterns. Preserve API and stored-shape compatibility. Add focused tests for the real failure/success path, including negative and boundary behavior. Do not loosen assertions or catch-and-ignore errors.

## Validation and review

1. Run narrow formatter/lint/typecheck/tests only if configured and applicable.
2. Expand to integration/build/browser/runtime evidence as risk requires.
3. Inspect final `git diff`, untracked files, lockfiles, secrets, debug code, TODOs, errors/status changes, and generated assets.
4. Obtain review by trigger: normally none for R0/R1, at most one for R2, one specialist per actual R3 risk, and two distinct perspectives for R4.
5. Remediate blocker/high findings and rerun affected gates.
6. Confirm pre-existing user changes remain intact.

## Failure protocol

Classify a failure as environment, dependency, compilation, logic, test-data, flaky, permission, missing-service, network, or baseline. Form one hypothesis and test it minimally. After two failed attempts on the same hypothesis, stop and reassess; escalate only the missing dimension. Never disable the test or broaden permissions to force green.

## Result

Lead with the outcome. List changed files, actual commands/results, unverified evidence, residual risks, required next step, and commit/task-branch-push/Draft-PR/merge/deploy/data-mutation status. Reversible task-branch work continues without intermediate approval; a prohibited live or irreversible stage starts only after exact user approval.
