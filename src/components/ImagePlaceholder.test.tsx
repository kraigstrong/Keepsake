import { render, screen } from '@testing-library/react-native';

import { ImagePlaceholder } from './ImagePlaceholder';

describe('ImagePlaceholder', () => {
  it('renders with an accessible "No photo" label', async () => {
    await render(<ImagePlaceholder testID="placeholder" />);
    expect(screen.getByLabelText('No photo')).toBeOnTheScreen();
  });

  it('defaults to a 64pt square', async () => {
    await render(<ImagePlaceholder testID="placeholder" />);
    const flatStyle = Object.assign({}, ...[screen.getByTestId('placeholder').props.style].flat());
    expect(flatStyle).toMatchObject({ width: 64, height: 64 });
  });

  it('applies a custom size', async () => {
    await render(<ImagePlaceholder size={120} testID="placeholder" />);
    const flatStyle = Object.assign({}, ...[screen.getByTestId('placeholder').props.style].flat());
    expect(flatStyle).toMatchObject({ width: 120, height: 120 });
  });

  it('matches its snapshot', async () => {
    const { toJSON } = await render(<ImagePlaceholder />);
    expect(toJSON()).toMatchSnapshot();
  });
});
