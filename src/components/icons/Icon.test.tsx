import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { Icon } from './Icon';

describe('Icon', () => {
  // Glyphs carry geometry only, so the grid has to come from the frame —
  // if it stops being applied, every glyph in the set silently falls back
  // to react-native-svg's defaults (no stroke, butt caps) rather than
  // failing loudly.
  it('applies the design handoff grid and stroke to its children', async () => {
    const { toJSON } = await render(
      <Icon color="#211D18">
        <Path d="M5 12.6l4.6 4.6L19 7" />
      </Icon>,
    );

    const svg = toJSON() as { props: Record<string, unknown> };
    // react-native-svg flattens viewBox into these four host props.
    expect(svg.props.vbWidth).toBe(24);
    expect(svg.props.vbHeight).toBe(24);
    expect(svg.props.stroke).toBe('#211D18');
    expect(svg.props.strokeWidth).toBe(1.8);
    expect(svg.props.strokeLinecap).toBe('round');
    expect(svg.props.strokeLinejoin).toBe('round');
    expect(svg.props.fill).toBe('none');
  });

  it('sizes to the caller, squarely', async () => {
    const { toJSON } = await render(
      <Icon color="#211D18" size={32}>
        <Path d="M5 12.6l4.6 4.6L19 7" />
      </Icon>,
    );
    const svg = toJSON() as { props: Record<string, unknown> };
    expect(svg.props.width).toBe(32);
    expect(svg.props.height).toBe(32);
  });
});
