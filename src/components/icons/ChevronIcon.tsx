import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "chevron" glyph from the design handoff's UI set: points right,
// meaning "drill in". The back arrow is a separate glyph — see BackIcon.
export function ChevronIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M9.5 5.5l6.5 6.5-6.5 6.5" />
    </Icon>
  );
}
