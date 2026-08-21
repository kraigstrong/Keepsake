import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "close" glyph from the design handoff's UI set.
export function CloseIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}
