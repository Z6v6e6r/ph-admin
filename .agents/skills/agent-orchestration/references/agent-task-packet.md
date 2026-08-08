# Agent task packet

Every delegated task must contain:

1. **MISSION** — one concrete deliverable.
2. **CONTEXT** — only facts needed to work.
3. **SCOPE** — allowed modules, files, symbols, systems.
4. **NON-GOALS** — prohibited adjacent work.
5. **INPUTS** — exact paths, diff/base, contracts, known evidence.
6. **QUESTIONS TO ANSWER** — verifiable questions.
7. **ACCEPTANCE CRITERIA** — observable completion.
8. **VALIDATION** — allowed/required commands and evidence.
9. **OUTPUT FORMAT** — concise structured result.
10. **WRITE OWNERSHIP** — none, or an exclusive file list/area.
11. **MODEL BUDGET** — model and reasoning with rationale.
12. **STOP CONDITIONS** — ambiguity, overlap, permission, secret, external mutation, failing baseline, or architecture conflict that returns control to the primary.

## Compact template

```text
MISSION:
CONTEXT:
SCOPE:
NON-GOALS:
INPUTS:
QUESTIONS TO ANSWER:
ACCEPTANCE CRITERIA:
VALIDATION:
OUTPUT FORMAT:
WRITE OWNERSHIP:
MODEL BUDGET:
STOP CONDITIONS:
```

Read-only agents return evidence with file/symbol references and unknowns. Write agents return changed files and commands actually run. Reviewers lead with severity-ranked findings and end with `APPROVE`, `APPROVE WITH NOTES`, or `REQUEST CHANGES`. The primary agent independently checks all material claims.
