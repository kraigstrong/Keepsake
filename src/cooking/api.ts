import { supabase } from '../supabase/instance';

export interface CookingEvent {
  id: string;
  recipeId: string;
  cookedAt: string;
  note: string | null;
}

interface CookingEventRow {
  id: string;
  recipe_id: string;
  cooked_at: string;
  note: string | null;
}

function fromRow(row: CookingEventRow): CookingEvent {
  return { id: row.id, recipeId: row.recipe_id, cookedAt: row.cooked_at, note: row.note };
}

/**
 * Always online (ADR-0024, same "no offline mirror" call as This Week's
 * own api.ts) — a direct Postgrest select, RLS-scoped. Newest first
 * (prd.md §18's "newest note preview appears near top"); a recipe with
 * no cooking history yet just gets an empty array, not an error.
 */
export async function getCookingHistory(recipeId: string): Promise<CookingEvent[]> {
  const { data, error } = await supabase
    .from('cooking_events')
    .select('id, recipe_id, cooked_at, note')
    .eq('recipe_id', recipeId)
    .order('cooked_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(fromRow);
}

// Shared by RecipeDetailScreen and CookingModeScreen — both render the
// same cooking-history rows, no reason for this to drift between them.
export function formatCookedAt(cookedAt: string): string {
  return new Date(cookedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export interface RecordCookingEventInput {
  recipeId: string;
  cookedAt: string;
  note: string | null;
  clientEventId: string;
}

/**
 * clientEventId is record_cooking_event()'s idempotency key (ADR-0024
 * decision 3) — callers (the cooking-event outbox engine, or a direct
 * online call) always pass one, generated once when the event is first
 * queued/attempted, so a retry is a safe replay rather than a duplicate.
 */
export async function recordCookingEvent(input: RecordCookingEventInput): Promise<void> {
  const { error } = await supabase.rpc('record_cooking_event', {
    recipe_id: input.recipeId,
    cooked_at: input.cookedAt,
    note: input.note,
    // Matches the RPC's client_event_id_param — the SQL parameter isn't
    // named client_event_id (an ON CONFLICT target ambiguity, see the
    // migration's own comment); PostgREST matches these keys by name.
    client_event_id_param: input.clientEventId,
  });
  if (error) throw new Error(error.message);
}
