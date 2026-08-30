import { Redirect } from 'expo-router';

/**
 * Exists so expo-router has somewhere to send `keepsake:///invite/<token>`.
 *
 * Two independent things consume an incoming URL: DeepLinkProvider's
 * Linking listener, which captures the token, and expo-router's own
 * file-based routing. The listener always worked — but with no file at
 * this path the router rendered its "Unmatched Route" screen over the
 * top, which is what a real invitee saw on 2026-08-29.
 *
 * So this screen deliberately does nothing with the token: by the time it
 * renders, getInitialURL/addEventListener have already handed it to
 * DeepLinkProvider, where it survives sign-in and is consumed by
 * app/onboarding.tsx's HouseholdSetupStep. Redirecting to "/" hands
 * control back to AuthenticatedRouteBoundary, which routes by session and
 * household state exactly as it would on any other launch — sign-in when
 * signed out, onboarding when signed in without a household.
 *
 * Reading the token here and re-dispatching it would duplicate a capture
 * path that already works, and add a second way for the two to disagree.
 */
export default function InviteDeepLinkRoute() {
  return <Redirect href="/" />;
}
