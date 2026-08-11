// See navigation.test.tsx for why this file uses one shared render,
// navigated between with the imperative `router` API, rather than one
// renderRouter() call per test.
import '@testing-library/react-native/dont-cleanup-after-each';

import { act } from 'react';

import { router } from 'expo-router';
import { cleanup, renderRouter, screen, waitFor } from 'expo-router/testing-library';

// End-to-end coverage: the recipe routes (app/recipe/) are reachable
// through the real authenticated route boundary, not just as isolated
// component tests — this is what would have caught app/_layout.tsx
// missing a `<Stack.Screen name="recipe" />` entry alongside "(tabs)"
// and "settings" (found in Phase 4 while writing this suite: the route
// existed on disk but wasn't registered under the Stack.Protected
// guard, so it was unreachable in the real app). Phase 5's history
// route needed no equivalent fix — it lives under app/recipe/_layout.tsx,
// which auto-discovers every file in app/recipe/ rather than
// enumerating Stack.Screen children the way the root layout does — but
// it's tested here rather than assumed, for the same reason.
jest.mock('../supabase/instance', () => ({
  supabase: {
    // Never resolves — the original-photo route test below only checks
    // the loading state is reached, same "loading state, not fully
    // loaded content" convention as the detail/edit routes above.
    storage: { from: () => ({ createSignedUrl: () => new Promise(() => {}) }) },
    auth: {
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: 'test-user' } } }, error: null }),
      onAuthStateChange: jest
        .fn()
        .mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
    // This Week (Phase 12) get-or-creates the current plan via RPC on
    // mount — an empty planning-status plan, matching the "empty list"
    // convention the recipes/categories table branches below already use.
    rpc: jest.fn((fn: string) => {
      if (fn === 'get_or_create_current_weekly_plan') {
        return {
          single: () =>
            Promise.resolve({ data: { id: 'plan-1', status: 'planning' }, error: null }),
        };
      }
      return { single: () => Promise.resolve({ data: null, error: new Error('not mocked') }) };
    }),
    from: jest.fn((table: string) => {
      if (table === 'planning_entries') {
        return {
          select: () => ({
            eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: 'test-user', display_name: 'Test User' },
                  error: null,
                }),
            }),
            in: () =>
              Promise.resolve({
                data: [{ id: 'test-user', display_name: 'Test User' }],
                error: null,
              }),
          }),
        };
      }
      if (table === 'households') {
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: 'household-1' }, error: null }),
          }),
        };
      }
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
      }
      if (table === 'recipes') {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    id: 'recipe-1',
                    title: 'Herb Roast Chicken',
                    hero_image_path: null,
                    active_time_minutes: null,
                    total_time_minutes: null,
                    yield_text: null,
                    permanent_notes: null,
                    source_url: null,
                    source_attribution: null,
                    tags: [],
                    recipe_ingredient_sections: [],
                    recipe_instruction_sections: [],
                    recipe_categories: [],
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      // household_membership
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: [{ user_id: 'test-user' }], error: null }),
        }),
      };
    }),
  },
}));

jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn().mockResolvedValue(null),
  addEventListener: jest.fn().mockReturnValue({ remove: jest.fn() }),
}));

describe('recipe routes', () => {
  beforeAll(async () => {
    renderRouter('./app', { initialUrl: '/' });
    await act(async () => {});
    await waitFor(() => {
      expect(screen.getByTestId('this-week-placeholder')).toBeOnTheScreen();
    });
  }, 20000);

  it('reaches the create screen at /recipe/new', async () => {
    act(() => router.push('/recipe/new'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-editor-screen')).toBeOnTheScreen();
    });
    expect(screen.getByTestId('recipe-title-input')).toHaveProp('value', '');
  });

  // These two check the screen's loading state rather than its fully
  // loaded content — the fetch/render round-trip itself is already
  // covered by RecipeDetailScreen.test.tsx and RecipeEditorScreen.test.tsx
  // in isolation. What this suite adds on top is proof the routes are
  // registered and reachable at all with the right dynamic segment
  // (recipe-detail-loading only renders once useLocalSearchParams and the
  // route match succeed).
  it('reaches the detail screen at /recipe/[id]', async () => {
    act(() => router.push('/recipe/recipe-1'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-detail-loading')).toBeOnTheScreen();
    });
  });

  it('reaches the edit screen at /recipe/[id]/edit', async () => {
    act(() => router.push('/recipe/recipe-1/edit'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-editor-loading')).toBeOnTheScreen();
    });
  });

  it('reaches the URL import screen at /recipe/import', async () => {
    act(() => router.push('/recipe/import'));
    await waitFor(() => {
      expect(screen.getByTestId('import-url-input')).toBeOnTheScreen();
    });
  });

  it('reaches the photo import screen at /recipe/import-photo', async () => {
    act(() => router.push('/recipe/import-photo'));
    await waitFor(() => {
      expect(screen.getByTestId('photo-import-camera')).toBeOnTheScreen();
    });
  });

  it('reaches the original photo screen at /recipe/[id]/original-photo', async () => {
    act(() =>
      router.push('/recipe/recipe-1/original-photo?path=household-1%2Foriginals%2Fone.jpg'),
    );
    await waitFor(() => {
      expect(screen.getByTestId('original-photo-loading')).toBeOnTheScreen();
    });
  });

  it('reaches the history screen at /recipe/[id]/history', async () => {
    act(() => router.push('/recipe/recipe-1/history'));
    await waitFor(() => {
      expect(screen.getByTestId('recipe-history-loading')).toBeOnTheScreen();
    });
  });

  // Phase 15's cook route lives under the same auto-discovered
  // app/recipe/_layout.tsx as history/edit above — no root-layout
  // registration to forget, but tested here rather than assumed for the
  // same reason those already are.
  it('reaches the cooking mode screen at /recipe/[id]/cook', async () => {
    act(() => router.push('/recipe/recipe-1/cook'));
    await waitFor(() => {
      expect(screen.getByTestId('cooking-mode-loading')).toBeOnTheScreen();
    });
  });

  afterAll(() => cleanup());
});
