import Svg, { Circle, Rect } from 'react-native-svg';

import type { TabIconProps } from './ThisWeekIcon';

const TOOTH_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

// Gear: a stroked outer ring + inner hole (matches LibraryIcon's
// stroke-only bookmark), eight filled teeth around it (matches
// ThisWeekIcon's filled rounded-rect bars) — same construction
// vocabulary as the other two icons, just combined. No design-handoff
// spec for this one (unlike the tab icons), so proportions are hand-
// tuned rather than lifted from a mockup.
export function SettingsIcon({ color, size = 22 }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="6.5" stroke={color} strokeWidth={1.8} />
      <Circle cx="12" cy="12" r="2.5" stroke={color} strokeWidth={1.8} />
      {TOOTH_ANGLES.map((angle) => (
        <Rect
          key={angle}
          x="10.8"
          y="3"
          width="2.4"
          height="3.2"
          rx="1.2"
          fill={color}
          transform={`rotate(${angle}, 12, 12)`}
        />
      ))}
    </Svg>
  );
}
