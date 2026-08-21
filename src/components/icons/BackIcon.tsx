import { Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// The "back" glyph from the design handoff's UI set: an arrow, not a
// bare chevron. Used as the explicit back button on the recipe, grocery,
// and root stacks (developer UX feedback: swipe-to-go-back alone wasn't
// discoverable). Named for the job rather than the shape because the set
// also has a plain "chevron", which points the other way and means
// "drill in" — see ChevronIcon.
export function BackIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}
