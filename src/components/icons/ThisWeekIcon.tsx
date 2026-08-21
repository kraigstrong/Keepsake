import { Path, Rect } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// A calendar — the "this week" glyph from the design handoff's UI set,
// replacing the previous three descending bars (which read as a generic
// list rather than a week).
export function ThisWeekIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <Path d="M3.5 10.5h17M8 3.5v3.5M16 3.5v3.5" />
    </Icon>
  );
}
