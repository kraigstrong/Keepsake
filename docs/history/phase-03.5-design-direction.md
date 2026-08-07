# Phase 3.5 — Design Direction and Visual Iteration

**Result:** Pass | **Date:** 2026-08-02 | **PR:** [#16](https://github.com/kraigstrong/Keepsake/pull/16) (after Phase 3's [PR #15](https://github.com/kraigstrong/Keepsake/pull/15) landed first)

Adopted the developer's "Ink & Paper" design handoff as ADR-0009. Rewrote `src/theme/tokens.ts` (paper/ink/rust palette, retuned spacing/radii, letterSpacing) and re-skinned every Phase 2 primitive/shared state against it — all 8 snapshots reviewed diff-by-diff, not blindly regenerated. Went further than a narrow token re-skin into navigation chrome (developer's explicit choice, asked directly): native `Tabs` header title replaced with an in-body 28px custom title, tab bar re-styled with new `react-native-svg` line-art icons matching the handoff exactly, Settings' native modal header retinted, dark-content status bar added — new native dependency verified with a real `expo prebuild` + `pod install` + Xcode build, not just installed and assumed to work.

Verified live end-to-end in iOS Simulator (not just Jest) — a real Xcode build/pod install confirmed the new native dependency links correctly, the sign-in screen was checked as-is, and This Week/Library/Settings/the global add Sheet were checked via a temporary local-only auth-bypass (reverted before commit, never shipped) since there's no local Supabase backend to sign in against for real. That live check caught one real bug: `app/settings.tsx`'s `ScrollView` had no background color and was falling back to the platform default — fixed before this phase's exit review.

36 suites, 170 passed; typecheck/lint/format clean. No PRD IDs owned by this phase (pure visual pass). No physical-device pass — not required for this phase (ADR-0003), Simulator evidence is the sufficient default and was actually obtained this time (unlike Phase 3's sandboxed gap).

Also fixed in passing: two real bugs Phase 3's migrations had never surfaced (CI's first real run) — see `docs/history/phase-03-household-auth.md`'s "Also fixed in passing" section.
