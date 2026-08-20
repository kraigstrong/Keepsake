# Keepsake Icon System — design draft

Raw export, saved 2026-08-20 so it doesn't have to be tracked back down through Claude Design. Not yet a finished handoff doc (unlike `docs/design/help-me-choose-handoff/`) — this is the source file as read, kept here as the reference copy for the iconography-replacement backlog item (`docs/roadmap.md`'s Not-yet-triaged section).

- **Source:** Claude Design project "Keepsake: Three visual directions" (`7c61aad2-2864-46ea-8c9e-1aed6cb298e8`), file `Keepsake Icon System.dc.html`.
- **`support.js`** is the generic dc-runtime rendering harness (not project-specific) — reused from `docs/design/help-me-choose-handoff/support.js` rather than re-saved, so open `Keepsake Icon System.dc.html` directly in a browser to render it.

## Contents

- **The mark** — a bookmark/ribbon SVG (`M0 0h38v48L19 36.4 0 48z`, viewBox `0 0 38 48`, ratio 19:24), wordmark lockups down to a 17px minimum, and construction/clear-space rules.
- **App icon colorways** — ink bg/paper mark (default), ember bg/paper mark, paper bg/ink mark.
- **22-icon UI set** — 24px grid, one weight (default 1.8px stroke, round caps/joins): keep, this week, library, add, import link, search, filter, check, timer, servings, groceries, notes, tag, cook, stay awake, photo, share, delete, edit, settings, chevron, back, close.
- **Splash screens** (390×844) — ink launch (default), paper launch (light mode), cold-start syncing, hand-off to home.

Palette — ink `#211D18`, paper `#F7F3EC`, ember `#B5502E` — already matches `src/theme/tokens.ts` (`textPrimary`/`background`/`accent`) exactly.

The "Cold start — syncing" splash variant is already implemented as `src/components/StartupScreen.tsx` (with two developer-requested copy changes — see that file's header comment). The rest (22-icon UI-set replacement, app-icon PNG regeneration) is not yet implemented.
