import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// An open book — the "library" glyph from the design handoff's UI set.
// Replaces the previous bookmark outline: that shape is now reserved for
// the brand mark (see KeepsakeMark) and the set's separate "keep" icon.
export function LibraryIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M12 6.8C12 5.3 10 4.2 6.6 4.2H4v13.6h3c3 0 5 1 5 2.2M12 6.8C12 5.3 14 4.2 17.4 4.2H20v13.6h-3c-3 0-5 1-5 2.2" />
    </Icon>
  );
}
