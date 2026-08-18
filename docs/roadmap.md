# Roadmap

Milestones organize the meaningful outcomes still ahead — the roadmap layer of `Product Vision → Milestone → Work Item → Execution`. A milestone describes what "done" looks like; it is never handed to an agent as a single execution instruction — each work item under it is planned, delegated, and reviewed individually. See `docs/architecture.md` for how the system works today and `docs/prd.md` for product requirements; this file is what's still left to build toward, not a description of the system itself.

Scope, deliberately: this roadmap stops at getting Keepsake in front of friends and family and learning from that. Release-readiness (App Store submission, production rehearsal) isn't planned here yet — revisit once Preview Learning & Iteration has actually run.

Work items are listed here as short entries — objective and why it matters. Full acceptance criteria and constraints get written when a work item is actually selected for execution, not speculatively for the whole backlog up front.

---

## 1. MVP Validation

**What done looks like:** the six required product journeys (website success, manual/offline, shared household, lifecycle, security, credential validation) are confirmed working against current reality, including at least one physical-device pass, with no known data-loss or household-isolation defect remaining. **Exception, stated explicitly so this milestone doesn't quietly depend on milestone 4:** credential validation's compiled-artifact and build-log scan (source-level and generated-native-project scans are separate and already in scope here) is intentionally deferred to Friends & Family Preview's real device build — see that milestone's backlog for why. This milestone's own bar for credential validation is the source/native-project-level scanning already achievable without one.

**Status:** `docs/current.md`'s existing Phase 17 write-up describes a state from before a recent round of testing and fixes — treat it as out of date until refreshed, not as this milestone's real backlog.

**Backlog:**
- **Refresh the six-journey status against what's actually true now.** First item, deliberately — everything else in this milestone depends on knowing what's really still open versus already resolved by recent work.
- *(Remaining items intentionally left blank pending that refresh, rather than carrying forward a stale list.)*

---

## 2. Reliability

**What done looks like:** production issues are observable and recoverable without guesswork — you can tell what broke, and the system degrades gracefully instead of losing data or getting stuck.

**Backlog:**
- Add crash reporting.
- Add structured server error logging.
- Define retry behavior for recipe import failures.
- Add recovery handling for interrupted image uploads.
- Close the orphaned original-photo Storage object gap (T15, Phase 10/ADR-0017) — no cleanup mechanism exists yet; Phase 9's 30-day outbox-expiry pattern is a plausible fit. See `docs/current.md` carried-forward items.
- Verify true two-connection concurrency for the invitation-redemption race and import-claim fencing (ADR-0020) — provable by pgTAP for logic, not yet verified under genuine concurrency. See `docs/current.md` carried-forward items.

---

## 3. Security & Privacy Readiness

**What done looks like:** known gaps are closed or explicitly accepted-and-documented, *and* the app has had a genuine look for what isn't known yet — not just a checklist of already-found items — before real households outside the dev process have data at stake.

**Backlog:**
- **Full security and privacy audit — a systematic pass, not just closing the already-known items below.** Scoped separately because "fix what's already been found" and "go looking for what hasn't" are different activities with different failure modes if conflated. Covers: a fresh, current-code re-review of the threat model end to end (not spot-checking individual T-entries in isolation); a privacy audit of what data actually gets collected, stored, or leaves the app (recipe content, cooking notes, page text sent to Anthropic, and whatever the Friends & Family Preview telemetry push ends up capturing) against what's actually necessary; a systematic sweep of every RLS policy and Storage bucket, not just the tables a specific bug already pointed at; mobile build-artifact and CI-log review for accidental secret or PII exposure; and a credential-rotation / incident-response dry run against `docs/incident-response.md`, not just trusting the runbook reads well. Best run once the specific known-gap items below are closed, so it's also verifying those fixes rather than racing them.
- **Validate uploaded photo bytes before the vision call (T23)** — magic-byte sniff or re-encode-and-validate in `import-recipe/index.ts`, closing the MIME-trust gap Codex found on PR #54. Already scoped as the worked example in the workflow-model proposal — good first real item to run through the new process once it exists.
- SSRF review of the import fetcher against current behavior — a targeted re-check of a specific known mechanism, distinct from the systematic audit above.
- Invitation abuse tests; import cost-abuse tests.
- Dependency review and repository-history secret scan.
- Wire 1Password CLI into CI (Service Account + `op run`) — still not added; concrete consequence is Phase 1's live Claude-extraction test staying `describe.skip`-gated. See `docs/current.md` carried-forward items.
- Verify the local SQLite cache's iOS backup inclusion (ADR-0013 "Backup implications") — judged low-severity, but needs real on-device verification of a path-format mismatch before trusting a fix. See `docs/current.md` carried-forward items.

---

## 4. Friends & Family Preview

**What done looks like:** real households outside the dev process are using Keepsake, and you can see how.

**Backlog:**
- **Telemetry push — gate, not a normal item.** This has to land before any invite goes out, not sometime during the preview. PostHog's event-allowlist abstraction (ADR-0006) already exists in code but is a no-op today — no real `EXPO_PUBLIC_POSTHOG_KEY` has ever been wired in. Scope: wire the real key, decide and expand the actual event set (what features get used, how often — not just the existing minimal allowlist), and confirm Sentry crash reporting (this milestone's dependency on Reliability's crash-reporting item) is live against a real DSN, not just scaffolded.
- **Fix the staging magic-link email template.** Real blocker for an actual new user signing up, not a dev-convenience gap — `signInWithOtp` currently sends Supabase's default template, which only renders a clickable link, not the `{{ .Token }}` code `verifyOtp` expects the user to type. See `docs/current.md` carried-forward items.
- Real EAS/Xcode build plus a scan of the compiled artifact and build logs — closes the credential-validation journey's remaining half, deliberately scoped here rather than MVP Validation (see that milestone's exception note) since a beta build has to happen for this milestone anyway; scanning it here means one build serving both purposes instead of producing a throwaway one just to close milestone 1 early.
- Beta progression: internal household → trusted households → wider invite-only.

---

## 5. Preview Learning & Iteration

**What done looks like:** you know what's actually working and what isn't, from real usage — not from guessing.

**Backlog:** intentionally empty for now — this milestone's real backlog is what Friends & Family Preview's telemetry and direct feedback surface, not something to pre-guess before that data exists.

---

## Unplaced

- **Swipe-style meal planning.** A major feature you want to build, not yet scoped. Deliberately left with no milestone assignment and no PRD — a separate agent session is writing that PRD. Do not sequence or start implementation work against this until that PRD exists and this entry gets placed for real.

---

## Not yet triaged

`docs/current.md`'s carried-forward items list has more entries than what's pulled into the milestones above (visual/UX polish items — Add/Settings redesign, Archive/Delete button placement — plus several smaller product-polish and low-severity findings). Not migrated here yet; needs its own pass to decide what's still relevant and where each belongs, rather than force-sorting all of it into this first draft.
