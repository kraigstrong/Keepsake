import { fireEvent, render, screen } from '@testing-library/react-native';

import { ServingsConfirmationStep } from './ServingsConfirmationStep';

const items = [
  { id: 'r1', title: 'Herb Roast Chicken' },
  { id: 'r2', title: 'Tacos' },
];

describe('ServingsConfirmationStep', () => {
  it('renders a row with preset chips for every item', async () => {
    await render(
      <ServingsConfirmationStep
        items={items}
        multiplierById={{ r1: 1, r2: 1 }}
        onSelectMultiplier={() => {}}
        testIDPrefix="add-to-this-week"
      />,
    );

    expect(screen.getByTestId('add-to-this-week-servings-r1')).toBeTruthy();
    expect(screen.getByTestId('add-to-this-week-servings-r2')).toBeTruthy();
    expect(screen.getByText('Herb Roast Chicken')).toBeTruthy();
    expect(screen.getByText('Tacos')).toBeTruthy();
  });

  it('marks the chip matching the item’s current multiplier as selected', async () => {
    await render(
      <ServingsConfirmationStep
        items={items}
        multiplierById={{ r1: 1.5, r2: 1 }}
        onSelectMultiplier={() => {}}
        testIDPrefix="add-to-this-week"
      />,
    );

    expect(
      screen.getByTestId('add-to-this-week-scale-preset-r1-1.5').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
    expect(
      screen.getByTestId('add-to-this-week-scale-preset-r1-1').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: false }));
  });

  it('defaults an item with no entry in multiplierById to the 1× chip', async () => {
    await render(
      <ServingsConfirmationStep
        items={items}
        multiplierById={{}}
        onSelectMultiplier={() => {}}
        testIDPrefix="add-to-this-week"
      />,
    );

    expect(
      screen.getByTestId('add-to-this-week-scale-preset-r1-1').props.accessibilityState,
    ).toEqual(expect.objectContaining({ selected: true }));
  });

  it('calls onSelectMultiplier with the item id and the pressed preset’s multiplier', async () => {
    const onSelectMultiplier = jest.fn();
    await render(
      <ServingsConfirmationStep
        items={items}
        multiplierById={{ r1: 1, r2: 1 }}
        onSelectMultiplier={onSelectMultiplier}
        testIDPrefix="add-to-this-week"
      />,
    );

    fireEvent.press(screen.getByTestId('add-to-this-week-scale-preset-r1-2'));

    expect(onSelectMultiplier).toHaveBeenCalledWith('r1', 2);
  });

  it('scopes testIDs to the given prefix, independent of any This Week concept', async () => {
    await render(
      <ServingsConfirmationStep
        items={items}
        multiplierById={{ r1: 1, r2: 1 }}
        onSelectMultiplier={() => {}}
        testIDPrefix="help-me-choose"
      />,
    );

    expect(screen.getByTestId('help-me-choose-servings-r1')).toBeTruthy();
    expect(screen.getByTestId('help-me-choose-scale-preset-r1-1')).toBeTruthy();
  });
});
