// The recipe Stack's (app/recipe/_layout.tsx) route name for
// app/recipe/[id]/index.tsx. recipeRoutes.test.tsx pins it against the
// real router.
const DETAIL_ROUTE_NAME = '[id]/index';

interface StackState {
  index: number;
  routes: readonly { name: string; params?: object }[];
}

/**
 * Whether the screen directly beneath the focused one is `recipeId`'s
 * detail screen — i.e. whether a screen pushed from it can finish with
 * router.back() instead of replacing itself with a second copy (#221).
 */
export function isRecipeDetailBeneath(state: StackState | undefined, recipeId: string): boolean {
  const beneath = state?.routes[state.index - 1];
  return (
    beneath?.name === DETAIL_ROUTE_NAME &&
    (beneath.params as { id?: string } | undefined)?.id === recipeId
  );
}
