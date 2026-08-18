---
name: "ship-work-item"
description: "Use once a work item's implementation is done and it's time to verify, review, and package it for the developer — steps 5-8 of the work-item lifecycle (CLAUDE.md): implementation through the human review packet. Do not use mid-implementation; use once the approved scope is actually built."
---

Verifying and shipping a Keepsake work item. This produces evidence, not a vibe check — don't call a work item done without checking each step.

## 1. Implementation

If not already done this session: delegate the approved scope to a bounded implementation subagent, or implement directly for a trivial item — see `AGENTS.md`'s Delegation section for when delegation earns its keep. Give it the objective, scope, non-goals, acceptance criteria, and explicit boundary language: stay in scope, escalate a consequential decision it discovers rather than deciding it. Run the canonical commands (`AGENTS.md`) after implementation, not just at the end.

## 2. Independent verification, scaled to risk

Assume the implementation may be wrong — don't trust a subagent's own summary of what it did. A trivial, low-risk change (a copy fix, a config value) can skip straight to step 3 on the main agent's own read of the diff. Anything touching RLS, auth, external input, destructive operations, or a migration gets a genuinely separate look: a fresh subagent that didn't write the code, or `/code-review` at an effort level matched to the risk, checking correctness, tests, regressions, security implications, architecture consistency, and scope creep against the work item's acceptance criteria — not just "does it look done." Run `.claude/skills/security-check` whenever the touched categories match its trigger list. Findings come back ranked by severity with concrete evidence (file/line, a real failure scenario), not asserted.

## 3. Final review

Read the actual diff, the actual tests, and the verification findings yourself — not a summary of a summary. Did this actually solve the work item's stated problem, correctly, within scope? Decide: approve, request a targeted fix (loop back to step 1, then re-verify just the affected behavior — don't restart the whole lifecycle for a narrow fix), escalate a decision, or split remaining work into a new work item rather than silently expanding this one's scope.

Confirm `docs/prd-traceability.md` is updated for any requirement ID this work item provides evidence for.

## 4. Human review packet

Package the result using the `pr-ready` skill: what changed, why, what verification ran and what it found (and how each finding was resolved), risks or limitations, any follow-up work items discovered, and any critical decisions made along the way — flagged explicitly, not something to miss on a quick mobile review. Give the exact `git push` command and the filled-in PR description; the developer pushes and opens the PR themselves.

## 5. Update current.md

Before ending the session: update `docs/current.md` to reflect the work item's new state (shipped, awaiting review, blocked on X) and the next concrete action — for this work item or the next one selected from `docs/roadmap.md`. If this closes out real ground on a milestone, note it there too, but keep it to what shipped and what's still open — link to the PR and any ADR for the reasoning, don't re-narrate it.
