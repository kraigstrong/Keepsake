import { render } from '@testing-library/react-native';

import { Checkbox } from './Checkbox';

type Node = { children: unknown[] | null };

describe('Checkbox', () => {
  it('renders the check only when checked', async () => {
    const unchecked = (await render(<Checkbox checked={false} />)).toJSON() as unknown as Node;
    expect(unchecked.children ?? []).toHaveLength(0);

    const checked = (await render(<Checkbox checked />)).toJSON() as unknown as Node;
    expect(checked.children).toHaveLength(1);
  });
});
