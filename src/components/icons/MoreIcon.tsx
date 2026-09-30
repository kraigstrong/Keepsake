import { Circle } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// Horizontal ellipsis for an overflow menu. Not in the design handoff's
// UI set — r=1 circles, so the set's own stroke weight fills them in.
export function MoreIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Circle cx="5" cy="12" r="1" />
      <Circle cx="12" cy="12" r="1" />
      <Circle cx="19" cy="12" r="1" />
    </Icon>
  );
}
