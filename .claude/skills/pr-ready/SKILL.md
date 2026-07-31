---
name: "pr-ready"
description: "Use when a coherent commit group (or a whole phase) is done locally and ready to hand to the developer for pushing and opening a GitHub PR. Produces the exact push command and a filled-out PR description; does not push or open the PR itself since this environment has no GitHub credentials."
---

Packaging a commit group for review. This environment cannot push to GitHub or open PRs — the output of this skill is instructions the developer runs themselves (from a laptop or the GitHub mobile app on the branch that's already pushed).

## 1. Verify the branch is actually ready

- `git status` — nothing uncommitted that should be part of this PR.
- `git log <base>..HEAD --oneline` — review the commit list. Each commit should be independently understandable per execution-plan.md §2.9. If commits are muddled ("WIP", "fixes", mixed concerns), consider an interactive rebase to clean up *before* handing off — don't ship a messy history because cleanup felt optional.
- Re-run tests/type checks/linting one more time on the branch as a whole, not just per-commit.
- `git diff <base>..HEAD` — scan for anything that looks like a secret, credential, token, or `.env` value. If anything is even ambiguous, stop and flag it rather than including it.

## 2. Fill out the PR description

Use `.github/PULL_REQUEST_TEMPLATE.md` as the structure. Populate:

- Narrow objective (what this PR does, not the whole phase).
- PRD requirement IDs touched (from `docs/prd-traceability.md`).
- Security implications — new data, new authorization boundary, new external input, or explicitly "none."
- Tests included.
- Migrations included, if any, and whether they're forward-only or reversible.
- Known limitations / explicitly deferred work.

## 3. Give the developer the exact commands

Output, verbatim and ready to copy:

```
git push -u origin <branch-name>
```

Followed by the filled-in PR description as markdown they can paste into GitHub (or use with `gh pr create --title "..." --body-file ...` if they have `gh` set up).

## 4. State what happens next

Remind the developer this is a review checkpoint they can complete from the GitHub mobile app — they don't need to be at a computer to approve or comment. If there's a decision embedded in the PR (not just a rubber-stamp), call that out explicitly in the handoff message so it doesn't get missed in a quick mobile skim.
