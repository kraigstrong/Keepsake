# Pantry Product Requirements Document

## Working Title

**Pantry** *(placeholder)*

---

## 1. Product Vision

Build the recipe app we wish existed.

Not a social network.  
Not a recipe discovery platform.  
Not an AI gimmick.

A calm, beautiful home for recipes that makes getting from “What should we eat?” to “Dinner is on the table.” as effortless as possible.

The app should feel like **Things 3 meets Apple Notes**:

- Minimal
- Opinionated
- Polished
- Fast
- Uncluttered

AI should work quietly in the background. Users should rarely think about it.

---

## 2. Design Principles

### 2.1 Simplicity wins

Every screen should have one obvious primary action.

If a feature creates more decisions than value, remove it.

### 2.2 Optimize for repeat cooking

Users cook the same recipes repeatedly.

Everything should make repeat cooking easier.

### 2.3 AI disappears

AI exists to:

- Clean imports
- Structure recipes
- Suggest metadata
- Detect uncertainty

Nothing else.

### 2.4 Great defaults

Few settings.

Opinionated behaviors.

Minimal configuration.

### 2.5 Fast

The app should feel instant.

Scrolling, search, planning, and opening recipes should never feel slow.

---

## 3. Primary Users

Households that:

- Regularly cook at home
- Collect recipes from websites
- Have one or two adults planning meals
- Primarily cook recurring favorites

Not intended for:

- Food influencers
- Recipe publishing
- Social communities

---

## 4. Core Jobs

1. Save recipes.
2. Find recipes.
3. Plan meals.
4. Export groceries.
5. Cook.

Everything else is secondary.

---

## 5. MVP Scope

### Included

- Shared household
- Recipe importing
- AI cleanup
- Recipe editing
- Search
- Filters
- Weekly planning
- Grocery export
- Cooking mode
- Cooking notes
- Version history
- Archive
- Recently Deleted

### Excluded

- Social sharing
- Ratings
- Favorites
- Nutrition
- Pantry inventory
- Meal calendar
- Shopping integrations
- Multiple households
- AI meal planning
- OCR of multi-page cookbooks

---

## 6. Household Model

One household.

Multiple members.

Shared:

- Recipes
- Planning
- Notes
- Cooking history
- Archive
- Deleted items

All members have equal permissions.

---

## 7. Recipe Model

Each recipe contains:

- Title
- Hero image
- Active time
- Total time
- Yield
- Ingredient sections
- Instruction sections
- Permanent notes
- Cooking history
- Source URL
- Source attribution
- Structured categories
- Tags
- Version history

No recipe description.

---

## 8. Import Sources

Supported:

- Website URL
- Safari Share Sheet
- Bulk URL import
- Camera
- Existing photo
- Manual creation

Workflow:

```text
Import
↓
AI parses
↓
Recipe cleaned
↓
Uncertainties highlighted
↓
Save
```

No mandatory review.

---

## 9. AI Responsibilities

AI should:

- Remove blog content
- Rewrite instructions clearly
- Include ingredient quantities inline
- Identify sections
- Infer timing
- Infer categories
- Infer tags
- Detect ambiguity

AI should never invent information confidently.

Low-confidence items are highlighted.

---

## 10. Images

### Website recipes

Store locally.

Do not hotlink.

### Photo imports

Preserve original image.

Allow viewing the original photo later.

Users may:

- Replace image
- Crop square
- Remove image

---

## 11. Units

Store original values.

Display:

- Original
- Preferred

Global user preference.

Safe conversions only.

Scaling supported:

- ½×
- 1×
- 1½×
- 2×
- 3×
- 4×

Recipes with servings may also choose any serving count.

Kitchen-friendly rounding.

---

## 12. Organization

Structured categories:

### Protein

- Chicken
- Beef
- Pork
- Seafood
- Vegetarian

### Dish Type

- Soup
- Pasta
- Dessert

### Preparation

- Grill
- Slow Cooker
- Air Fryer

Multiple selections allowed.

Free-form tags also supported.

AI suggests both.

---

## 13. Search

Searches:

- Title
- Ingredients
- Notes
- Author
- Source
- Categories
- Tags

Priority:

1. Title
2. Ingredients
3. Everything else

Supports:

- Typo tolerance
- Plural/singular

Results show only recipe titles.

---

## 14. Library

Default sorting:

1. Recently Added, when added within the last two weeks
2. Frequently Selected
3. Remaining recipes

Additional sorts:

- Smart
- Alphabetical
- Recently Added
- Frequently Selected

Recipe rows:

- Title only

No metadata clutter.

---

## 15. This Week

The default screen.

Workflow:

```text
Select recipes
↓
Choose servings
↓
Review
↓
Confirm
↓
Planned count increments
↓
Offer grocery export
```

Cards show:

- Image
- Title

Supports drag-to-reorder.

This Week is an ordered shortlist, not a meal calendar. Recipes are not assigned to specific weekdays or meals.

---

## 16. Frequently Selected

Based on planned count.

Not cooking count.

Archived recipes disappear.

---

## 17. Cooking Mode

Single scrolling screen.

Features:

- Keep screen awake
- Check ingredients
- Check instructions

Done Cooking:

- Clears progress
- Optionally removes from This Week
- Records timestamp
- Prompts for cooking note

Cooking checklist progress is device-specific. Cooking history and notes are shared.

---

## 18. Cooking Notes

Short note after cooking.

Examples:

- “Needed another tsp salt.”
- “Kids loved this.”

History is chronological.

Newest note preview appears near top.

Permanent recipe notes remain separate.

---

## 19. Grocery Export

Workflow:

```text
Grouped review
↓
Include/exclude
↓
Export
```

Apple Reminders only for MVP.

Categories:

- Produce
- Meat
- Frozen
- Dairy
- Pantry
- Other

No editing.

No merge UI.

Conservative ingredient merging.

Staples omitted by default.

---

## 20. Archive

Archive hides recipes from:

- Library
- Search
- Planning
- Frequently Selected
- Recently Added

Accessible through Archived Recipes.

Archive lives in overflow menu.

---

## 21. Delete

Delete lives beside Archive.

Confirmation required.

Moves recipe to Recently Deleted.

Shared across household.

Recently Deleted does not auto-expire in the MVP. A recipe remains until restored or permanently deleted.

---

## 22. Offline

Supported:

- Browsing
- Searching
- Cooking

Requires internet:

- Imports
- Editing
- Planning
- Grocery export

Cooking completion may be queued locally and synchronized after connectivity returns.

---

## 23. Version History

Created only when editing is explicitly saved.

Autosaves remain temporary drafts.

History allows reverting previous versions.

Restoring a version creates a new current version and does not erase later history.

---

## 24. Information Architecture

```text
Home (This Week)
├── Library
│   ├── Search
│   ├── Filters
│   ├── Archived
│   └── Recently Deleted
│
├── This Week
│
├── Recipe
│   ├── Edit
│   ├── Cooking Mode
│   ├── History
│   └── Overflow
│
└── Settings
```

Primary bottom navigation:

- This Week
- Library

Settings is secondary and does not require a permanent bottom tab.

---

## 25. Technology

### Client

- Expo
- React Native
- TypeScript

### Backend

- Supabase

### Database

- PostgreSQL

### Storage

- Supabase Storage

### Authentication

- Supabase Auth

### AI

- OpenAI Responses API
- Server-side only

### Secrets and Credentials

- 1Password Environments
- 1Password CLI
- 1Password SSH agent where appropriate

No secret or credential may be committed to Git at any point.

---

## 26. Data Model — High Level

- Household
- User
- Membership
- Recipe
- Ingredient
- Instruction
- RecipeVersion
- CookingNote
- PlanningEntry
- Tag
- Category
- ImportJob

Additional implementation entities may include:

- HouseholdInvitation
- RecipeSection
- RecipeAsset
- RecipeDraft
- WeeklyPlan
- CookingEvent
- ImportBatch

---

## 27. Success Metrics

### Primary metrics

- Recipes imported
- Weekly plans created
- Grocery exports
- Recipes cooked repeatedly

### Secondary metrics

- Import accuracy
- Search success
- Time from import to saved recipe

Metrics must not include raw recipe text, cooking-note text, or other unnecessary household content.

---

## 28. Future Roadmap

### v1.1

- Better OCR
- Richer filters
- Recently cooked
- Better duplicate detection

### v2

- Shared voting for weekly meals
- Recipe sharing
- Nutrition
- Meal calendar
- Pantry inventory
- Smarter grocery intelligence

---

## 29. Explicit Non-Goals

The app will not become:

- Pinterest
- Instagram
- TikTok
- A recipe marketplace
- A grocery delivery app
- A nutrition tracker
- A calorie counter
- A social network

---

## 30. Security Requirements

Security is a first-class product and development requirement.

The application must:

- Enforce household isolation on the server using Row-Level Security and storage policies.
- Keep OpenAI, Supabase service-role, database, deployment, signing, and other privileged credentials out of client applications.
- Never commit secrets, credentials, access tokens, private keys, or production configuration values to Git.
- Use 1Password developer tools to inject and manage secrets.
- Treat external URLs, uploads, deep links, AI output, and native integration payloads as untrusted input.
- Validate all AI output before persistence.
- Protect import fetching against SSRF, unsafe redirects, oversized payloads, and hostile content.
- Exclude recipe content, cooking notes, credentials, and other sensitive household data from logs and analytics.
- Reauthorize destructive operations server-side.
- Make replayable operations idempotent where appropriate.
- Run secret, dependency, and security scans throughout development and release.
- Treat any secret ever committed to Git as exposed and rotate it immediately.

---

## 31. Definition of Success

A user should be able to:

1. See a recipe online.
2. Save it in under 30 seconds.
3. Find it months later instantly.
4. Add it to this week’s meals.
5. Export groceries in one tap.
6. Cook without touching another app.

If every screen helps accomplish those six goals—and nothing gets in the way—we have built the right product.
