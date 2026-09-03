# Roadmap

Milestones describe what "done" looks like — the roadmap layer of `Product Vision → Milestone → Work Item → Execution`. A milestone is never handed to an agent as a single execution instruction.

**This file holds no backlog.** Work items, their acceptance criteria, priority and state live in GitHub Issues:

```bash
gh issue list --state open --milestone "Beta" --json number,title,labels,body
```

See `docs/architecture.md` for how the system works today and `docs/prd.md` for product requirements.

Scope, deliberately: this stops at getting Keepsake in front of friends and family and learning from it. App Store submission and production rehearsal are not planned here yet.

---

## 1. MVP Validation

The six required product journeys — website success, manual/offline, shared household, lifecycle, security, credential validation — are confirmed working against current reality, including at least one physical-device pass.

## 2. Reliability

Production issues are observable and recoverable without guesswork. You can tell what broke, and the system degrades gracefully instead of losing data or getting stuck.

## 3. Security & Privacy Readiness

Known gaps are closed or explicitly accepted and documented, *and* the app has had a genuine look for what isn't known yet — not just a checklist of already-found items — before real households outside the dev process use it.

## 4. Smart Meal Selection ("Help Me Choose")

A household member can start a selection round, swipe through a deck of their own recipes, and land the ones they picked into This Week — without ever typing into a search box.

**Shipped.** `FLAGS.smartMealSelection` has been on for everyone since 2026-08-28; the flag remains as the rollback lever. Beta scope is solo-only by decision; the group flow is post-beta.

## 5. Friends & Family Preview

Real households outside the dev process are using Keepsake, and you can see how.

This is the active milestone. Everything gating it carries the `Beta` milestone in GitHub Issues.

## 6. Preview Learning & Iteration

You know what's actually working and what isn't, from real usage — not from guessing.

Intentionally without a backlog: this milestone's real content is whatever the preview's telemetry and direct feedback surface, not something to pre-guess before that data exists.
