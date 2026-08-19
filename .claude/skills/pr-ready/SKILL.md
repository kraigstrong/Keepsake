---
name: "pr-ready"
description: "Use when a work item's implementation, verification, and final review are done and it's ready to hand to the developer for pushing and opening a GitHub PR. Produces the exact push command and a filled-out PR description; pushes and opens the PR directly only if the developer explicitly asks for that instead."
---

Packaging a work item for review. Default output is instructions the developer runs themselves (push command + PR description), for them to run from a laptop or the GitHub mobile app — push/PR credentials via `gh` are often available in this environment too, but don't push or open the PR yourself unless the developer explicitly asks for that.

## 1. Verify the branch is actually ready

- `git status` — nothing uncommitted that should be part of this PR.
- `git log <base>..HEAD --oneline` — review the commit list. Each commit should be independently understandable. If commits are muddled ("WIP", "fixes", mixed concerns), consider an interactive rebase to clean up *before* handing off — don't ship a messy history because cleanup felt optional.
- Re-run tests/type checks/linting one more time on the branch as a whole, not just per-commit.
- `git diff <base>..HEAD` — scan for anything that looks like a secret, credential, token, or `.env` value. If anything is even ambiguous, stop and flag it rather than including it.

## 2. Fill out the PR description

Use `.github/PULL_REQUEST_TEMPLATE.md` as the structure. Populate:

- Narrow objective (what this work item does).
- PRD requirement IDs touched (from `docs/prd-traceability.md`).
- Security implications — new data, new authorization boundary, new external input, or explicitly "none."
- Tests included.
- Migrations included, if any, and whether they're forward-only or reversible.
- Verification performed and what it found — the independent-verification pass from `ship-work-item`, and how each finding was resolved (fixed, or explicitly accepted and why).
- Known limitations / explicitly deferred work, and any follow-up work items discovered but not addressed here.

## 3. Give the developer the exact commands

Output, verbatim and ready to copy:

```
git push -u origin <branch-name>
```

Followed by the filled-in PR description as markdown they can paste into GitHub (or use with `gh pr create --title "..." --body-file ...` if they have `gh` set up).

## 4. State what happens next

Remind the developer this is a review checkpoint they can complete from the GitHub mobile app — they don't need to be at a computer to approve or comment. If there's a decision embedded in the PR (not just a rubber-stamp), call that out explicitly in the handoff message so it doesn't get missed in a quick mobile skim.
