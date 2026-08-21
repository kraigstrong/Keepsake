import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "add" glyph from the design handoff's UI set. Stroked rather than
// the previous pair of filled rects, so it carries the same weight as
// every other icon in the set.
export function PlusIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M12 5v14M5 12h14" />
    </Icon>
  );
}
