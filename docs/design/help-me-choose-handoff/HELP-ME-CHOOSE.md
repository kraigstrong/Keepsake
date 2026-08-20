# Help me choose — selection rounds

Spec for the feature in `Help Me Choose.dc.html`. Same rules as the rest of the package: the `.dc.html` is a **design reference in HTML**, not production code — recreate in Expo / React Native / TypeScript with RN primitives.

Frame ids below (`1a`…`1l`) are the badges on each frame in the design file.

## What it is

An optional, playful way to populate the existing **This Week** list. Every use is a **selection round** with one or more participants:

```
smart deck → independent swipes → solo shortlist or group matches → review & confirm → This Week
```

This Week remains the default workflow. Manual add/remove must keep working without ever entering a round.

## Data model (recommended)

- `Round { id, householdId, creatorId, participantIds[], candidateRecipeIds[], targetMeals, closesAt, status: open|closed }`
- `Vote { roundId, userId, recipeId, value: yes|no, createdAt }`
- `Participation { roundId, userId, cursor, finishedAt|null }`

Rules:
- One shared candidate set per round — every participant sees the same recipes (order may be shuffled per person).
- Votes are **write-only until the round closes**: no participant can read another's votes mid-round (1h).
- A `no` is a preference, not a veto — it only lowers ranking.
- Candidates exclude archived/deleted recipes and anything already in This Week.
- Nothing is ever written to This Week by a swipe. Only the confirm action in 1k/1l writes.

## Palette note

This feature was drawn from **screenshots of the shipped app**: paper `#F5F0E8`, ink `#1C1B19`, rust `#B5502E` (unchanged), hairline `rgba(28,27,25,.10)`, secondary text `rgba(28,27,25,.5–.6)`. These differ slightly from the tokens in `README.md` (`#F7F3EC` / `#211D18`). **Use the shipped values** and update the older token list — do not mix.

Accent tints used only on typographic cards: `rgba(159,174,150,.15)` sage, `rgba(196,168,130,.16)` wheat, `rgba(200,154,140,.15)` clay, `rgba(181,80,46,.06)` rust wash, `rgba(28,27,25,.05)` neutral. Assign per recipe, stable across sessions.

## Screens

### 1a — Entry (This Week)
Bordered rust secondary button, full width, below the meal list: **"Help me choose"** with a card-stack icon, plus a one-line caption. Deliberately *not* a filled button — it must not compete with **Review Groceries**. Shown whether or not the week already has meals; on an empty week it sits below the existing "Add recipes" empty state.

### 1b — Start a round (sheet)
One sheet, no wizard. Contains:
- Framing line stating the deck size and *why* these ("recipes you haven't made lately, nothing that repeats what's already planned") — this is how "thoughtful, not random" is communicated.
- **Meals to find** stepper, default 4 (from household planning preferences if set). Caption: "Just a target — you can stop anytime". Never blocks.
- **Pick on my own** (filled rust) → deck immediately.
- **Pick together** (outlined) with household avatars → 1c.

### 1c — Pick together
Household members with checkmark toggles; creator is always in and non-removable. Soft deadline row (**Wrap up by** → date/time picker, default next Thu 8 PM). `+ Invite someone to the household` reuses the existing household invite flow — no new social system. CTA counts participants: "Start round with 3", caption naming who gets notified.

### 1d — The deck (live in the design file)
- Card stack: top card draggable; two static cards behind at 7px / 14px inset.
- Threshold ±95px commits; below that it springs back. `transform: translateX(dx) rotate(dx/26)`, transition `.22s cubic-bezier(.3,.8,.4,1)`, ~220ms fly-out.
- Directional stamps fade in with drag distance: **YES** (sage `#6B7F5E`) top-left, **NOT THIS WEEK** (ink 60%) top-right.
- Visible controls always present and equal in weight to gestures: undo circle (dimmed to 35% when history is empty), **Not this week** outlined, **Yes** filled rust. Gestures are never the only path.
- Header: **Pause**, `n of 12`, running `n yes`; 3px progress rail below.
- Tapping the card opens 1f. Card body shows kind/time, title, ingredient line, meta signal ("Not made since March", "Dev's favourite", "Nothing to shop for").
- Once `yes >= target`, an ink **Review N picks** bar appears with the hint "You've got N — finish now or keep looking." Never auto-advances.
- End of deck: the card becomes a "That's the deck" terminal state; controls still allow undo.
- *In the prototype only:* Pause restarts the deck so the demo can be re-run. In the real app Pause exits to 1g.

### 1e — Photo card + undo toast
Recipes **with** a photo get a 300px image, then title + ingredient line. Recipes **without** get the typographic treatment in 1d — never excluded, never a broken placeholder. Undo toast: ink pill, "Passed on {recipe}" + rust-tinted **Undo**, ~4s.

### 1f — Recipe detail during a round
Modal over the round; header keeps context ("Still deciding · 5 of 12") so it never feels like leaving. Hero image (or the typographic block for photoless recipes), title, meta, then **Why this recipe** — a rust-tinted card, one sentence naming 2–3 real signals (recency, variety, overlap with This Week). Detail-only by decision; the deck card stays uncluttered. Ingredients below. Sticky **Not this week / Yes** footer records the vote and returns to the deck.

### 1g — Pause & resume
Leaving mid-round is safe. This Week gains a **Round in progress** card: progress, deadline, **Keep going** (filled) + **Results** (outlined). Copy states the guarantee: nothing lands in This Week until reviewed. Card disappears when the round is closed and resolved.

### 1h — Group waiting
Per-participant rows: finished (rust check + "4 yes"), in progress ("7 of 12 · started 2 h ago") with a **Remind** action. Neutral note tells the creator what closing early costs ("Priya's remaining swipes just won't count"). Actions: **Close round & see matches** (ink) and **Nudge everyone**. Creator can close any time; the deadline auto-closes otherwise.

### 1i — Solo shortlist
All yes votes, each with an include checkbox (default on) and a drag handle for cook order. Nothing is preselected for removal, but items that aren't meals (e.g. Chai Tea Loaf) can be unchecked — shown at 55% opacity when off. **Keep browsing the remaining 3** returns to the deck with state intact. CTA counts included items only: "Continue with 4".

### 1j — Group consensus
Sections by alignment, human wording, no percentages or charts:
1. **Everyone wants this** — names listed below each row.
2. **Most of you** — "2 of 3 chose this · Priya passed".
3. **Mixed interest** — "1 of 3 chose this", 70% opacity, unchecked by default.

Unanimous rows are checked by default; everything else is opt-in. `Suggest a few more` refills the deck for anyone still available. If the round closed with someone unfinished, the intro line says so ("Closed with 2 of 3 in").

### 1k — Review → This Week
Reuses the **existing** confirmation pattern: per-recipe servings / quantity steppers (`Serves 4` or `2×`, matching the units This Week already shows), with the alignment reason kept as a subtitle so the choice stays legible. Unavailable-mid-round recipes are pulled out into a neutral note rather than failing silently. CTA: **Add 3 to This Week**; caption points at the existing grocery review step.

### 1l — Too few / no strong matches
Honest headline ("Only one clear match"), the matches that do exist, then three equal outlined exits: **Send N more suggestions**, **See what got a single yes**, **Plan it by hand instead**. Same primary CTA if anything is selectable. If there are *zero* matches, drop the list and the primary CTA and keep the three exits.

## Notifications (copy)
- Invited: "Maya started a round — 12 meal ideas, swipe when you have a minute."
- Nudge: "Still time to pick — the round closes Thursday 8 PM."
- Closed: "The round's closed. 3 meals everyone agreed on."

## Accessibility
Every swipe has a labelled button equivalent; buttons are ≥50px tall. Stamps carry text, not just colour. Drag uses pointer capture and must not hijack vertical scrolling (`touch-action: none` on the card only). Undo is reachable for the whole round, not just the last card.
