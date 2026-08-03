import type { ColorValue } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

export interface TabIconProps {
  // ColorValue, not string — React Navigation's tabBarIcon callback
  // passes ColorValue (which can be a platform OpaqueColorValue).
  color: ColorValue;
  size?: number;
}

// Three descending-width bars — matches the design handoff exactly
// (viewBox 0 0 24 24, rect x=3 width=18/13/8 height=2.4 rx=1.2).
export function ThisWeekIcon({ color, size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="5" width="18" height="2.4" rx="1.2" fill={color} />
      <Rect x="3" y="11" width="13" height="2.4" rx="1.2" fill={color} />
      <Rect x="3" y="17" width="8" height="2.4" rx="1.2" fill={color} />
    </Svg>
  );
}
