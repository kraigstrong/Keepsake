# Risk Spike: Claude Structured Extraction

**Phase 1.** Proves Claude can turn a messy, already-text-reduced recipe page into a schema-valid, PRD-compliant recipe before Phase 8 builds the real import pipeline on top.

## Question

Can Claude reliably: strip remaining blog narrative (AI-01), rewrite instructions clearly (AI-02), keep quantities inline (AI-03), preserve section structure (AI-04, REC-02/REC-03), infer timing without inventing false precision (AI-05, AI-08), and flag uncertainty rather than guess (AI-07)? And does the schema itself enforce the one hard product constraint — no `description` field (REC-09)?

## Method

`server/ai/extractRecipe.ts` — a Zod schema (`.strict()`, so an unexpected key like a stray `description` fails validation rather than silently passing — matches what Anthropic's structured-output API requires anyway) plus a system prompt, called via `client.messages.parse()` (`claude-opus-5`, per this project's default model policy). Tested against a deliberately messy fixture (`server/ai/fixtures/messyRecipePage.ts`): a rambling life-story preamble, an unrelated cross-promotion sentence, two ingredient sections that are only implied by blank-line grouping (not explicitly labeled as "sections" anywhere), and vague relative timing ("at least an hour, though grandma let hers go most of the afternoon").

Real API key available this session (developer's `server.env` mount) — this spike used it, not a mock.

## Findings

**Real result, not simulated:** the live test passed. Extracted title, correctly excluded "Instagram"/"Bologna"/"hummus" (the narrative and cross-promotion content), produced ≥2 ingredient sections from an input that never explicitly says "section" anywhere, and every ingredient item carried its quantity inline. ~13 seconds per call at `max_tokens: 4096`.

**Schema enforcement of REC-09 is real, not aspirational** — tested by handing the schema an extraction object with a `description` key added and confirming `safeParse` rejects it. If Claude ever tried to add one (or a future prompt change accidentally invited it), this fails loudly instead of a description field quietly reappearing in the data model.

**`uncertainFields` is a prompt-level contract, not a schema-enforced one** — the schema requires the field to exist and be an array of strings, but nothing stops Claude from leaving it empty while still having guessed a suspiciously precise number. This spike's fixture happened to have inferable-but-imprecise timing ("at least an hour... most of the afternoon"), which is exactly the case this field exists for — worth a dedicated eval fixture in Phase 8 with genuinely absent timing information to confirm the model actually flags it rather than fabricating a plausible number, rather than trusting the single example here.

## A real environment bug this spike surfaced (not about the AI call itself)

The first attempt at the live-API test failed with a bare `Connection error.` — no HTTP status, empty cause. Root cause: `jest-expo`'s preset (via `@react-native/jest-preset`) sets `testEnvironment` to a React-Native-flavored environment that polyfills globals like `fetch` for RN's runtime — which silently broke the Anthropic SDK's real outbound HTTPS call. This wasn't a live-API problem at all; the whole project's Jest config had no way to run genuinely server-side Node tests correctly.

**Fixed properly, not worked around:** split into two Jest projects (`jest.config.js`) — `app` (existing `jest-expo` preset, for `src/` and `App.tsx`) and `server` (plain `testEnvironment: 'node'`, no RN setup files, for `server/`). This is a real, permanent fix that every future server-side test benefits from, not a one-off skip or mock.

## Automated evidence

`server/ai/extractRecipe.test.ts` — 4 schema-only unit tests (no network, always run) plus 1 live-API integration test, gated with `describeIfApiKey` so it **skips** (not fails) when `ANTHROPIC_API_KEY` isn't set — which is CI's current state. Confirmed both states work: skipped cleanly without a key, passed for real with one sourced from `server.env`.

## Security note (execution-plan.md §2.6 — AI boundaries, credential handling)

- `extractRecipe.ts` is server-side only by construction — it lives under `server/`, not `src/` (the Expo/RN client bundle), and nothing in `src/` imports it. Enforcing this with an actual lint rule (rather than just directory convention) is a reasonable Phase 3/8 follow-up once real Edge Functions exist to draw the boundary against.
- The real API key was sourced into this shell only for the duration of the live test run and explicitly `unset` immediately after — never written to a file, never logged, never appears in any commit.

## Not yet done

- **CI can't run the live-API test yet** — no `ANTHROPIC_API_KEY` available there. Needs the 1Password Service Account + `op run` wiring flagged since Phase 0 (`docs/phase-status.md` carried-forward items) — this spike is exactly the trigger that item was waiting for, but provisioning a Service Account is a 1Password-admin action only the developer can take. Until then, the schema tests are CI's only automated coverage; the live test is a local/manual check.
- **Cost/model tuning** — this spike defaults to `claude-opus-5` per this project's model-choice policy. Phase 8 should revisit against real usage volume (a cheaper model may be adequate for well-structured recipe sites, reserving Opus for messier pages) — noted, not decided here.
- **`uncertainFields` accuracy** — flagged above; needs a fixture with genuinely unstated timing to properly validate the model doesn't fabricate precision.

## Conclusion

Chosen implementation path exists (Phase 1's exit-gate bar) and is verified against a real API call, not assumed. The Jest environment-split fix is a durable improvement, not spike-only scaffolding — every future server-side test uses it.
