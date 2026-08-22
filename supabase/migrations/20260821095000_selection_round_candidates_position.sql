-- The scorer (server/selection/scoreCandidates.ts) returns a ranked,
-- diversified list whose *order* is the product: a greedy round-robin so
-- a deck doesn't open with five beef dishes in a row. Nothing persisted
-- that order, and score can't reconstruct it — equal-score ties are
-- broken by a stable hash that no stored column carries. Without an
-- explicit ordinal the deck comes back in whatever order Postgres
-- happens to yield, so the diversification is invisible to the user and
-- differs between devices (Codex review, PR #96).
alter table public.selection_round_candidates
  add column if not exists position integer not null default 0;

comment on column public.selection_round_candidates.position is
  'Zero-based rank from the scoring pass. The deck is always read back ordered by this — see get_selection_round.';
