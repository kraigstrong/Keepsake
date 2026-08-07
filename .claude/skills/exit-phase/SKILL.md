---
name: "exit-phase"
description: "Use when a phase's build scope looks complete and it's time to check whether the phase actually exits — runs the six-category validation framework and produces the Phase Completion Report. Do not use mid-phase; use once the developer or the session believes the phase is functionally done."
---

Running the exit-gate review for a phase. This produces evidence, not a vibe check — don't mark a phase Pass without checking each item.

## 1. Re-read the phase's exit gate

Pull the exact exit gate criteria for this phase from `docs/execution-plan.md`, plus the six validation categories from §3 (Build verification, Automated behavior tests, Product acceptance tests, Human usability validation, Operational validation, Exit gate review) and the phase's own security checklist.

## 2. Check each category with evidence, not assertion

For each of the six categories, state what evidence exists (a passing test suite, a specific migration that applied cleanly, a specific manual check performed) — not just "looks good." If evidence is missing, that category is not satisfied, full stop.

Explicitly check against `docs/prd-traceability.md`: every requirement ID this phase owns should be `Done (tested)` or have a stated reason it isn't (e.g. `Deferred` with a linked follow-up).

Explicitly check against the Release-Blocking Defect Rules near the end of `docs/execution-plan.md` (Critical / High / Delivery-quality blockers). Any Critical item found blocks exit regardless of anything else.

## 3. Device demonstration is a human step

iOS Simulator is the default exit-gate environment (ADR-0003) — that's sufficient evidence for most phases. Physical-device demonstration is required only for the phases ADR-0003 lists (currently 1, 9, 10, 14, 15, 17, 19, 20). Either way, the actual demonstration happens on the developer's machine/device, not in this environment — flag it explicitly as a required human step rather than skipping it or assuming it happened.

## 4. Produce the Phase Completion Report

Fill out the template from `docs/execution-plan.md` ("Phase Completion Report Template") in full: product increment, PRD requirements covered, automated evidence, human evidence (mark what's still needed from the developer), security review, commit history summary, PR list, credential review, known limitations, and a proposed exit decision. Keep it tight per `CLAUDE.md`'s "Comments and phase records" rule — what shipped, what broke and got fixed, the evidence numbers; link to an ADR for design rationale rather than re-narrating it here.

## 5. Get the human sign-off

The exit decision (Pass / Conditional Pass / Fail) is always the developer's call, even if everything looks clean — this is one of the interrupt cases in `CLAUDE.md`. Present the completed report and ask for the decision via `AskUserQuestion` (Cowork) or by clearly pausing and presenting it (CLI). Don't advance `docs/current.md` to the next phase until you have an explicit answer.

## 6. Record the result

On Pass or Conditional Pass: write the Phase Completion Report to a new `docs/history/phase-N-<short-slug>.md` file (match the naming already in `docs/history/`), add a row for it to `docs/current.md`'s History table, and update `docs/current.md`'s `## Current` section to point at the next phase — noting any Conditional Pass follow-ups as tracked items in the new history file, not in `docs/current.md` itself. On Fail: keep the phase current in `docs/current.md`, record what's blocking there, and don't start the next phase's work or write a history file yet (there's no completed phase to archive).
