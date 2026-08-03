# ph-ab engineering rules

These rules are mandatory for every change in this repository.

## Change safety

- Preserve all pre-existing modified and untracked files. Never reset, overwrite, reformat, stash, or commit unrelated user work.
- Use one focused branch/worktree per task and keep the diff limited to the approved scope.
- Never commit secrets, local environment values, production exports, or temporary diagnostic artifacts.
- Run proportionate tests and builds and report checks that could not be completed.

## Mandatory staged delivery workflow

Every task uses the following stage gates. Approval of one stage never authorizes a later stage.

1. **Implement and verify in isolation.** Identify the base `origin/main` SHA, use a focused branch/worktree, preserve existing dirty changes, implement only the requested scope, run relevant checks, and create a focused checkpoint commit in the task branch. Do not merge, push, or deploy.
2. **User verification.** Provide the runnable result, changed-file summary, checks, checkpoint SHA, and limitations. The user verifies the result. Corrections remain in the same task branch and get another checkpoint commit.
3. **Integrate into `main`.** Only after explicit approval, refresh `origin/main`, inspect the final diff, integrate only the approved task branch into local `main`, and rerun proportionate checks. Do not push or deploy.
4. **Push `main`.** Only after separate explicit approval, show the outgoing commits, push local `main`, confirm the remote SHA, and check required CI. Do not deploy.
5. **Deploy and post-check.** Only after another explicit approval, deploy an immutable artifact built from the confirmed pushed SHA to the approved environment. Verification is part of this stage: confirm the served release/image SHA, health/readiness, and the affected authenticated UI/API/worker/persistence journey. Never deploy a dirty tree or edit server code manually.

At the end of every completed stage, stop, report evidence, and ask exactly one direct transition question: `Приступать к следующему этапу: <название этапа>?` Do not start it until the user explicitly agrees. Never infer permission for integration, `main` push, deploy, live data mutation, or rollback from an earlier approval.

If a stage fails or is blocked, stay in that stage, report the blocker, and ask for direction. A post-deploy fix returns to a focused task/hotfix branch and follows the same gates.
