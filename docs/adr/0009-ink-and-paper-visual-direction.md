# ADR-0009: "Ink & Paper" visual direction

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 3.5

## Context

Phase 2 shipped the application shell against placeholder design tokens (`src/theme/tokens.ts`) with an explicit note that real visual direction was Phase 3.5's job. The developer produced a design handoff outside this environment (Claude's design mode, per execution-plan.md's Phase 3.5 build scope) covering four core screens (This Week, Library, Recipe Detail, Cooking Mode) plus bonus Import/Grocery-Export screens and an app-icon study, delivered as a high-fidelity static HTML mockup with an accompanying README specifying exact colors, typography, spacing, and icon treatment. Recipe Detail, Cooking Mode, Import, and Grocery Export don't have real screens to re-skin yet (Phase 4+ builds them); this phase re-skins what already exists — the Phase 2 primitives and the This Week/Library/Settings shell — against the same tokens so Phase 4 doesn't inherit a second re-skin later.

A scope question came up before starting: the mockup's This Week/Library screens use a custom 28px title block and a custom-styled tab bar (line-art icons, hairline top border), not Expo Router's native `Tabs` header. Phase 3.5's own plan text says "re-skin the Phase 2 primitives," which doesn't explicitly mention navigation chrome. Asked the developer directly: keep the re-skin narrow (retint the existing native header only) or replace it with the mockup's custom chrome. Developer chose to go further and match the mockup's chrome — reasoning being that tokens applied to unchanged iOS-default chrome wouldn't actually deliver "a real, deliberate visual direction" for the two screens that exist today, and Phase 4 should build content on a shell that already looks finished.

## Decision

**Adopted "Ink & Paper" as specified in the handoff, values taken directly from its README and HTML mockup:**

- Colors: paper background `#F7F3EC`, ink text `#211D18`, rust accent `#B5502E` (reserved for primary actions/checkmarks/step numbers/flags — never a general brand wash), hairline dividers at 10–12% ink opacity.
- Flat, no shadows/elevation — hierarchy comes from hairlines and type weight. `colors.surface` (used for secondary-button fills, image placeholders, informational banners) is a faint warm tint off paper, not a distinct "card" color, since the direction has no elevated-surface concept.
- Typography: iOS system font only, 28px/700 screen titles, 16px/500 list-row titles, 16px/400 body copy, all with the handoff's specified letter-spacing (converted from its em specs to React Native's absolute-point `letterSpacing`).
- Spacing retuned to the handoff's 24px screen padding / 14px row padding rhythm.
- Radii: 12px thumbnails/buttons, 16px hero images, fully round pills, unrounded list rows.
- Icons: real vector line-art (`react-native-svg`) at the handoff's exact stroke weight — not a generic icon pack's default style, per the handoff's explicit fidelity requirement.

**Went further than "re-skin primitives" into navigation chrome**, per the developer's explicit choice above: native `Tabs` header title hidden (not removed — `headerLeft`/`headerRight` and safe-area handling are kept for free), each screen renders its own 28px in-body title instead; tab bar re-styled to the handoff's spec (64px + safe-area inset, hairline top border, ink-active/45%-ink-inactive icons and labels).

**New dependency: `react-native-svg`.** Needed for the tab bar's line-art icons at the handoff's exact fidelity — no existing dependency provides vector icon rendering. A native module; required a fresh `expo prebuild` + `pod install` (verified with a real Xcode build in this environment, unlike Phase 3's Supabase/Docker gap — Xcode and CocoaPods are available here even though Docker isn't).

## Alternatives considered

- **Narrow re-skin (native header, just retinted):** the option NOT chosen — see Context above. Would have been lower-risk/lower-effort but wouldn't have delivered the mockup's actual visual result for the two real screens in the app today.
- **Icon font instead of `react-native-svg`:** the handoff explicitly names `react-native-svg` as an acceptable option and the icons needed (two, simple line-art) don't justify a whole icon-font pipeline for this few glyphs.

## Consequences

- `src/theme/tokens.ts` is a real interface commitment other code already depends on (every Phase 2 primitive, sign-in, onboarding, settings) — this ADR's values are what's live now, not a draft; Phase 4+ screens should be built against these tokens directly rather than re-deriving colors/type locally.
- Recipe Detail, Cooking Mode, Import, and Grocery Export screens are designed (in the handoff) but not built — Phase 4+ implementing them should follow the handoff's README directly (it has exact measurements/copy this ADR doesn't repeat) rather than re-deriving a style from what exists today.
- Cooking Mode's dark variant (`#1C1A17` background / `#F0EBE2` text / `#D97B57` accent) is specified in the handoff but not represented in `tokens.ts` yet — deliberately deferred until that screen actually exists (Phase 4+), to avoid carrying unused dark-mode tokens through phases that don't need them.
- The design handoff doesn't cover Settings, sign-in, or onboarding at all — those screens' layouts are unchanged; only token values flow through to them. A real Settings design, if one arrives later, may call for another chrome pass.
- Any future native-module addition to this project should expect the same `expo prebuild` + `pod install` step this one needed — not a new pattern, but worth remembering since it's easy to add a JS dependency and forget the native half needs relinking.
