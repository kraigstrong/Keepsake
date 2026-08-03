import Svg, { Path } from 'react-native-svg';

import type { TabIconProps } from './ThisWeekIcon';

// Bookmark/book outline — matches the design handoff exactly (viewBox
// 0 0 20 22, path "M2 2h16v18l-8-5.5L2 20V2z", stroke-width 1.8).
export function LibraryIcon({ color, size = 22 }: TabIconProps) {
  const height = size;
  const width = (size * 20) / 22;
  return (
    <Svg width={width} height={height} viewBox="0 0 20 22" fill="none">
      <Path d="M2 2h16v18l-8-5.5L2 20V2z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
    </Svg>
  );
}
