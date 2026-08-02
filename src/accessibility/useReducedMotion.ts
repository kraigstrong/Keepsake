import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Shared by Sheet and Toast (and anything else later that animates) —
 * one implementation so Reduced Motion handling doesn't get reinvented
 * per component.
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  return reducedMotion;
}
