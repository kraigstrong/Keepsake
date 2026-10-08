import { fireEvent, render, screen } from '@testing-library/react-native';

import { ToggleRow } from './ToggleRow';

describe('ToggleRow', () => {
  it('shows its value on a labelled switch and reports flips', async () => {
    const onValueChange = jest.fn();
    await render(
      <ToggleRow label="Meals only" value={false} onValueChange={onValueChange} testID="t" />,
    );

    const toggle = screen.getByRole('switch', { name: 'Meals only' });
    expect(toggle).toHaveProp('value', false);
    await fireEvent(toggle, 'valueChange', true);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });
});
