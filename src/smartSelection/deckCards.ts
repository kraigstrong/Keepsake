import { supabase } from '../supabase/instance';

/**
 * Title/photo/time for the swipe deck's cards — reads `recipes`, not any
 * `selection_*` table, so this stays separate from `api.ts` (which owns
 * the round/decision RPCs). One batched, RLS-scoped read, same pattern
 * as every other client read in this codebase — no service-role.
 */
export interface DeckCardDetail {
  title: string;
  heroImagePath: string | null;
  totalTimeMinutes: number | null;
}

interface RecipeCardRow {
  id: string;
  title: string;
  hero_image_path: string | null;
  total_time_minutes: number | null;
}

export async function fetchDeckCardDetails(
  recipeIds: string[],
): Promise<Map<string, DeckCardDetail>> {
  const details = new Map<string, DeckCardDetail>();
  if (recipeIds.length === 0) return details;

  const { data, error } = await supabase
    .from('recipes')
    .select('id, title, hero_image_path, total_time_minutes')
    .in('id', recipeIds);
  if (error) throw new Error(error.message);

  ((data ?? []) as RecipeCardRow[]).forEach((row) => {
    details.set(row.id, {
      title: row.title,
      heroImagePath: row.hero_image_path,
      totalTimeMinutes: row.total_time_minutes,
    });
  });
  return details;
}
