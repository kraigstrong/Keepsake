import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { usePostOnboardingLanding } from '../../src/navigation/PostOnboardingLanding';
import { ThisWeekScreen } from '../../src/thisWeek/ThisWeekScreen';

/**
 * This Week is the tabs group's first screen, so it is also where a
 * just-onboarded account arrives — with an empty week it cannot fill,
 * because it has no recipes yet. #189 sends that one case to Library
 * instead, and this is the only place that can: by the time any screen
 * further in has mounted, This Week has already been shown.
 *
 * Navigated imperatively rather than by rendering a `<Redirect>`. The
 * redirect has to be spent as it is used — otherwise This Week bounces
 * back to Library every time it is opened with an empty library, which
 * is the standing rule #189 explicitly does not want — and spending it
 * unmounts the `<Redirect>` in the same commit, before it has navigated.
 * The same "imperative, not a re-rendered Redirect" conclusion the
 * invite route reached, for a different reason
 * (app/invite/[token].tsx:53).
 *
 * Renders nothing on the way past, so This Week never paints the empty
 * screen this exists to avoid: the splash is still coming down, and the
 * next thing drawn is Library.
 */
export default function ThisWeekTab() {
  const { shouldRedirectToLibrary, consumeRedirect } = usePostOnboardingLanding();
  const router = useRouter();

  useEffect(() => {
    if (!shouldRedirectToLibrary) return;
    // Navigate first, spend it second. The order matters: spending it is
    // what stops This Week bouncing to Library every time it is opened
    // with an empty library, and doing that first would pull this render
    // out from under a navigation that had not happened yet.
    router.replace('/library');
    consumeRedirect();
  }, [shouldRedirectToLibrary, consumeRedirect, router]);

  if (shouldRedirectToLibrary) return null;
  return <ThisWeekScreen />;
}
