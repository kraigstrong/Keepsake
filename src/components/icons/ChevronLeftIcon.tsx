import Svg, { Path } from 'react-native-svg';

import type { TabIconProps } from './ThisWeekIcon';

// Chevron pointing left — same stroke-only construction as LibraryIcon's
// bookmark outline. Used as the recipe stack's explicit back button
// (developer UX feedback: swipe-to-go-back alone wasn't discoverable).
export function ChevronLeftIcon({ color, size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 4.5L7.5 12l7.5 7.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
