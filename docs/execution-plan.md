# Pantry Phased Execution and Build Plan

## 1. Purpose

This plan turns the Pantry PRD, design plan, and engineering plan into a sequence of independently verifiable product increments.

At every phase:

- The product remains aligned with the PRD.
- New behavior is demonstrable on a physical device.
- Core domain logic is protected by automated tests.
- Household privacy boundaries are verified.
- Security is treated as a first-class component.
- Product assumptions are validated before later work depends on them.
- Known limitations are explicit.
- The application remains releasable or recoverable.
- Work is delivered through multiple coherent, incremental, human-reviewable commits.

A phase does not exit because the implementation appears complete. It exits because its product, technical, security, and delivery claims have evidence.

---

## 2. Execution Principles

### 2.1 Build vertical slices

Prefer complete user-visible slices over finishing an entire technical layer in isolation.

### 2.2 Test product behavior

Tests should protect user-visible and domain behavior rather than internal implementation details.

### 2.3 Maintain PRD traceability

Every requirement must link to:

- An owning phase
- Acceptance criteria
- Automated evidence where practical
- Human validation where subjective experience matters
- A current status

### 2.4 Resolve risks early

Prove high-risk assumptions before dependent investment:

- Safari Share Extension
- Apple Reminders
- Website extraction
- Photo extraction
- Offline search
- Quantity parsing
- Grocery merging
- Household RLS
- Shared edit conflicts

Several of these (Safari Share Extension, Apple Reminders) require Expo's prebuild / custom-development-client path rather than the fully managed workflow — see ADR-0002.

### 2.5 Prevent scope expansion

Every phase includes explicit non-goals.

### 2.6 Security is continuous

Security is not deferred to a final hardening phase.

Every phase must consider:

- Authentication and authorization
- Household isolation
- Credential and secret handling
- Dependency and supply-chain risk
- Input validation
- Privacy and data minimization
- Logging and telemetry safety
- Storage access
- Destructive operations
- Native permissions
- AI boundaries
- Abuse controls
- Recovery and incident response

### 2.7 No secrets in Git

No secret, credential, private key, token, signing key, service-role credential, database password, API key, or production configuration value may be committed to Git at any point.

This includes deleted files, examples, fixtures, screenshots, logs, generated projects, build output, commit messages, and pull-request text.

If a secret is committed:

1. Revoke or rotate it immediately.
2. Determine where it was exposed.
3. Remove it from history when appropriate.
4. Review access logs.
5. Document the incident.
6. Improve automated prevention.

Removing it in a later commit is not sufficient.

### 2.8 Use 1Password developer tools

Use:

- 1Password Environments for local, CI, staging, and production configuration.
- 1Password CLI for command-time secret injection.
- 1Password SSH agent for managed developer SSH identities where supported.

Prefer references and runtime injection over copied `.env` values.

If a local `.env` file is unavoidable, it must be generated from 1Password, ignored by Git, minimal, and disposable.

### 2.9 Incremental commit discipline

Every phase must contain multiple coherent commits unless the phase is genuinely trivial.

Each commit should:

- Accomplish one understandable outcome.
- Be reviewable by a human.
- Leave the branch in a valid state.
- Include relevant tests for behavior changes.
- Avoid unrelated refactoring.
- Avoid mixing generated changes with substantial handwritten logic where practical.
- Pass type checks and relevant tests.
- Contain no secrets.
- Use a clear outcome-oriented message.

Good examples:

```text
Add household membership tables and constraints
Add household membership RLS policies and tests
Add household creation server operation
Add household creation client flow
Add invitation token validation
```

Poor examples:

```text
Build household feature
Various fixes
WIP
Finish phase 3
```

### 2.10 Commit ordering

A typical implementation sequence is:

1. Requirements and acceptance criteria
2. Schema or contract changes
3. Security policies and database tests
4. Domain logic and unit tests
5. Server operations and integration tests
6. Client data access
7. UI behavior
8. End-to-end coverage
9. Observability and documentation
10. Removal of temporary flags

Security must ship with or before the capability it protects.

### 2.11 Pull-request scope

A phase may contain multiple pull requests.

Each pull request should:

- Have a narrow objective
- Reference PRD identifiers
- Describe security implications
- List tests
- Identify migrations
- State limitations
- Preserve reviewable commits
- Avoid unrelated cleanup

Do not routinely squash an entire phase into one commit.

### 2.12 Claude Code / Cowork operating model

This project is developed primarily through Claude sessions (Claude Code CLI, IDE integrations, or Cowork/the Claude app) working directly in this repository, rather than through a human writing every line. This section defines how those sessions should behave so that development stays low-interruption and every decision that matters is reviewable.

**Where work happens.** Sessions operate on this checked-out repository on the developer's machine. Cowork sessions in particular can be resumed and answered from the Claude mobile app, so mid-flight questions are not a blocker on being at a desk.

**Resuming state.** Every session starts by reading [`docs/phase-status.md`](./phase-status.md) to find the current phase, its status, and the next action, rather than re-deriving progress from scratch.

**Default to acting, not asking.** Routine implementation choices that the PRD, this plan, or an ADR already answer should be made without interrupting the developer. A session should only stop and ask (via `AskUserQuestion` in Cowork, or by pausing and stating the question in the CLI) for:

- A genuine product or design decision not already resolved by the PRD.
- A phase exit-gate confirmation (Pass / Conditional Pass / Fail).
- Anything touching credentials, secrets, or production access.
- A destructive or hard-to-reverse operation outside the currently scoped work.
- A risk-spike result (Phase 1) that forecloses an approach the PRD assumed.

**Commit and branch flow.** Work happens on a feature branch per phase (or per coherent slice within a large phase), following the commit discipline in 2.9–2.10. Commits are made locally as work progresses — they do not wait for a session to "finish" a whole phase.

**Getting to GitHub.** This sandbox a Claude session runs in does not hold your GitHub push credentials. At each PR-worthy point (end of a commit group, or end of a phase), the session states that a branch is ready and gives you the exact `git push` / PR description to use. You push and open the PR yourself — from a laptop, or from the GitHub mobile app on a branch that's already sitting in your local repo. If you later provide a scoped GitHub token, a session can push and open the PR itself instead.

**Review surface.** Two surfaces cover different needs:

- **In-session (Cowork/CLI):** fast, mid-flight decisions and approvals — folder access, ambiguous product calls, exit-gate sign-off.
- **GitHub PRs:** the durable, diff-level review record — what actually shipped, with the phase completion report in the PR description.

Both are expected to be used together, not as alternatives.

**Skills.** Repeated phase mechanics are encoded as project skills in [`.claude/skills/`](../.claude/skills/): starting a phase, running the exit-gate review, and packaging a commit group for PR. Use them rather than re-deriving the process each time.

---

## 3. Validation Framework

Every phase uses six validation categories.

### 3.1 Build verification

Confirms builds, migrations, and supported environments work.

### 3.2 Automated behavior tests

Confirms deterministic domain, data, API, synchronization, and UI behavior.

### 3.3 Product acceptance tests

Use Given/When/Then criteria tied to PRD requirements.

### 3.4 Human usability validation

Used for clarity, trust, speed, accessibility, and product feel.

### 3.5 Operational validation

Confirms failures can be observed and diagnosed without leaking sensitive content.

### 3.6 Exit gate review

A phase exits only when:

- Required tests pass
- PRD evidence exists
- Security evidence exists
- No release-blocking defect remains
- New risks are recorded
- Deferred work is explicit
- The increment has been demonstrated on iOS Simulator. A physical-device demonstration is additionally required only for phases whose exit gate explicitly calls for one (Phases 1, 9, 10, 15, 17, 19, 20 — see ADR-0003) — not for every phase by default.
- Commit history is incremental and reviewable

---

## 4. Testing Layers

### Static checks

Run on every pull request:

- TypeScript strict checks
- Linting
- Formatting
- Migration validation
- Zod schema compatibility
- Secret scanning
- Dependency scanning
- Lockfile review

### Unit tests

Cover:

- Quantity parsing
- Fractions
- Scaling
- Safe conversions
- URL normalization
- Search weighting
- Grocery merging
- Week calculation
- Duplicate detection
- Version conflicts

### Database tests

Use real PostgreSQL or local Supabase for:

- RLS
- Constraints
- Transactions
- Triggers
- Versioning
- Planning counts
- Archive/delete
- Idempotency

### Contract tests

Cover:

- AI output
- Server function contracts
- Sync payloads
- Share Extension handoff
- Reminders wrapper
- Image processing

### Integration tests

Cover:

- Authentication to household creation
- Recipe save to version history
- Import to recipe
- Planning to groceries
- Cooking completion to history
- Server data to SQLite

### UI tests

Cover meaningful behavior, not implementation structure.

### End-to-end tests

Maintain a small stable suite for critical journeys.

### Exploratory testing

Use structured charters for imports, connectivity, large libraries, concurrency, Dynamic Type, VoiceOver, and kitchen use.

---

## 5. Test Environments

### Local

Development, local Supabase, fixtures, mocked AI.

### CI

Static checks, unit tests, database tests, contracts, migrations, selected integration tests.

### Staging

Production-like Supabase, real auth, real Storage, controlled Anthropic API access, TestFlight builds.

### Production

Smoke checks, telemetry, limited test accounts, migration verification, rollback readiness.

---

## 6. PRD Traceability

Create `docs/prd-traceability.md`.

Example requirement groups:

```text
HH-01 One shared household
HH-02 Multiple household members
HH-03 Equal permissions

IMP-01 Website URL import
IMP-02 Safari Share Sheet
IMP-03 Bulk URL import
IMP-04 Camera import
IMP-05 Existing photo import
IMP-06 Manual creation

AI-01 Remove blog content
AI-02 Rewrite instructions clearly
AI-03 Include quantities inline
AI-04 Identify sections
AI-05 Infer timing
AI-06 Infer categories and tags
AI-07 Highlight ambiguity
AI-08 Never confidently invent missing information

SEC-01 No secret is committed to Git
SEC-02 Approved secret management is used
SEC-03 Household data is protected server-side
SEC-04 Storage is restricted by membership
SEC-05 Sensitive content is excluded from telemetry
SEC-06 External input is validated
SEC-07 Destructive operations are authorized and idempotent
SEC-08 Security scanning runs in CI
SEC-09 Dependencies are reviewed and scanned
SEC-10 Security is validated in every phase

DEL-01 Each phase contains coherent incremental commits
DEL-02 Each commit is independently understandable
DEL-03 Behavior changes include tests
DEL-04 Meaningful history is preserved
DEL-05 PRs identify PRD and security implications
DEL-06 Unrelated changes are not mixed
```

---

# Phase 0 — Product Baseline and Quality Harness

## Objective

Establish requirements, environments, quality controls, security controls, and delivery standards.

## Build scope

- Repository and CI
- Branch and PR conventions
- TypeScript strict mode
- Linting and formatting
- Test frameworks
- Local and staging Supabase
- Database migrations
- Feature flags
- Error and analytics abstractions
- PRD traceability
- Architecture decision records
- Test fixtures
- Release checklist
- Security review checklist
- Threat model draft
- Secret scanning
- Dependency scanning
- Lockfile review
- 1Password vault and environment organization
- 1Password CLI workflows
- 1Password SSH guidance
- `.gitignore` coverage
- Sanitized environment templates
- Credential rotation and incident procedures
- Commit and PR templates
- Merge strategy preserving meaningful commits

## Automated validation

- Example unit test
- Migration apply and rollback
- Example RLS test
- Development build
- Fake-secret detection
- Non-secret fixture allowed
- Build using 1Password injection
- No server credential in client bundle
- Dependency scan
- Required checks block merge

## Acceptance criteria

```text
Given a clean checkout
When documented setup is followed
Then the app launches
And migrations apply
And tests pass
And credentials are supplied without tracked live values
```

## Exit gate

- Clean setup works
- PRD requirements are inventoried
- 1Password workflows are tested
- Secret and dependency scans are enforced
- Commit standards are active
- Phase history is incrementally reviewable

## Non-goals

No product feature implementation.

---

# Phase 1 — Native Feasibility and Risk Spikes

## Objective

Prove high-risk native and platform assumptions.

## Build scope

- Safari Share Extension
- Apple Reminders
- Expo development-build native configuration
- SQLite full-text search
- Camera and photo access
- App Group handoff
- Durable import submission
- Keep-awake
- Invitation deep links
- Claude structured extraction

## Security validation

- No privileged credential in app or extension bundle
- No long-lived service credential in App Group storage
- Minimal native permissions
- Manipulated deep links rejected
- Claude API calls server-side only
- Build logs contain no secrets
- Offline-staged imports do not contain privileged credentials

## Automated validation

- Native build
- Share payload contracts
- Reminders wrapper tests
- Search benchmark
- AI schema tests
- Deep-link parsing tests
- Artifact secret scan

## Human validation

Physical devices, signed-in/out, online/offline, granted/denied permissions.

## Exit gate

Chosen implementation paths exist for all release-blocking native requirements.

---

# Phase 2 — Application Shell and Design Foundation

## Objective

Build navigation, visual primitives, accessibility, secure session handling, and safe telemetry foundations.

## Build scope

- Expo Router
- This Week and Library tabs
- Settings access
- Global add action
- Design tokens
- Buttons, rows, chips, sheets, alerts, toasts
- Empty, loading, error, and offline states
- Image placeholder
- Dynamic Type
- Reduced Motion
- VoiceOver conventions
- Secure session storage
- Authenticated route boundary
- Sign-out state clearing
- Redacted logging
- Analytics event allowlist

## Validation

- Component snapshots
- Accessibility-role tests
- Dynamic Type tests
- Navigation tests
- Reduced Motion tests
- No remote dependency for shell rendering
- No sensitive values in logs

## Exit gate

The shell is accessible, secure, reusable, and ready for vertical slices.

---

# Phase 3 — Authentication, Household, and Security Boundary

## Objective

Prove the household model and server-enforced isolation.

## Build scope

- Email authentication
- Profiles
- Household creation
- Memberships
- Invitations
- Deep-link acceptance
- Household settings
- RLS helpers
- Database and Storage policies
- Session restoration
- Abuse controls

## Recommended commit sequence

```text
Add household and membership schema
Add household constraints and indexes
Add household RLS helper functions
Add household RLS policies
Add cross-household database tests
Add household creation server operation
Add invitation schema and token hashing
Add invitation acceptance operation
Add invitation abuse controls
Add household client flows
Add household end-to-end tests
```

## Validation

- Cross-household reads and writes denied
- Invitation expiry and replay
- Idempotent acceptance
- Storage isolation
- Two-user shared household flow
- Sign-out clears local state

## Exit gate

Two users can share one household, and a non-member cannot access it through any tested path.

---

# Phase 4 — Manual Recipe Vertical Slice

## Objective

Create, save, view, and edit a complete household recipe without AI.

## Build scope

- Recipe schema and RLS
- Sections
- Ingredients
- Instructions
- Categories and tags
- Manual creation
- Recipe detail
- Editor
- Timing and yields
- Permanent notes
- Source attribution
- Hero images and square crop
- Draft shell
- Explicit Save
- Basic synchronization

## Security

- RLS ships with schema
- Server-side path validation
- Image type and size validation
- Metadata stripping
- No recipe content in analytics or logs
- Atomic save

## Validation

- Domain ordering tests
- Database atomicity
- Cross-household denial
- Image lifecycle
- Representative recipe usability

## Exit gate

A household can maintain useful recipes manually.

---

# Phase 5 — Drafts, Version History, and Edit Conflicts

## Objective

Make shared editing safe and recoverable.

## Build scope

- User-specific drafts
- Base-version number
- Draft persistence
- Explicit save transaction
- Immutable snapshots
- Version history
- Restore
- Conflict handling

## Validation

- Autosave creates no version
- Explicit Save creates one version
- Restore creates a new version
- Drafts are user-specific
- Concurrent edits cannot silently overwrite
- Restore reauthorizes membership

## Exit gate

Every saved edit is recoverable and shared editing cannot silently destroy work.

---

# Phase 6 — Offline Read Model and Synchronization

## Objective

Support offline browsing and prepare local search and cooking.

## Build scope

- SQLite schema and migrations
- Household-scoped local storage
- Initial and incremental sync
- Tombstones
- Sync cursor
- Transactional writes
- Cached images
- Connectivity states
- Cache rebuild
- Storage limits
- Sign-out cleanup

## Security

- No auth credential in SQLite
- Cache isolated by household
- Outbox data tied to user and household
- Sync logs exclude recipe content
- Backup implications documented

## Validation

- Cold offline launch
- Incremental replay
- Interrupted sync
- Archive/delete propagation
- Schema migration
- Sign-out cleanup

## Exit gate

Previously synchronized recipes remain readable offline without weakening server authority.

---

# Phase 7 — Library, Smart Sort, Search, and Filters

## Objective

Make every saved recipe easy to find, online or offline.

## Build scope

- Library
- Flat Smart sort
- Sort persistence
- SQLite full-text index
- Weighted title/ingredient/everything search
- Typo fallback
- Singular/plural behavior
- Filters
- Active filter count
- Search-state restoration
- Empty states
- Performance instrumentation

## Security and privacy

- Raw search terms excluded from analytics by default
- Index cleared on sign-out
- Archived/deleted data excluded
- Bounded fuzzy search

## Validation

- Search ranking fixture suite
- Smart-sort deduplication
- Filter logic
- 100/1,000/5,000 recipe performance tests
- Human findability tests

## Exit gate

Users can find known recipes quickly and predictably.

---

# Phase 8 — URL Import Foundation

## Objective

Turn a recipe webpage into a usable saved recipe without mandatory review.

## Build scope

- Import jobs
- URL normalization
- Duplicate detection
- Secure fetcher
- Structured extraction
- Content fallback
- Claude structured response
- Domain validation
- Uncertainty mapping
- Image acquisition
- Recipe creation
- Progress and retry
- Source attribution
- Telemetry

## Security

- SSRF prevention
- DNS and redirect revalidation
- Size and timeout limits
- Content-type checks
- HTML cleanup
- Prompt-injection resistance
- Schema-only AI output
- Server-side credentials
- Rate limits and cost controls
- Idempotency
- Limited raw-content retention
- Failed-artifact cleanup

## Validation

- Security fetcher suite
- Import fixture suite
- AI contract suite
- Job retry and duplication tests
- Human import-quality review

## Exit gate

URL import is usable, safe, observable, and does not confidently invent missing information.

---

# Phase 9 — Safari Share Sheet and Bulk URL Import

## Objective

Make recipe collection natural from Safari and efficient for URL migration.

## Build scope

- Final Share Extension
- Authenticated submission
- Offline staging
- Retry handoff
- Signed-out recovery
- Bulk URL parsing
- Batch jobs
- Partial failures
- Leave-and-return progress
- Duplicate handling

## Security

- No privileged credentials in extension
- Staging data expires
- Bulk limits
- Hostile URLs fail independently
- Replays are idempotent
- Jobs are household-scoped

## Exit gate

Safari sharing is faster than copy/paste, and bulk failures do not block successes.

Physical device required (Share Extension behavior is not fully representative on Simulator) — see ADR-0003.

---

# Phase 10 — Camera and Existing Photo Import

## Objective

Support non-web recipes while preserving the original source photo.

## Build scope

- Camera
- Photo picker
- Upload-before-processing
- Validation
- Metadata stripping
- Original-photo retention
- Vision extraction
- Partial recipes
- Uncertainty
- View Original Photo
- Hero replace/remove

## Validation

- Upload interruption
- Unsupported and oversized files
- Partial-page behavior
- Original retention
- Metadata stripping
- Household authorization
- Poor image quality cases

## Exit gate

Photo imports fail safely, preserve originals, and do not imply multi-page OCR.

Physical device required for live camera capture (Simulator has no camera) — see ADR-0003.

---

# Phase 11 — Units, Scaling, and Quantity Integrity

## Objective

Adjust recipes without losing source fidelity or making unsafe conversions.

## Build scope

- Quantity representation
- Fraction and range parsing
- Unit normalization
- Safe conversion table
- User preference
- Original/Preferred toggle
- Multipliers
- Arbitrary serving count
- Kitchen-friendly formatting
- Approximation indicator

## Safety validation

- Temperature preservation
- Unsafe mass/volume conversion prevention
- Small quantity rounding
- Extreme values
- Malformed imported quantities
- Range scaling
- Original values never lost

## Exit gate

The quantity fixture corpus passes and displayed values are practical and trustworthy.

---

# Phase 12 — This Week Planning

## Objective

Create a simple shared weekly shortlist.

## Build scope

- Weekly plan
- Current household-local week
- Empty and populated states
- Multi-select picker
- Quantity review
- Confirmation transaction
- Planned count
- Reordering
- Remove and Undo
- Week rollover
- Multi-member sync

## Security and correctness

- Server authorization
- Transactional counts
- Idempotent retries
- Cross-household recipe IDs rejected
- Archived/deleted recipes rejected
- Reorder validates ownership

## Exit gate

The household can create an ordered weekly shortlist without meal-calendar behavior.

---

# Phase 13 — Grocery Generation and Review

## Objective

Create a trustworthy grocery review before native export.

## Build scope

- Scale planned ingredients
- Canonical ingredient identity
- Conservative merging
- Categories
- Staples
- Grouped review
- Include/exclude
- Deterministic hashing

## Security and privacy

- No AI call at export time
- Authorized plan data only
- No raw grocery content in analytics
- Debug provenance hidden from normal clients

## Validation

Large must-merge and must-not-merge fixture suite.

A false merge is more severe than a missed merge.

## Exit gate

Users trust the generated list enough to export without manual editing.

---

# Phase 14 — Apple Reminders Export

## Objective

Reliably send reviewed groceries to Apple Reminders.

## Build scope

- Point-of-use permission
- Permission recovery
- Pantry list strategy
- Item creation
- Duplicate protection
- Export records
- Open Reminders
- Retry and partial failure

## Security and privacy

- Minimal permission
- No reminder content in logs
- No unrelated list modification
- Review state preserved on failure
- No embedded privileged credentials

## Exit gate

Export works reliably on supported physical devices and does not disturb unrelated reminders.

---

# Phase 15 — Cooking Mode and Cooking History

## Objective

Cook entirely inside Pantry, including offline completion.

## Build scope

- Single scrolling mode
- Ingredient and instruction checks
- Scale and units
- Local session persistence
- Screen awake
- Resume and reset
- Done Cooking
- Optional note
- Remove-from-plan toggle
- Cooking events
- History and newest-note preview
- Offline outbox
- Accessibility announcements

## Security

- Outbox tied to user and household
- Membership rechecked on sync
- Idempotent replay
- Notes excluded from logs
- Local session cleared on sign-out

## Exit gate

Cooking Mode survives real kitchen use and offline completion creates exactly one history event.

Physical device required (screen-awake and real kitchen-use behavior are not representative on Simulator) — see ADR-0003.

---

# Phase 16 — Archive, Recently Deleted, and Destructive Lifecycle

## Objective

Complete the recipe lifecycle safely.

## Build scope

- Archive and Undo
- Archived Recipes
- Unarchive
- Move to Recently Deleted
- Confirmation
- Restore
- Permanent delete
- Asset cleanup
- Tombstones
- Multi-member sync

## Security

- Server-side reauthorization
- Idempotent destructive requests
- Reference-safe asset cleanup
- Immediate exclusion from normal APIs
- Auditable actor and identifiers without recipe contents

## Exit gate

Archived and deleted recipes disappear everywhere required and permanent deletion is complete and safe.

---

# Phase 17 — End-to-End Product and Security Validation

## Objective

Validate the complete MVP as one coherent product.

## Required journeys

### Website success

```text
Create household
→ Import URL
→ Find recipe
→ Add to This Week
→ Set servings
→ Generate groceries
→ Export
→ Cook
→ Add note
```

### Manual and offline

```text
Create manually
→ Sync
→ Go offline
→ Find
→ Open
→ Cook
→ Complete offline
→ Reconnect
→ Verify one event
```

### Shared household

```text
User A creates household
→ User B joins
→ User A imports
→ User B plans
→ User A edits
→ User B encounters conflict
```

### Lifecycle

```text
Archive
→ Restore
→ Delete
→ Restore
→ Permanently delete
```

### Security

```text
Household A and Household B exist
→ Non-member direct reads and writes are attempted
→ All are denied
→ A member signs out
→ Local cache is cleared or inaccessible
```

### Credential validation

```text
Build artifacts
→ Scan app and extension bundles
→ Scan generated native projects
→ Scan build logs
→ Confirm no privileged credentials
```

## Exit gate

All PRD requirements have evidence, core journeys are coherent, and no known isolation or data-loss defect remains.

At least one full pass through the required journeys happens on a physical device, in addition to Simulator coverage — see ADR-0003.

---

# Phase 18 — Performance, Accessibility, Privacy, Security, and Reliability Hardening

## Objective

Make the functionally complete MVP release-quality.

## Scope

- Performance budgets
- Accessibility audit
- Privacy audit
- Failure recovery
- RLS and Storage audit
- SSRF review
- Invitation abuse tests
- Import cost-abuse tests
- Dependency review
- Repository-history secret scan
- Mobile artifact scan
- CI log review
- 1Password access review
- Credential-rotation drill
- Incident-response exercise
- Production least-privilege review
- Backup-access review

## Exit gate

No release-blocking security, accessibility, privacy, performance, or reliability issue remains.

---

# Phase 19 — Beta Release and Observed Validation

## Objective

Validate real household use before public release.

## Beta progression

1. Internal household
2. Trusted households
3. Wider invite-only TestFlight

## Metrics

- Import success and quality
- Search-to-open
- Plans confirmed
- Grocery export success
- Cooking completion
- Repeat cooking
- Crashes
- Sync failures
- Share failures
- Permission failures

Do not collect recipe or note contents.

## Security controls

- Separate beta and production credentials
- Minimal contributor access
- Abuse and storage monitoring
- Temporary credential rotation
- Secure issue-reporting process

## Exit gate

Real households complete the success journey, and no critical defect remains.

---

# Phase 20 — App Store Release

## Objective

Release the smallest complete product satisfying the MVP.

## Release preparation

- Production migration rehearsal
- Backup
- Forward-fix or rollback plan
- Production functions
- Anthropic API quotas and rate limits
- Storage lifecycle
- 1Password production workflows
- App Store materials
- Privacy details
- Support process
- Monitoring
- Feature flags
- TestFlight signoff

## Security release gate

Block release for:

- Any live secret in Git history
- Any server credential in app or extension
- Missing RLS
- Unrestricted Storage
- Unreviewed production access
- Missing revocation path
- Known cross-household access
- Secrets printed in deployment or build logs

## Exit gate

Production smoke tests pass, monitoring is active, and product, design, engineering, privacy, and security signoffs are complete.

---

# Phase 21 — Post-Launch Stabilization

## Objective

Improve reliability before roadmap expansion.

Priority order:

1. Data integrity
2. Import reliability
3. Search success
4. Grocery trust
5. Cooking reliability
6. Household synchronization
7. Performance
8. Accessibility

Do not immediately begin major v1.1 work.

First verify repeated cooking, planning, export, search, and import behavior.

---

## Phase Completion Report Template

Each phase produces:

### Phase

Name and date.

### Product increment

What users can now do.

### PRD requirements covered

Stable identifiers.

### Automated evidence

Tests, CI, benchmarks, scans.

### Human evidence

Device tests, design reviews, usability sessions, kitchen tests.

### Security review

- New data
- Authorization
- Input boundaries
- Credentials
- 1Password usage
- Logging and analytics
- Abuse controls
- Security tests
- Threat-model changes
- Open findings

### Commit history

- Commit count
- Commit titles
- Rationale for boundaries
- Confirmation of reviewability
- Test evidence
- Secret-scan confirmation
- Confirmation security shipped with capability

### Pull requests

Scope, requirements, reviewers, migrations, security implications, follow-ups.

### Credential review

New credentials, storage, scope, rotation owner, revocation method, absence from Git and artifacts.

### Known limitations

Explicit user impact.

### Exit decision

Pass, Conditional Pass, or Fail.

---

## Release-Blocking Defect Rules

### Critical

Always blocks merge, phase progression, or release:

- Cross-household access
- Recipe data loss
- Live secret committed to Git
- Server credential in client
- Unauthenticated destructive operation
- Unrestricted private Storage
- Sensitive content in external telemetry
- SSRF to private infrastructure
- Invitation-token exposure
- Corrupt migration
- Dependency compromise

### High

Normally blocks the affected phase:

- Share Extension loses URLs
- Import corrupts quantities
- Grocery false merges
- Offline cooking loses progress
- Planned counts double increment
- Version restore is incomplete
- Reminders duplicates every item
- Exact titles are not findable
- Secret scanning is not running
- Missing rate limits
- Stale membership authorizes requests
- Sensitive build logs

### Delivery-quality blockers

A phase should not pass when:

- It is one massive implementation commit
- Unrelated features are mixed
- Core behavior has no tests
- Security appears only in a final cleanup commit
- Commit messages are unclear
- Review requires understanding the whole phase at once

---

## Final MVP Acceptance Matrix

### Save recipes

- Manual creation
- URL import
- Safari share
- Bulk import
- Camera/photo import
- Duplicate handling
- Uncertainty handling
- Local image storage

### Find recipes

- Offline library
- Title priority
- Ingredient priority
- Typo tolerance
- Singular/plural
- Filters
- Smart sort
- Archived/deleted exclusion

### Plan meals

- Multi-select
- Serving review
- Transactional confirmation
- Idempotent planned counts
- Drag reorder
- Multi-member synchronization
- Week rollover
- No calendar behavior

### Export groceries

- Scaling
- Conservative merging
- Staples
- Categories
- Include/exclude
- Reminders permission
- Duplicate protection

### Cook

- Screen awake
- Ingredients
- Instructions
- Offline session persistence
- Done Cooking
- Plan removal
- Timestamp
- Note
- Idempotent offline completion

### Preserve and recover data

- Explicit versions
- Draft isolation
- Conflict prevention
- Restore
- Archive
- Recently Deleted
- Permanent deletion
- RLS audit
- Sync recovery

### Secure delivery

- No secrets in Git history
- No server credentials in client artifacts
- 1Password-managed credentials
- Least-privilege access
- Continuous scans
- Validated external input
- Sensitive-content-safe logs
- Incremental reviewable commits
- Tests accompanying behavior changes
- Security controls shipping with protected capabilities

---

## Final Definition of Done

Pantry MVP is complete only when a household can:

1. Create or join one shared household.
2. Save a recipe from Safari with minimal interaction.
3. Receive a cleaned recipe without mandatory review.
4. Correct uncertain imported information.
5. Find the recipe quickly later.
6. Browse and search offline.
7. Add recipes to This Week.
8. Select servings or multipliers.
9. Produce a trustworthy grocery review.
10. Export to Apple Reminders.
11. Cook from one scrolling screen.
12. Complete cooking offline.
13. Record and find a cooking note.
14. Edit without silently overwriting another member.
15. Restore a previous version.
16. Archive, delete, restore, and permanently delete predictably.
17. Complete all of the above without leaking household data.
18. Complete the journey without unnecessary decisions or unrelated features.
19. Maintain no live secret or credential anywhere in Git history.
20. Include no server-side credential in the application or Share Extension.
21. Manage credentials through approved 1Password workflows.
22. Keep production access least-privilege, auditable, and revocable.
23. Protect every household table and Storage path with tested server authorization.
24. Run security checks continuously.
25. Validate external input and AI output.
26. Keep recipe and cooking content out of logs and analytics.
27. Deliver each phase through coherent incremental commits.
28. Preserve meaningful commit boundaries.
29. Include appropriate tests with behavior changes.
30. Implement security controls with the capabilities they protect.
