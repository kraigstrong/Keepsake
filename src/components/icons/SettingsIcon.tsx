import { Circle, Path } from 'react-native-svg';

import { Icon, type IconProps } from './Icon';

// Two toggle sliders — the "settings" glyph from the design handoff's UI
// set, replacing the previous gear. The gear was hand-tuned because no
// handoff spec existed for it at the time; this one is specified.
export function SettingsIcon({ color, size }: IconProps) {
  return (
    <Icon color={color} size={size}>
      <Path d="M4 8h10M19.5 8h.5M4 16h5.5M14.5 16h5.5" />
      <Circle cx="16.5" cy="8" r="2.2" />
      <Circle cx="12" cy="16" r="2.2" />
    </Icon>
  );
}
