# Handoff: Keepsake — Ink & Paper visual direction

## Overview
Keepsake is an iOS recipe app (Expo / React Native / TypeScript per the PRD). This package hands off the chosen visual direction — **"Ink & Paper"** — plus four core screens fleshed out against the product requirements: This Week, Library, Recipe Detail, and Cooking Mode, with a bonus Import screen and app icon/wordmark study.

## Files in this package
- `Keepsake Visual Directions.dc.html` — the four core screens + Import (Ink & Paper direction)
- `Help Me Choose.dc.html` — the swipe-selection round feature (12 frames). Open it directly; `support.js` and `image-slot.js` sit alongside it and must stay in the same folder.
- `HELP-ME-CHOOSE.md` — spec for that feature: screens, states, rules, copy
- `Keepsake-PRD.md` — source requirements

## About the design files
The bundled `.dc.html` file is a **design reference built in HTML** — a static, high-fidelity mockup showing intended look, layout and copy. It is not production code. The task is to **recreate this design in the target codebase's environment (Expo / React Native / TypeScript, per `Keepsake-PRD.md` §25)** using React Native primitives (`View`, `Text`, `Pressable`, `ScrollView`/`FlatList`, `SafeAreaView`) and whatever navigation/state libraries the codebase already uses (e.g. React Navigation) — not `<div>`/CSS/DOM.

## Fidelity
**High-fidelity.** Colors, typography, spacing and copy below are final for this direction. Icons are simple line-art (SVG in the mock); recreate as vector icons (e.g. `react-native-svg` or an icon font) at the same visual weight — do not substitute a generic icon pack's default style.

## Design tokens — "Ink & Paper"

Colors:
- Background (paper): `#F7F3EC`
- Text primary (ink): `#211D18`
- Text secondary: `#211D18` at 45–55% opacity (e.g. `rgba(33,29,24,.55)`)
- Accent (rust — primary actions, checkmarks, step numbers, flags only): `#B5502E`
- Hairline dividers: `rgba(33,29,24,.10–.12)`
- Dark mode (Cooking Mode shown as example; extend app-wide if desired):
  - Background: `#1C1A17`, Text: `#F0EBE2`, Accent: `#D97B57`

Typography: iOS system font only (San Francisco). No second typeface.
- Screen titles: 28px / weight 700 / letter-spacing -0.02em
- Recipe/card titles: 16.5px / weight 600 / letter-spacing -0.01em
- Body / ingredients / instructions: 14–16px / weight 400 / line-height 1.7–1.9
- Section labels (Ingredients, Instructions, Cooking Notes): 11px / weight 600 / letter-spacing 0.06em / uppercase / secondary color
- Buttons: 16px / weight 600

Spacing: 24px horizontal screen padding throughout. 14px row padding in lists. 8-point rhythm elsewhere (6/8/12/14/18/22px gaps).

Radius: 10–12px on thumbnails/buttons, 16px on hero images. No radius on list rows or dividers (flat, editorial).

Shadows: none. Ink & Paper is flat — hierarchy comes from hairlines and type weight, never elevation.

Icons: 1.5–2px stroke line icons, ink-colored (never accent-colored unless active/checked/checked-off). No filled or duotone icon states.

## Screens

### 1. This Week (home / default tab)
**Purpose:** review and confirm the household's ordered shortlist of upcoming meals.
**Layout:** status bar → title block ("This Week" + "N meals, your call" subtitle, "Confirm Plan" text-link right-aligned below it) → vertical list of recipe rows → bottom tab bar.
This screen has two states, shown side by side:

**Planning (editable):** Row = 58×58px rounded-10 image (left) + title (16.5px/600) + serving-count caption (12.5px, secondary) stacked, + 6-dot drag-handle icon (right, secondary color). 13px vertical padding, 1px hairline divider between rows. Rows are **not** cards — flat, full-bleed within the 24px screen padding. "Confirm Plan" is a text link (not a button) top-right of the header — deliberately quiet per the "one obvious primary action, minimally dressed" brand feel. Drag-to-reorder (§15) via the handle icon; this is an ordered shortlist, **never** a weekday/date grid.

**Confirmed (ready to cook):** once confirmed, the drag handle is replaced by a plain chevron (rows now open the recipe/Cooking Mode, not reorder), "Confirm Plan" demotes to a quiet, secondary-colored "Edit Plan" link (tapping it returns to Planning), and a one-line accent-tinted banner appears — "Ready for groceries? Export" — linking to Grocery Export (screen 5 below). Confirming also increments a "planned count" used by Library's "Frequently Cooked" sort (§16).
**Copy used:** Herb Roast Chicken & Potatoes (Serves 4), Weeknight Spaghetti Aglio e Olio (Serves 2), Chickpea Coconut Dal (Serves 4), Sheet-Pan Salmon & Asparagus (Serves 4).

### 2. Library
**Purpose:** find any saved recipe fast.
**Layout:** title → search bar with a filter button beside it → "Sort: Smart" label → sectioned, title-only list → bottom tab bar.
**Search bar:** magnifier icon + "Search recipes" placeholder, bottom-border only (1.5px, 28% ink), no background fill, no border-radius container — takes most of the row width.
**Filter button:** 34×34px bordered square icon button (funnel glyph) beside the search bar, with a small accent dot badge when any filter is active. Opens a full filter sheet (not designed in this pass) for the PRD §12 categories — Protein / Dish Type / Preparation, multi-select. Deliberately not a flat chip row: with 12+ possible category values across three groups, chips alone don't scale — a button-to-sheet pattern does.
**Sort:** a separate small text control ("Sort: Smart") below the search row — sort is single-select (Smart / Alphabetical / Recently Added / Frequently Selected, §14) and shouldn't be conflated with multi-select filters.
**List sections:** "Recently Added" (items added within 2 weeks), "Frequently Cooked" (by planned count, not cook count — §16), "All Recipes" (remainder). Section labels use the uppercase-tracked label style. **Rows are title-only** — no thumbnail, rating, or metadata in the row (§14) — 16px/500, 11px padding, hairline divider.
**Full 20-recipe set** (spans PRD §12 categories): Herb Roast Chicken & Potatoes, Weeknight Spaghetti Aglio e Olio, Chickpea Coconut Dal, Sheet-Pan Salmon & Asparagus, Mushroom Risotto, Turkey & Bean Chili, Greek Salad with Grilled Chicken, Miso Soba Noodles, Braised Short Ribs, Crispy Tofu Stir-Fry, Classic Beef Tacos, Lemon Butter Cod, Slow Cooker Pulled Pork, Air Fryer Chicken Thighs, Butternut Squash Soup, Baked Ziti, Grilled Flank Steak, Shrimp Fried Rice, Apple Crisp, Chocolate Chip Cookies.
**Not designed yet, but linked from here per IA (§24):** Filters sheet (full category picker), Archived Recipes, Recently Deleted.

### 3. Recipe Detail
**Purpose:** review a recipe and either start cooking or add it to This Week.
**Layout:** back chevron + overflow (•••) row → hero image (contained, 158px tall, 16px radius — modest, never full-bleed in this direction) → title → source attribution line ("From seriouseats.com", domain in accent color) → time row ("20 min active · 1 hr 10 min total") → serving stepper (− / 4 / +) + scale pills (½×, 1×, 2× shown; PRD §11 full set is ½×/1×/1½×/2×/3×/4×) → category/tag chips → Ingredients (uppercase label + plain-line list, quantities inline per AI-cleanup requirement §9) → Instructions (numbered) → Cooking Notes (most recent note, italic, with date — §18; permanent recipe notes are a separate field not shown here) → fixed-bottom full-width primary button.
**Primary action:** single button, copy is contextual — "Add to This Week" when not yet planned, "Start Cooking" when it is (only one state shown in this pass; both share the same button treatment: 50px tall, 12px radius, rust fill, white 16px/600 text).
**Overflow menu (•••):** not expanded in this pass — should route to Edit, Version History (§23), Archive (§20), Delete (§21).

### 4. Cooking Mode
**Purpose:** cook hands-off, one-handed, calm — no navigation chrome.
**Layout:** thin top row with a "Staying awake while you cook" indicator (small accent dot + secondary-color caption — represents the keep-screen-awake requirement, §17) and a small close (×) affordance, only chrome on the screen → recipe title → Ingredients checklist → Instructions checklist → fixed-bottom "Done Cooking" button.
**Checkbox component:** 20×20px rounded-4 square; unchecked = outline only; checked = accent fill + white checkmark + secondary-color strikethrough text on the label. Same interaction pattern for both ingredients and instruction steps.
**Done Cooking button:** full-width, ink-filled (`#211D18`) with paper text — visually distinct from the rust "primary action" buttons elsewhere, since this is a completion/confirmation action, not a forward-navigation one.
**Behavior (§17):** tapping Done Cooking clears checklist progress (device-specific per §17), optionally removes the recipe from This Week, records a cooking timestamp (shared/synced), and should prompt for a cooking note afterward — that prompt screen is not designed in this pass.
**Dark variant included:** same layout, `#1C1A17` background / `#F0EBE2` text / `#D97B57` accent (lightened from `#B5502E` for contrast on dark) — recommended for low-light kitchen use; wire to system dark mode or a manual toggle, developer's call.

### Import (bonus screen, §8–9)
**Purpose:** paste a recipe URL and confirm the AI-cleaned result before saving.
**Layout:** title → URL field (already filled, showing a pasted link) → "Preview" section with thumbnail + title, then a plain ingredients list → "Save Recipe" button.
**Low-confidence field:** rendered as its own row, not inline text — dashed accent border, light accent fill, a small flag icon + "Confirm" label at the row's end, with a footer caption "Tap a flagged item to confirm or edit it." This makes the AI's uncertainty an actionable, editable affordance right where it occurs (§9: AI should never invent information confidently; low-confidence items are highlighted, not hidden or blocked) rather than a passive disclaimer.
**Not designed:** the async parsing/loading state between paste and preview, multi-source import (Safari share sheet, camera, bulk URL — §8).

### Bonus: App icon / wordmark
120×120 rounded-28 ink tile with a simple bookmark-ribbon cutout (paper-colored, clipped rectangle with a V-notch at the bottom) as the mark, plus a "Keepsake" wordmark (38px/700, ink, system font). Directional starting point only — not a finished icon export.

## Navigation chrome
Bottom tab bar, 64px tall, top hairline border, two tabs only — **This Week** (active icon: three descending-width bars) and **Library** (active icon: bookmark/book outline) — per PRD §24 ("Primary bottom navigation: This Week, Library. Settings is secondary, no permanent tab."). Active tab: ink icon + 700-weight label. Inactive: 40%-opacity ink icon + 500-weight label.

### 5. Grocery Export
**Purpose:** turn This Week's confirmed recipes into a grocery list and send it out in one tap (§19).
**Layout:** back chevron + "4 recipes" context label → title "Groceries" + caption noting staples (salt, oil, pepper) are omitted by default → grouped list (Produce, Meat & Seafood, Pantry — categories per §19) → fixed-bottom "Export to Reminders" button.
**Row component:** 19×19px rounded-4 checkbox (checked = accent fill + white check, same visual language as Cooking Mode) + item name + aggregated quantity (secondary, right-aligned). All items default checked/included; unchecking excludes an item from export — **no editing and no manual merge UI** (§19), just include/exclude. One row ("Salmon fillets") is shown unchecked to demonstrate the excluded state.
**Confirmation state:** after export, replace the list screen with a centered confirmation — ink checkmark badge, "Sent to Reminders", a one-line summary ("11 items across 3 lists"), and a "Done" button. Apple Reminders only for MVP (§19); no in-app editing of the exported list.
**Not designed:** the grouping/merge logic itself (server-side, conservative merging per §19), multi-list vs single-list Reminders behavior.

## Not yet designed (flagged in the PRD but out of scope this pass)
Archive / Recently Deleted, Search results state, Filter sheet (the full multi-select category picker Library's filter button opens), Recipe edit, Version history, Settings / household members, onboarding, Safari share-sheet and camera import, cooking-note prompt after Done Cooking.

## Assets
No real photography — every image area is an empty drop-in placeholder (`<image-slot>` custom element in the HTML mock, purely a design-tool convenience). Source real product photography before implementation; treat crops as: 58–60px square thumbnails in lists, ~158–190px contained (not full-bleed) hero on Recipe Detail, matching the "images illustrate, they don't lead" principle of this direction.

## Files in this folder
- `Keepsake Visual Directions.dc.html` — the design reference. Open in a browser; options `2a`–`2f` are the screens described above (This Week, Library, Recipe Detail, Cooking Mode, Import, Grocery Export). Note: this file uses a proprietary Design-Component templating syntax for the design tool it was built in — read it for exact copy/measurements/colors, but the target implementation should be plain React Native, not a recreation of this file's markup/attributes.
- `Keepsake-PRD.md` — full product requirements document (source of truth for scope, data model, and behavior beyond visual design).
