# Current Status — moved

**Live work state now lives in GitHub Issues.** This file is a tombstone. It is never updated, and nothing should be recorded here.

To find what is active, blocked, or next:

```bash
gh issue list --state open --milestone "Beta" --json number,title,labels,body
```

`Beta` is what blocks external TestFlight; `Post-beta` is real work deliberately not blocking it. `owner:kraig` marks developer-only actions, `blocked:kraig` marks agent work waiting on a decision, and `verify:*` says whether an item needs the test suite, a Simulator, a device, or two devices. Acceptance criteria live in the issue body. An open issue with a linked PR is in flight; a closed issue is done. If a Project board field and the issue disagree, **the issue wins**.

An empty result means check the milestone name — `gh` returns an empty list with exit 0 for a milestone that does not exist.

## Why it moved

This file was meant to be a pointer, said so in its own first line, and twice grew into a ~2,300-word log instead. Its state contradicted itself (internal vs. external TestFlight, four different "next action" claims) and contradicted `docs/roadmap.md`. It carried an entry calling the `cup(s)` parser defect open for six days after PR #119 fixed it. The cause was mechanical: `ship-work-item` required editing this file per work item, so 17 of every 60 commits changed no product code. That step is gone.

Older documents, code comments, migrations and tests still cite this path. They are historical references and are correct about what was true when written — they are deliberately not being rewritten.
