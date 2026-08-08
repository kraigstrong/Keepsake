import type { ColorValue } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

// Same two-rect-bar construction as ThisWeekIcon (viewBox 0 0 24 24,
// 2.4pt-thick rounded bars) so the New Recipe FAB reads as part of the
// same icon set rather than a mismatched glyph.
export function PlusIcon({ color, size = 28 }: { color: ColorValue; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="4" y="10.8" width="16" height="2.4" rx="1.2" fill={color} />
      <Rect x="10.8" y="4" width="2.4" height="16" rx="1.2" fill={color} />
    </Svg>
  );
}
