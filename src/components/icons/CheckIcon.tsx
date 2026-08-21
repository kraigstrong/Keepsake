import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "check" glyph from the design handoff's UI set.
export function CheckIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M5 12.6l4.6 4.6L19 7" />
    </Icon>
  );
}
