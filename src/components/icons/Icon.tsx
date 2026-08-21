import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';
import Svg from 'react-native-svg';

export interface IconProps {
  // ColorValue, not string — React Navigation's tabBarIcon callback
  // passes ColorValue (which can be a platform OpaqueColorValue).
  color: ColorValue;
  size?: number;
}

interface IconFrameProps extends IconProps {
  children: ReactNode;
}

// The single definition of the icon grid: 24px viewBox, 1.8px stroke,
// round caps and joins (design handoff "Keepsake Icon System", UI set —
// deliberately one weight and one grid for the whole set, so glyphs
// supply only geometry and inherit everything else. That's the handoff's
// own construction too: its glyphs are bare paths under an <svg> that
// carries the stroke attributes.)
export function Icon({ color, size = 22, children }: IconFrameProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}
