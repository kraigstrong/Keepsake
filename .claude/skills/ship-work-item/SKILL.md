---
name: "ship-work-item"
description: "Use once a work item's plan has cleared the decision gate and is approved to build — steps 5-8 of the work-item lifecycle (CLAUDE.md): implementation through the human review packet. This skill performs the implementation itself as its first step; don't wait until the code already exists to invoke it."
---

Verifying and shipping a Keepsake work item. This produces evidence, not a vibe check — don't call a work item done without checking each step.

## 1. Implementation

If not already done this session: delegate the approved scope to a bounded implementation subagent, or implement directly for a trivial item — see `AGENTS.md`'s Delegation section for when delegation earns its keep. Give it the objective, scope, non-goals, acceptance criteria, and explicit boundary language: stay in scope, escalate a consequential decision it discovers rather than deciding it. Run the canonical commands (`AGENTS.md`) after implementation, not just at the end.

## 2. Independent verification, scaled to risk

Assume the implementation may be wrong — don't trust a subagent's own summary of what it did. A trivial, low-risk change (a copy fix, a config value) can skip straight to step 3 on the main agent's own read of the diff. Anything touching RLS, auth, external input, destructive operations, or a migration gets a genuinely separate look: a fresh subagent that didn't write the code, or `/code-review` at an effort level matched to the risk, checking correctness, tests, regressions, security implications, architecture consistency, and scope creep against the work item's acceptance criteria — not just "does it look done." Run `.claude/skills/security-check` whenever the touched categories match its trigger list. Findings come back ranked by severity with concrete evidence (file/line, a real failure scenario), not asserted.

## 3. Final review

Read the actual diff, the actual tests, and the verification findings yourself — not a summary of a summary. Did this actually solve the work item's stated problem, correctly, within scope? Decide: approve, request a targeted fix (loop back to step 1, then re-verify just the affected behavior — don't restart the whole lifecycle for a narrow fix), escalate a decision, or split remaining work into a new work item rather than silently expanding this one's scope.

## 4. Human review packet

The PR description carries `Closes #N` so merging closes the issue — **there is no status file to update, and no status commit to make.** Package the result using the `pr-ready` skill: what changed, why, what verification ran and what it found (and how each finding was resolved), risks or limitations, any follow-up work items discovered, and any critical decisions made along the way — flagged explicitly, not something to miss on a quick mobile review. Give the exact `git push` command and the filled-in PR description; the developer pushes and opens the PR themselves, unless they've explicitly asked you to do it directly.
