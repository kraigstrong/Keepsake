import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "filter" glyph from the design handoff's UI set: three centred
// rules of decreasing width.
export function FilterIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M4 7h16M7 12h10M10 17h4" />
    </Icon>
  );
}
