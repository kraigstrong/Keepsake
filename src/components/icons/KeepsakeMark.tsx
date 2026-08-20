import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

export interface KeepsakeMarkProps {
  color: ColorValue;
  // Height in px — width derives from the mark's fixed 19:24 ratio.
  size?: number;
}

// The brand mark: a ribbon on the spine of a well-used cookbook (design
// handoff "Keepsake Icon System", viewBox 0 0 38 48, ratio 19:24). Used
// for the app icon and the cold-launch StartupScreen.
export function KeepsakeMark({ color, size = 48 }: KeepsakeMarkProps) {
  const height = size;
  const width = (size * 38) / 48;
  return (
    <Svg width={width} height={height} viewBox="0 0 38 48">
      <Path d="M0 0h38v48L19 36.4 0 48z" fill={color} />
    </Svg>
  );
}
