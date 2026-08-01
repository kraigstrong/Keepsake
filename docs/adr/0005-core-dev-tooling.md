# ADR-0005: Core dev tooling — package manager, test framework, CI provider

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 0

## Context

Phase 0's build scope delegates several tooling choices to whoever runs the phase, rather than the PRD ("package manager, test frameworks, error/analytics tool, CI provider config... make sensible choices and record them as ADRs" — `docs/phase-status.md`). These choices compound across every later phase, so they need to be settled once, early, and documented rather than re-litigated per phase.

## Decision

- **Package manager: npm.** Expo's own quickstart and most first-party Expo tooling documentation default to npm. Phase 1 (ADR-0002) is already carrying real risk on Expo's prebuild/custom-development-client path for the Share Extension and Reminders integration; npm avoids adding pnpm's symlink-based hoisting as a second variable if a native build issue shows up during that work. Revisit if dependency install time becomes a real friction point later — nothing here is hard to migrate away from.
- **TypeScript: strict mode plus extra strictness.** `"strict": true`, plus `noUncheckedIndexedAccess` and `noImplicitOverride`. This is explicit Phase 0 build scope, not really a choice.
- **Lint/format: ESLint (`eslint-config-expo`) + Prettier.** Expo's own recommended config, kept unmodified except for Prettier integration, so lint rules track Expo SDK upgrades instead of drifting from a hand-rolled rule set.
- **Test framework: Jest (`jest-expo` preset) + React Native Testing Library.** `jest-expo` is Expo's maintained preset (correct transforms for Expo modules, mocks for native APIs). RTL is used because the plan repeatedly emphasizes testing user-visible behavior over implementation details (execution-plan.md §2.2), which is RTL's stated design goal. End-to-end framework choice (Detox vs. Maestro) is deferred to Phase 17, where it's actually needed — no unit/component-testing decision depends on it.
- **CI provider: GitHub Actions.** The repository already lives on GitHub; Actions integrates directly with the 1Password Service Accounts GitHub Action for CI secret injection (per the 1Password CLI workflow decided alongside this), and needs no separate account or billing relationship to stand up.

## Alternatives considered

- **pnpm/yarn** for package management: pnpm's stricter node_modules layout has a history of friction with Metro's resolver on React Native projects; yarn (classic or berry) doesn't offer a clear advantage over npm for a single-app repo with no workspace/monorepo need. Neither was rejected for being bad tools — just not clearly better than npm here, and npm is the path of least resistance through Expo's own docs.
- **Vitest** instead of Jest: faster and popular in the wider TS ecosystem, but `jest-expo`'s native-module mocking is the reason Jest remains Expo's own recommendation; Vitest doesn't have an equivalent maintained preset for Expo/React Native as of this writing.
- **CircleCI / Buildkite** instead of GitHub Actions: no concrete advantage for a solo/small-team project already hosted on GitHub, and would add a second external account + billing relationship for no offsetting benefit.

## Consequences

- All later phases assume npm scripts (`npm run lint`, `npm test`, `npm run typecheck`) as the CI entry points — CI workflow authoring in this phase locks that in.
- Native-build CI (once Phase 1's prebuild output exists) runs under GitHub Actions macOS runners, which have a real per-minute cost — worth watching once Phase 1 lands, but out of scope to solve pre-emptively here.
- No secrets are introduced by this ADR; CI secret injection mechanics are covered separately (1Password Service Account + `op run` in the CI workflow, per the earlier session discussion captured in `docs/phase-status.md`).
